import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up as up014 } from '../../../database/migrations/014-semantic-asset-foundation.js';
import { up as up015 } from '../../../database/migrations/015-semantic-asset-governance.js';
import { up as up016 } from '../../../database/migrations/016-semantic-workflow-foundation.js';
import { up as up017 } from '../../../database/migrations/017-semantic-evidence-integration-foundation.js';
import { up as up018 } from '../../../database/migrations/018-authoring-amendments.js';
import { BusinessVersionRepository } from '../../../database/repositories/business-version-repository.js';
import { SemanticQueryRepository } from '../../../database/repositories/semantic-query-repository.js';
import { SemanticWorkflowRepository } from '../../../database/repositories/semantic-workflow-repository.js';
import { SemanticQueryService } from '../../../services/semantic-query-service.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import semanticControlRoutes, { encodeSseEvent } from '../semantic-control.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('semantic control read routes', () => {
  let db: DatabaseSync;
  let app: FastifyInstance;
  let versions: BusinessVersionRepository;
  let workflows: SemanticWorkflowRepository;
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
    versions = new BusinessVersionRepository(db);
    workflows = new SemanticWorkflowRepository(db);
    fixture = createFixture(db, versions);
    const service = new SemanticQueryService(new SemanticQueryRepository(db, versions));
    app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    app.register(errorHandlerPlugin);
    app.register(semanticControlRoutes, { prefix: '/api/v1', service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('negotiates capabilities and projects the browser-centered workspace', async () => {
    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    const workspace = await app.inject({
      method: 'GET',
      url: `/api/v1/business-versions/${fixture.versionId}/workspace`,
      headers: { 'x-correlation-id': 'correlation-1' },
    });

    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toMatchObject({
      data: {
        schema: 'nebula.service-capabilities/1.0',
        service: 'ai-e2e',
        features: { workspaceProjection: true, runCommands: true, snapshotFirstEvents: true },
        limits: { maxActiveBrowserSessions: 1 },
      },
      meta: { requestId: expect.any(String) },
    });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json()).toMatchObject({
      data: {
        schema: 'nebula.ai-e2e.workspace/1.0',
        version: { id: fixture.versionId },
        prdDocuments: [{ documentKey: 'main', rawContent: '# 登录需求' }],
        pages: [{ id: fixture.pageId, pageKey: 'login' }],
        functionalModules: [{ id: fixture.functionalModuleId, moduleKey: 'login' }],
        functionalScripts: [{ id: fixture.scriptId }],
        scenarios: [{ id: fixture.scenarioId }],
      },
      meta: { correlationId: 'correlation-1' },
    });
  });

  it('returns immutable revision history and validates the asset type', async () => {
    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/assets/functional_script/${fixture.scriptId}/revisions`,
    });
    const invalidType = await app.inject({
      method: 'GET',
      url: `/api/v1/assets/arbitrary/${fixture.scriptId}/revisions`,
    });

    expect(history.statusCode).toBe(200);
    expect(history.json().data).toMatchObject({
      assetType: 'functional_script',
      assetId: fixture.scriptId,
      currentRevisionId: fixture.scriptRevisionId,
      revisions: [
        {
          id: fixture.scriptRevisionId,
          lifecycle: 'current',
          payload: { schema: 'nebula.ai-e2e.functional-script/1.0' },
          verifications: [],
          dependencies: [],
        },
      ],
    });
    expect(invalidType.statusCode).toBe(400);
    expect(invalidType.json()).toMatchObject({
      retryable: false,
      correlationId: expect.any(String),
    });
  });

  it('returns authoritative authoring and run snapshots with persistent event logs', async () => {
    const authoring = workflows.createAuthoringJob({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      mode: 'repair',
      idempotencyKey: 'repair-login',
      stage: 'repair_script',
      strategyVersion: 'semantic-v1',
      sourceFingerprint: 'failure-1',
      input: { scriptId: fixture.scriptId },
      createdBy: 'user-1',
    });
    workflows.createAuthoringTask({
      jobId: authoring.id,
      taskKey: 'repair-script',
      type: 'generate_script',
      targetType: 'functional_script',
      targetId: fixture.scriptId,
      inputRedacted: { reason: 'selector changed' },
      toolPolicyHash: HASH_A,
      skillPolicyHash: HASH_B,
      budget: { maxAttempts: 2 },
    });
    const run = workflows.createRun({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      clientRunId: 'verify-repair-login',
      purpose: 'authoring_verification',
      authoringJobId: authoring.id,
      scenarioRevisionId: fixture.scenarioRevisionId,
      deploymentRevisionId: 'deployment-revision',
      sideEffectPolicyVersion: 'policy-v1',
      sideEffectProjection: { environment: 'test', effects: [] },
      planSchemaId: 'nebula.ai-e2e.run-plan/1.0',
      plan: { calls: [] },
      todos: [],
      dependencies: [],
    });

    const authoringSnapshot = await app.inject({
      method: 'GET',
      url: `/api/v1/authoring-jobs/${authoring.id}`,
    });
    const runSnapshot = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}` });
    const eventLog = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${run.id}/event-log?afterSeq=0&limit=1`,
    });

    expect(authoringSnapshot.json()).toMatchObject({
      data: {
        job: { id: authoring.id, lifecycle: 'created' },
        tasks: [{ taskKey: 'repair-script', state: 'ready' }],
        browserJob: { id: authoring.browserJobId, state: 'queued' },
        seq: 2,
      },
      meta: { stateVersion: 1 },
    });
    expect(runSnapshot.json()).toMatchObject({
      data: {
        run: { id: run.id, engine: 'semantic_v1', lifecycle: 'created' },
        plan: { payload: { calls: [] } },
        todos: [],
        browserJob: { id: authoring.browserJobId },
        seq: 1,
      },
      meta: { stateVersion: 1 },
    });
    expect(eventLog.json()).toMatchObject({
      data: { events: [{ seq: 1, type: 'run.created' }], nextAfterSeq: 1 },
    });
  });

  it('uses the v1 problem envelope for missing snapshots', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/runs/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: 'not_found',
      message: "Run 'missing' not found",
      retryable: false,
      correlationId: expect.any(String),
    });
  });

  it('encodes snapshot-first SSE frames with resumable sequence metadata', () => {
    expect(
      encodeSseEvent({
        id: '7',
        event: 'run.snapshot',
        retry: 1_000,
        data: { schema: 'nebula.ai-e2e.snapshot-event/1.0', seq: 7, stateVersion: 3 },
      })
    ).toBe(
      'id: 7\nevent: run.snapshot\nretry: 1000\ndata: {"schema":"nebula.ai-e2e.snapshot-event/1.0","seq":7,"stateVersion":3}\n\n'
    );
  });
});

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
     VALUES ('deployment-revision', 'deployment', 1, 'current',
       'nebula.ai-e2e.deployment-profile/1.0', ?, ?, 'valid', 'fixture', 'system', ?)`
  ).run(
    JSON.stringify({
      schema: 'nebula.ai-e2e.deployment-profile/1.0',
      environment: 'test',
      origin: 'https://example.test',
      allowedOrigins: ['https://example.test'],
    }),
    HASH_A,
    now
  );
  const version = versions.create({
    projectId: 'project-1',
    versionKey: 'release-1',
    name: 'Release 1',
    createdBy: 'system',
    requestId: 'create-version',
    deploymentRevisionId: 'deployment-revision',
  }).version;
  db.prepare(
    `INSERT INTO version_prd_documents
      (id, business_version_id, document_key, format, raw_content, content_sha256,
       parsed_json, is_current, created_at)
     VALUES ('prd-1', ?, 'main', 'markdown', '# 登录需求', ?, ?, 1, ?)`
  ).run(version.id, HASH_B, JSON.stringify({ functionalPoints: ['login.success'] }), now);
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
  const functionalModule = versions.createFunctionalModule({
    businessVersionId: version.id,
    businessModuleId: businessModule.id,
    moduleKey: 'login',
    primaryPageDefinitionId: page.id,
    payload: {
      schema: 'nebula.ai-e2e.functional-module/1.0',
      name: '登录',
      sortOrder: 0,
      primaryPageDefinitionId: page.id,
    },
    createdBy: 'system',
  });
  const script = versions.createFunctionalScript({
    businessVersionId: version.id,
    functionalModuleId: functionalModule.id,
    scriptKey: 'login.success',
    name: '成功登录',
    payload: {
      schema: 'nebula.ai-e2e.functional-script/1.0',
      scriptKey: 'login.success',
      functionalModuleId: functionalModule.id,
      pageScope: { entryPageId: page.id, allowedTransitions: [] },
      steps: [],
    },
    createdBy: 'system',
    readinessStatus: 'verified',
  });
  const scenario = versions.createScenario({
    businessVersionId: version.id,
    scenarioKey: 'login-flow',
    name: '登录流程',
    payload: {
      schema: 'nebula.ai-e2e.scenario/1.0',
      scenarioKey: 'login-flow',
      name: '登录流程',
      purpose: '验证登录',
      prdSourceRefs: [],
      actors: [],
      initialAuth: { kind: 'anonymous' },
      inputs: [],
      finalAcceptance: [],
      calls: [],
      edges: [],
      exports: [],
    },
    createdBy: 'system',
    readinessStatus: 'verified',
  });
  return {
    versionId: version.id,
    pageId: page.id,
    functionalModuleId: functionalModule.id,
    scriptId: script.id,
    scriptRevisionId: script.currentRevision.id,
    scenarioId: scenario.id,
    scenarioRevisionId: scenario.currentRevision.id,
  };
}
