import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up as up014 } from '../../migrations/014-semantic-asset-foundation.js';
import { up as up015 } from '../../migrations/015-semantic-asset-governance.js';
import { up as up016 } from '../../migrations/016-semantic-workflow-foundation.js';
import { up as up017 } from '../../migrations/017-semantic-evidence-integration-foundation.js';
import { up as up018 } from '../../migrations/018-authoring-amendments.js';
import { AuthoringAmendmentRepository } from '../authoring-amendment-repository.js';
import { BusinessVersionRepository } from '../business-version-repository.js';
import { SemanticAssetRepository } from '../semantic-asset-repository.js';
import { SemanticWorkflowRepository } from '../semantic-workflow-repository.js';

const HASH_A = 'a'.repeat(64);

describe('authoring amendment repository', () => {
  let db: DatabaseSync;
  let versions: BusinessVersionRepository;
  let assets: SemanticAssetRepository;
  let amendments: AuthoringAmendmentRepository;
  let fixture: ReturnType<typeof createFixture>;

  beforeEach(() => {
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
    assets = new SemanticAssetRepository(db);
    amendments = new AuthoringAmendmentRepository(db, assets);
    fixture = createFixture(db, versions);
  });

  afterEach(() => db.close());

  it('allows current-module changes and activates the verified candidate at a safe boundary', () => {
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module1Id,
      fixture.module1RevisionId,
      '更新登录验收目标'
    );
    const thread = createThread(amendments, fixture);
    const created = amendments.createAmendment({
      jobId: fixture.jobId,
      threadId: thread.id,
      idempotencyKey: 'amend-current-module',
      reason: '登录页文案和验收目标已变化',
      category: 'acceptance',
      changes: [
        {
          assetType: 'functional_module',
          assetId: fixture.module1Id,
          baseRevisionId: fixture.module1RevisionId,
          baseRevisionSha256: fixture.module1RevisionSha256,
          candidateRevisionId: candidate.id,
          targetPageDefinitionId: fixture.page1Id,
          targetFunctionalModuleId: fixture.module1Id,
          targetUrl: '/login',
          category: 'acceptance',
          diff: { acceptance: { from: '旧', to: '新' } },
        },
      ],
      validationPlan: { checks: ['module-schema', 'login-flow'] },
      createdBy: 'main-agent',
    });

    expect(created.amendment.state).toBe('candidate_ready');
    expect(created.amendment.decisionIds).toEqual([]);
    expect(amendments.queueAtSafeBoundary(created.amendment.id).state).toBe('verifying');
    expect(amendments.activate(created.amendment.id).state).toBe('activated');
    expect(
      db
        .prepare(
          `SELECT id FROM semantic_functional_module_revisions
           WHERE functional_module_id = ? AND lifecycle = 'current'`
        )
        .get(fixture.module1Id)
    ).toEqual({ id: candidate.id });
  });

  it('requires a decision for another module on the same URL and preserves current on rejection', () => {
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module2Id,
      fixture.module2RevisionId,
      '重排同页安全模块'
    );
    const thread = createThread(amendments, fixture);
    const created = amendments.createAmendment({
      jobId: fixture.jobId,
      threadId: thread.id,
      idempotencyKey: 'amend-other-module',
      reason: '建议调整同页其他模块',
      category: 'module_call',
      changes: [
        {
          assetType: 'functional_module',
          assetId: fixture.module2Id,
          baseRevisionId: fixture.module2RevisionId,
          baseRevisionSha256: fixture.module2RevisionSha256,
          candidateRevisionId: candidate.id,
          targetPageDefinitionId: fixture.page1Id,
          targetFunctionalModuleId: fixture.module2Id,
          targetUrl: '/login',
          category: 'module_call',
          diff: { order: { from: 2, to: 1 } },
        },
      ],
      validationPlan: { checks: ['same-page-regression'] },
      createdBy: 'main-agent',
    });

    expect(created.amendment.state).toBe('waiting_decision');
    expect(created.amendment.decisions[0]).toMatchObject({
      scopeKind: 'same_page_other_module',
      status: 'open',
      impact: {
        affectedFunctionalModuleIds: [fixture.module2Id],
        validationPlan: { checks: ['same-page-regression'] },
      },
    });
    const rejected = amendments.answerDecision({
      amendmentId: created.amendment.id,
      decisionId: created.amendment.decisionIds[0],
      answer: 'reject',
      reason: '不允许修改安全模块',
      answeredBy: 'user-1',
    });
    expect(rejected.state).toBe('rejected');
    expect(
      db
        .prepare(
          `SELECT id FROM semantic_functional_module_revisions
           WHERE functional_module_id = ? AND lifecycle = 'current'`
        )
        .get(fixture.module2Id)
    ).toEqual({ id: fixture.module2RevisionId });
  });

  it('requires cross-URL approval and queues behind an active browser operation', () => {
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module3Id,
      fixture.module3RevisionId,
      '更新仪表盘模块调用'
    );
    const thread = createThread(amendments, fixture);
    const created = amendments.createAmendment({
      jobId: fixture.jobId,
      threadId: thread.id,
      idempotencyKey: 'amend-cross-url',
      reason: '登录成功后需要调整仪表盘检查',
      category: 'module_call',
      changes: [
        {
          assetType: 'functional_module',
          assetId: fixture.module3Id,
          baseRevisionId: fixture.module3RevisionId,
          baseRevisionSha256: fixture.module3RevisionSha256,
          candidateRevisionId: candidate.id,
          targetPageDefinitionId: fixture.page2Id,
          targetFunctionalModuleId: fixture.module3Id,
          targetUrl: '/dashboard',
          category: 'module_call',
          diff: { calls: { add: ['dashboard.loaded'] } },
        },
      ],
      validationPlan: { checks: ['login', 'dashboard'] },
      potentialSideEffects: { navigation: ['/dashboard'] },
      createdBy: 'main-agent',
    });
    expect(created.amendment.decisions[0]).toMatchObject({ scopeKind: 'cross_url' });
    expect(
      amendments.answerDecision({
        amendmentId: created.amendment.id,
        decisionId: created.amendment.decisionIds[0],
        answer: 'approve',
        reason: '批准跨 URL 验证',
        answeredBy: 'user-1',
      }).state
    ).toBe('candidate_ready');
    db.prepare(
      `INSERT INTO external_task_links
        (id, context_type, context_id, authoring_job_id, service, kind,
         external_id, external_state, created_at)
       VALUES ('operation-link', 'authoring', ?, ?, 'proxy_adapter', 'browser_operation',
         'operation-1', 'started', ?)`
    ).run(fixture.jobId, fixture.jobId, new Date().toISOString());

    expect(amendments.queueAtSafeBoundary(created.amendment.id).state).toBe(
      'queued_at_safe_boundary'
    );
    expect(() => amendments.beginQueuedVerification(created.amendment.id)).toThrow('safe boundary');
    db.prepare(
      "UPDATE external_task_links SET external_state = 'succeeded' WHERE id = 'operation-link'"
    ).run();
    expect(amendments.beginQueuedVerification(created.amendment.id).state).toBe('verifying');
  });

  it('marks old candidates stale when module context changes and blocks applying them', () => {
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module1Id,
      fixture.module1RevisionId,
      '旧上下文候选'
    );
    const thread = createThread(amendments, fixture);
    const created = amendments.createAmendment({
      jobId: fixture.jobId,
      threadId: thread.id,
      idempotencyKey: 'stale-on-switch',
      reason: '旧模块候选',
      category: 'repair',
      changes: [
        {
          assetType: 'functional_module',
          assetId: fixture.module1Id,
          baseRevisionId: fixture.module1RevisionId,
          baseRevisionSha256: fixture.module1RevisionSha256,
          candidateRevisionId: candidate.id,
          targetPageDefinitionId: fixture.page1Id,
          targetFunctionalModuleId: fixture.module1Id,
          targetUrl: '/login',
          category: 'repair',
          diff: { selector: 'new' },
        },
      ],
      validationPlan: { checks: ['login'] },
      createdBy: 'main-agent',
    });
    amendments.createContextThread({
      jobId: fixture.jobId,
      businessVersionId: fixture.versionId,
      scope: {
        currentUrl: '/dashboard',
        currentPageDefinitionId: fixture.page2Id,
        currentFunctionalModuleId: fixture.module3Id,
        baseRevisionSha256: fixture.module3RevisionSha256,
        visibleScenarioIds: [],
      },
      createdBy: 'user-1',
    });

    expect(amendments.getAmendment(created.amendment.id)).toMatchObject({
      state: 'stale',
      staleReason: { code: 'context_changed' },
    });
    expect(() => amendments.queueAtSafeBoundary(created.amendment.id)).toThrow('ready candidate');
  });

  it('rejects a forged target module instead of trusting the candidate scope declaration', () => {
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module2Id,
      fixture.module2RevisionId,
      '伪造归属候选'
    );
    const thread = createThread(amendments, fixture);

    expect(() =>
      amendments.createAmendment({
        jobId: fixture.jobId,
        threadId: thread.id,
        idempotencyKey: 'forged-module-scope',
        reason: '尝试把其他模块伪装成当前模块',
        category: 'module_call',
        changes: [
          {
            assetType: 'functional_module',
            assetId: fixture.module2Id,
            baseRevisionId: fixture.module2RevisionId,
            baseRevisionSha256: fixture.module2RevisionSha256,
            candidateRevisionId: candidate.id,
            targetPageDefinitionId: fixture.page1Id,
            targetFunctionalModuleId: fixture.module1Id,
            targetUrl: '/login',
            category: 'module_call',
            diff: { order: 1 },
          },
        ],
        validationPlan: { checks: ['ownership'] },
        createdBy: 'main-agent',
      })
    ).toThrow('does not match the asset owner');
    expect(db.prepare('SELECT COUNT(*) AS count FROM authoring_amendments').get()).toEqual({
      count: 0,
    });
  });

  it('keeps every current revision unchanged when atomic activation validation fails', () => {
    const moduleCandidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module1Id,
      fixture.module1RevisionId,
      '模块候选'
    );
    const scriptCandidate = assets.createRevision({
      assetType: 'functional_script',
      assetId: fixture.scriptId,
      businessVersionId: fixture.versionId,
      schemaId: 'nebula.ai-e2e.functional-script/1.0',
      payload: {
        schema: 'nebula.ai-e2e.functional-script/1.0',
        scriptKey: 'login.success',
        functionalModuleId: fixture.module1Id,
        pageScope: { entryPageId: fixture.page1Id, allowedTransitions: [] },
        steps: [{ action: 'click', target: 'submit' }],
      },
      validationStatus: 'valid',
      changeReason: '未验证脚本候选',
      createdByType: 'child_agent',
      supersedesRevisionId: fixture.scriptRevisionId,
      primaryPageRevisionId: fixture.page1RevisionId,
      changeKind: 'ai_repair',
    });

    expect(() =>
      assets.activateRevisions([
        {
          assetType: 'functional_module',
          revisionId: moduleCandidate.id,
          dependencies: [],
        },
        {
          assetType: 'functional_script',
          revisionId: scriptCandidate.id,
          verificationScopeSha256: HASH_A,
          dependencyClosureSha256: HASH_A,
          dependencies: [],
        },
      ])
    ).toThrow('No verified record');
    expect(
      db
        .prepare(
          `SELECT id FROM semantic_functional_module_revisions
           WHERE functional_module_id = ? AND lifecycle = 'current'`
        )
        .get(fixture.module1Id)
    ).toEqual({ id: fixture.module1RevisionId });
  });
});

