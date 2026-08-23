import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up as up014 } from '../../../database/migrations/014-semantic-asset-foundation.js';
import { up as up015 } from '../../../database/migrations/015-semantic-asset-governance.js';
import { up as up016 } from '../../../database/migrations/016-semantic-workflow-foundation.js';
import { up as up017 } from '../../../database/migrations/017-semantic-evidence-integration-foundation.js';
import { up as up018 } from '../../../database/migrations/018-authoring-amendments.js';
import { AuthoringAmendmentRepository } from '../../../database/repositories/authoring-amendment-repository.js';
import { BusinessVersionRepository } from '../../../database/repositories/business-version-repository.js';
import { SemanticAssetRepository } from '../../../database/repositories/semantic-asset-repository.js';
import { SemanticWorkflowRepository } from '../../../database/repositories/semantic-workflow-repository.js';
import { SemanticAuthoringService } from '../../../services/semantic-authoring-service.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import semanticAuthoringRoutes from '../semantic-authoring.js';

const HASH_A = 'a'.repeat(64);

describe('semantic authoring routes', () => {
  let db: DatabaseSync;
  let app: FastifyInstance;
  let assets: SemanticAssetRepository;
  let fixture: ReturnType<typeof createFixture>;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'Project')").run();
    up014(db);
    up015(db);
    up016(db);
    up017(db);
    up018(db);
    const versions = new BusinessVersionRepository(db);
    assets = new SemanticAssetRepository(db);
    fixture = createFixture(db, versions);
    const service = new SemanticAuthoringService(
      new SemanticWorkflowRepository(db),
      assets,
      new AuthoringAmendmentRepository(db, assets),
      versions
    );
    app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    app.register(errorHandlerPlugin);
    app.register(semanticAuthoringRoutes, { prefix: '/api/v1', service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('creates a repair job and candidate task immediately with idempotent replay', async () => {
    const request = {
      method: 'POST' as const,
      url: `/api/v1/business-versions/${fixture.versionId}/authoring-jobs`,
      headers: { 'idempotency-key': 'repair-module-1' },
      payload: {
        schema: 'nebula.ai-e2e.create-authoring-job/1.0',
        mode: 'repair',
        targetType: 'functional_module',
        targetId: fixture.module1Id,
        currentUrl: '/login',
        reason: '手动重新编排登录模块',
        createdBy: 'user-1',
      },
    };
    const created = await app.inject(request);
    const replay = await app.inject(request);

    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      data: {
        created: true,
        lifecycle: 'created',
        taskId: expect.any(String),
      },
    });
    expect(replay.json()).toMatchObject({
      data: { id: created.json().data.id, taskId: created.json().data.taskId, created: false },
    });
    expect(
      db
        .prepare('SELECT type, state, target_id FROM authoring_tasks WHERE id = ?')
        .get(created.json().data.taskId)
    ).toEqual({ type: 'analyze_impact', state: 'ready', target_id: fixture.module1Id });
  });

  it('turns a structured candidate into diff state while chat text remains only audit context', async () => {
    const jobId = await createJob(app, fixture);
    const threadId = await createThread(app, fixture, jobId);
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module1Id,
      fixture.module1RevisionId
    );
    const amendment = await app.inject({
      method: 'POST',
      url: `/api/v1/authoring-jobs/${jobId}/amendments`,
      headers: { 'idempotency-key': 'candidate-1' },
      payload: amendmentPayload(fixture, threadId, candidate.id, {
        moduleId: fixture.module1Id,
        baseRevisionId: fixture.module1RevisionId,
        baseRevisionSha256: fixture.module1RevisionSha256,
      }),
    });
    const message = await app.inject({
      method: 'POST',
      url: `/api/v1/authoring-context-threads/${threadId}/messages`,
      payload: {
        schema: 'nebula.ai-e2e.authoring-chat-message/1.0',
        role: 'user',
        content: '把登录模块重新排一下',
        createdBy: 'user-1',
      },
    });
    const messages = await app.inject({
      method: 'GET',
      url: `/api/v1/authoring-context-threads/${threadId}/messages`,
    });

    expect(amendment.statusCode).toBe(201);
    expect(amendment.json().data).toMatchObject({
      state: 'candidate_ready',
      changes: [{ candidateRevisionId: candidate.id, diff: { name: '新登录目标' } }],
    });
    expect(message.statusCode).toBe(201);
    expect(messages.json().data.messages).toEqual([
      expect.objectContaining({ content: '把登录模块重新排一下', amendmentId: null }),
    ]);
    expect(
      db
        .prepare('SELECT state FROM authoring_amendments WHERE id = ?')
        .get(amendment.json().data.id)
    ).toEqual({ state: 'candidate_ready' });

    const verifying = await app.inject({
      method: 'POST',
      url: `/api/v1/authoring-amendments/${amendment.json().data.id}/commands`,
      payload: { action: 'queue_at_safe_boundary' },
    });
    const directActivation = await app.inject({
      method: 'POST',
      url: `/api/v1/authoring-amendments/${amendment.json().data.id}/commands`,
      payload: { action: 'activate' },
    });
    expect(verifying.json().data.state).toBe('verifying');
    expect(directActivation.statusCode).toBe(400);
    expect(
      db.prepare('SELECT lifecycle FROM semantic_functional_module_revisions WHERE id = ?').get(candidate.id)
    ).toEqual({ lifecycle: 'draft' });
  });

  it('requires approval for another module and stales the candidate after context switch', async () => {
    const jobId = await createJob(app, fixture);
    const threadId = await createThread(app, fixture, jobId);
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module2Id,
      fixture.module2RevisionId
    );
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/authoring-jobs/${jobId}/amendments`,
      headers: { 'idempotency-key': 'candidate-other-module' },
      payload: amendmentPayload(
        fixture,
        threadId,
        candidate.id,
        {
          moduleId: fixture.module2Id,
          baseRevisionId: fixture.module2RevisionId,
          baseRevisionSha256: fixture.module2RevisionSha256,
        },
        'module_call'
      ),
    });
    expect(created.json().data).toMatchObject({
      state: 'waiting_decision',
      decisions: [{ scopeKind: 'same_page_other_module', status: 'open' }],
    });
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/authoring-amendments/${created.json().data.id}/decisions/${created.json().data.decisionIds[0]}/answer`,
      payload: {
        schema: 'nebula.ai-e2e.impact-decision-answer/1.0',
        answer: 'approve',
        reason: '批准同页模块联动修改',
        answeredBy: 'user-1',
      },
    });
    expect(approved.json().data.state).toBe('candidate_ready');

    const switched = await app.inject({
      method: 'POST',
      url: `/api/v1/authoring-jobs/${jobId}/context-threads`,
      payload: {
        schema: 'nebula.ai-e2e.authoring-context/1.0',
        businessVersionId: fixture.versionId,
        currentUrl: '/login',
        currentPageDefinitionId: fixture.pageId,
        currentFunctionalModuleId: fixture.module2Id,
        baseRevisionSha256: fixture.module2RevisionSha256,
        visibleScenarioIds: [],
        createdBy: 'user-1',
      },
    });
    expect(switched.statusCode).toBe(201);
    const stale = await app.inject({
      method: 'GET',
      url: `/api/v1/authoring-amendments/${created.json().data.id}`,
    });
    const forbiddenApply = await app.inject({
      method: 'POST',
      url: `/api/v1/authoring-amendments/${created.json().data.id}/commands`,
      payload: { action: 'queue_at_safe_boundary' },
    });
    expect(stale.json().data).toMatchObject({ state: 'stale' });
    expect(forbiddenApply.statusCode).toBe(409);
  });

  it('rejects malformed scopes before touching authoring state', async () => {
    const jobId = await createJob(app, fixture);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/authoring-jobs/${jobId}/context-threads`,
      payload: {
        schema: 'nebula.ai-e2e.authoring-context/1.0',
        businessVersionId: fixture.versionId,
        currentUrl: '/login',
        currentPageDefinitionId: fixture.pageId,
        currentFunctionalModuleId: fixture.module1Id,
        baseRevisionSha256: 'not-a-hash',
        visibleScenarioIds: [],
        createdBy: 'user-1',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ retryable: false, correlationId: expect.any(String) });
    expect(db.prepare('SELECT COUNT(*) AS count FROM authoring_context_threads').get()).toEqual({
      count: 0,
    });
  });
});

async function createJob(app: FastifyInstance, fixture: ReturnType<typeof createFixture>) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/business-versions/${fixture.versionId}/authoring-jobs`,
    headers: { 'idempotency-key': 'repair-job' },
    payload: {
      schema: 'nebula.ai-e2e.create-authoring-job/1.0',
      mode: 'repair',
      targetType: 'functional_module',
      targetId: fixture.module1Id,
      currentUrl: '/login',
      createdBy: 'user-1',
    },
  });
  return response.json().data.id as string;
}

async function createThread(
  app: FastifyInstance,
  fixture: ReturnType<typeof createFixture>,
  jobId: string
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/authoring-jobs/${jobId}/context-threads`,
    payload: {
      schema: 'nebula.ai-e2e.authoring-context/1.0',
      businessVersionId: fixture.versionId,
      currentUrl: '/login',
      currentPageDefinitionId: fixture.pageId,
      currentFunctionalModuleId: fixture.module1Id,
      baseRevisionSha256: fixture.module1RevisionSha256,
      visibleScenarioIds: [],
      createdBy: 'user-1',
    },
  });
  return response.json().data.id as string;
}

function amendmentPayload(
  fixture: ReturnType<typeof createFixture>,
  threadId: string,
  candidateRevisionId: string,
  target: { moduleId: string; baseRevisionId: string; baseRevisionSha256: string },
  category = 'acceptance'
) {
  return {
    schema: 'nebula.ai-e2e.authoring-amendment/1.0',
    threadId,
    reason: '结构化候选修改',
    category,
    changes: [
      {
        assetType: 'functional_module',
        assetId: target.moduleId,
        baseRevisionId: target.baseRevisionId,
        baseRevisionSha256: target.baseRevisionSha256,
        candidateRevisionId,
        targetPageDefinitionId: fixture.pageId,
        targetFunctionalModuleId: target.moduleId,
        targetUrl: '/login',
        category,
        diff: { name: '新登录目标' },
      },
    ],
    validationPlan: { checks: ['module-schema', 'login-flow'] },
    createdBy: 'main-agent',
  };
}

function createModuleCandidate(
  assets: SemanticAssetRepository,
  fixture: ReturnType<typeof createFixture>,
  moduleId: string,
  baseRevisionId: string
) {
  return assets.createRevision({
    assetType: 'functional_module',
    assetId: moduleId,
    businessVersionId: fixture.versionId,
    schemaId: 'nebula.ai-e2e.functional-module/1.0',
    payload: {
      schema: 'nebula.ai-e2e.functional-module/1.0',
      name: '新登录目标',
      sortOrder: 0,
      primaryPageDefinitionId: fixture.pageId,
    },
    validationStatus: 'valid',
    changeReason: '结构化候选修改',
    createdByType: 'main_agent',
    supersedesRevisionId: baseRevisionId,
  });
}

function createFixture(db: DatabaseSync, versions: BusinessVersionRepository) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO deployment_profiles (id, project_id, profile_key, name, created_at)
     VALUES ('deployment', 'project-1', 'test', 'Test', ?)`
  ).run(now);
  db.prepare(
    `INSERT INTO deployment_profile_revisions
      (id, deployment_profile_id, revision_no, lifecycle, schema_id, payload_json,
       content_sha256, validation_status, change_reason, created_by_type, created_at)
     VALUES ('deployment-revision', 'deployment', 1, 'current', 'deployment/1', '{}', ?,
       'valid', 'fixture', 'system', ?)`
  ).run(HASH_A, now);
  const version = versions.create({
    projectId: 'project-1',
    versionKey: 'release-1',
    name: 'Release 1',
    createdBy: 'system',
    requestId: 'create-version',
    deploymentRevisionId: 'deployment-revision',
  }).version;
  const page = versions.createPage({
    businessVersionId: version.id,
    pageKey: 'login',
    payload: {
      schema: 'nebula.ai-e2e.page-definition/1.0',
      name: '登录页',
      routeMode: 'path',
      routeTemplate: '/login',
      identityQuery: {},
      runtimeParams: {},
      ignoredQueryKeys: [],
      authRequirement: { kind: 'anonymous' },
      recognition: [],
      allowedTransitionPageIds: [],
    },
    createdBy: 'system',
  });
  const businessModule = versions.createBusinessModule({
    businessVersionId: version.id,
    moduleKey: 'account',
    payload: {
      schema: 'nebula.ai-e2e.business-module/1.0',
      name: '账号',
      sortOrder: 0,
      prdSourceRefs: [],
    },
    createdBy: 'system',
  });
  const module1 = createModule(versions, version.id, businessModule.id, page.id, 'login');
  const module2 = createModule(versions, version.id, businessModule.id, page.id, 'security');
  return {
    versionId: version.id,
    pageId: page.id,
    module1Id: module1.id,
    module1RevisionId: module1.currentRevision.id,
    module1RevisionSha256: module1.currentRevision.contentSha256,
    module2Id: module2.id,
    module2RevisionId: module2.currentRevision.id,
    module2RevisionSha256: module2.currentRevision.contentSha256,
  };
}

function createModule(
  versions: BusinessVersionRepository,
  versionId: string,
  businessModuleId: string,
  pageId: string,
  moduleKey: string
) {
  return versions.createFunctionalModule({
    businessVersionId: versionId,
    businessModuleId,
    moduleKey,
    primaryPageDefinitionId: pageId,
    payload: {
      schema: 'nebula.ai-e2e.functional-module/1.0',
      name: moduleKey,
      sortOrder: 0,
      primaryPageDefinitionId: pageId,
    },
    createdBy: 'system',
  });
}