function createThread(
  amendments: AuthoringAmendmentRepository,
  fixture: ReturnType<typeof createFixture>
) {
  return amendments.createContextThread({
    jobId: fixture.jobId,
    businessVersionId: fixture.versionId,
    scope: {
      currentUrl: '/login',
      currentPageDefinitionId: fixture.page1Id,
      currentFunctionalModuleId: fixture.module1Id,
      baseRevisionSha256: fixture.module1RevisionSha256,
      visibleScenarioIds: [],
    },
    createdBy: 'user-1',
  });
}

function createModuleCandidate(
  assets: SemanticAssetRepository,
  fixture: ReturnType<typeof createFixture>,
  moduleId: string,
  baseRevisionId: string,
  reason: string
) {
  return assets.createRevision({
    assetType: 'functional_module',
    assetId: moduleId,
    businessVersionId: fixture.versionId,
    schemaId: 'nebula.ai-e2e.functional-module/1.0',
    payload: {
      schema: 'nebula.ai-e2e.functional-module/1.0',
      name: reason,
      sortOrder: 1,
      primaryPageDefinitionId: moduleId === fixture.module3Id ? fixture.page2Id : fixture.page1Id,
    },
    validationStatus: 'valid',
    changeReason: reason,
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
  const page1 = createPage(versions, version.id, 'login', '/login');
  const page2 = createPage(versions, version.id, 'dashboard', '/dashboard');
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
  const module1 = createModule(versions, version.id, businessModule.id, page1.id, 'login');
  const module2 = createModule(versions, version.id, businessModule.id, page1.id, 'security');
  const module3 = createModule(versions, version.id, businessModule.id, page2.id, 'dashboard');
  const script = versions.createFunctionalScript({
    businessVersionId: version.id,
    functionalModuleId: module1.id,
    scriptKey: 'login.success',
    name: '成功登录',
    payload: {
      schema: 'nebula.ai-e2e.functional-script/1.0',
      scriptKey: 'login.success',
      functionalModuleId: module1.id,
      pageScope: { entryPageId: page1.id, allowedTransitions: [] },
      steps: [],
    },
    createdBy: 'system',
    readinessStatus: 'verified',
  });
  const workflow = new SemanticWorkflowRepository(db);
  const job = workflow.createAuthoringJob({
    projectId: 'project-1',
    businessVersionId: version.id,
    mode: 'repair',
    idempotencyKey: 'repair-job',
    stage: 'impact_analysis',
    strategyVersion: 'semantic-v1',
    sourceFingerprint: 'fixture',
    input: { reason: 'fixture' },
    createdBy: 'user-1',
  });
  return {
    versionId: version.id,
    jobId: job.id,
    page1Id: page1.id,
    page1RevisionId: page1.currentRevision.id,
    page2Id: page2.id,
    module1Id: module1.id,
    module1RevisionId: module1.currentRevision.id,
    module1RevisionSha256: module1.currentRevision.contentSha256,
    module2Id: module2.id,
    module2RevisionId: module2.currentRevision.id,
    module2RevisionSha256: module2.currentRevision.contentSha256,
    module3Id: module3.id,
    module3RevisionId: module3.currentRevision.id,
    module3RevisionSha256: module3.currentRevision.contentSha256,
    scriptId: script.id,
    scriptRevisionId: script.currentRevision.id,
  };
}

function createPage(
  versions: BusinessVersionRepository,
  versionId: string,
  pageKey: string,
  routeTemplate: string
) {
  return versions.createPage({
    businessVersionId: versionId,
    pageKey,
    payload: {
      schema: 'nebula.ai-e2e.page-definition/1.0',
      name: pageKey,
      routeMode: 'path',
      routeTemplate,
      identityQuery: {},
      runtimeParams: {},
      ignoredQueryKeys: [],
      authRequirement: { kind: 'anonymous' },
      recognition: [],
      allowedTransitionPageIds: [],
    },
    createdBy: 'system',
  });
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
