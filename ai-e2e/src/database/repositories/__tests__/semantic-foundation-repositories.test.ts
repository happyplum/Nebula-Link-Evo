import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up as up014 } from '../../migrations/014-semantic-asset-foundation.js';
import { up as up015 } from '../../migrations/015-semantic-asset-governance.js';
import { up as up016 } from '../../migrations/016-semantic-workflow-foundation.js';
import { up as up017 } from '../../migrations/017-semantic-evidence-integration-foundation.js';
import { BusinessVersionRepository } from '../business-version-repository.js';
import { SemanticAssetRepository } from '../semantic-asset-repository.js';
import { SemanticEvidenceRepository } from '../semantic-evidence-repository.js';
import { hashValue } from '../semantic-repository-utils.js';
import { SemanticWorkflowRepository } from '../semantic-workflow-repository.js';
import { functionalScriptFixture } from '../../../test-support/functional-script-fixture.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('semantic v1 data foundation repositories', () => {
  let db: DatabaseSync;
  let versions: BusinessVersionRepository;
  let assets: SemanticAssetRepository;
  let workflows: SemanticWorkflowRepository;
  let evidence: SemanticEvidenceRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'Project')").run();
    up014(db);
    up015(db);
    up016(db);
    up017(db);
    versions = new BusinessVersionRepository(db);
    assets = new SemanticAssetRepository(db);
    workflows = new SemanticWorkflowRepository(db);
    evidence = new SemanticEvidenceRepository(db);
  });

  afterEach(() => db.close());

  it('activates a verified executable revision and invalidates the exact version validation atomically', () => {
    const fixture = createFixture(db, versions);
    const authoring = workflows.createAuthoringJob({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      mode: 'repair',
      idempotencyKey: 'repair-1',
      stage: 'repair_script',
      strategyVersion: 'semantic-v1',
      sourceFingerprint: 'source-1',
      input: { scriptId: fixture.scriptId },
      createdBy: 'main-agent',
    });
    const verificationRun = workflows.createRun({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      clientRunId: 'authoring-verification-1',
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
    expect(verificationRun.browserJobId).toBe(authoring.browserJobId);
    expect(db.prepare('SELECT COUNT(*) AS count FROM browser_jobs').get()).toEqual({ count: 1 });
    const task = workflows.createAuthoringTask({
      jobId: authoring.id,
      taskKey: 'repair-script',
      type: 'generate_script',
      targetType: 'functional_script',
      targetId: fixture.scriptId,
      inputRedacted: { failedStep: 'submit' },
      toolPolicyHash: HASH_A,
      skillPolicyHash: HASH_B,
      budget: { maxAttempts: 2 },
    });
    expect(
      workflows.createAuthoringTask({
        jobId: authoring.id,
        taskKey: 'repair-script',
        type: 'generate_script',
        targetType: 'functional_script',
        targetId: fixture.scriptId,
        inputRedacted: { failedStep: 'submit' },
        toolPolicyHash: HASH_A,
        skillPolicyHash: HASH_B,
        budget: { maxAttempts: 2 },
      })
    ).toEqual({ id: task.id, created: false });
    workflows.startAuthoringTask(task.id);
    expect(
      workflows.completeAuthoringAttempt({
        taskId: task.id,
        status: 'succeeded',
        agentTaskId: 'agent-task-1',
        result: { candidate: 'ready' },
        startedAt: new Date().toISOString(),
      })
    ).toMatchObject({ attemptNo: 1 });
    expect(
      workflows.acceptAuthoringCommand({
        id: 'authoring-pause-1',
        jobId: authoring.id,
        type: 'pause',
        expectedStateVersion: 3,
        createdBy: 'main-agent',
      })
    ).toEqual({ status: 'accepted', replayed: false, stateVersion: 3 });
    expect(workflows.applyAuthoringTransition('authoring-pause-1', 'paused')).toEqual({
      lifecycle: 'paused',
      stateVersion: 4,
    });
    assets.recordBusinessVersionValidation({
      businessVersionId: fixture.versionId,
      deploymentRevisionId: 'deployment-revision',
      assetGraphSha256: HASH_A,
      verificationScope: { locale: 'zh-CN', viewport: 'desktop' },
      status: 'valid',
      authoringJobId: authoring.id,
    });
    const revision = assets.createRevision({
      assetType: 'functional_script',
      assetId: fixture.scriptId,
      businessVersionId: fixture.versionId,
      schemaId: 'nebula.ai-e2e.functional-script/1.0',
      payload: functionalScriptFixture({
        scriptKey: 'login.success',
        name: '成功登录',
        moduleId: fixture.functionalModuleId,
        pageId: fixture.pageId,
      }),
      validationStatus: 'valid',
      changeReason: 'repair selector',
      createdByType: 'child_agent',
      createdById: 'child-1',
      supersedesRevisionId: fixture.scriptRevisionId,
      primaryPageRevisionId: fixture.pageRevisionId,
      changeKind: 'ai_repair',
    });
    const verificationScope = { locale: 'zh-CN', viewport: 'desktop' };
    const verification = assets.recordVerification({
      businessVersionId: fixture.versionId,
      assetType: 'functional_script',
      assetId: fixture.scriptId,
      assetRevisionId: revision.id,
      deploymentRevisionId: 'deployment-revision',
      verificationScope,
      dependencyClosureSha256: HASH_B,
      status: 'verified',
      authoringJobId: authoring.id,
    });
    expect(
      assets.recordVerification({
        id: verification.id,
        businessVersionId: fixture.versionId,
        assetType: 'functional_script',
        assetId: fixture.scriptId,
        assetRevisionId: revision.id,
        deploymentRevisionId: 'deployment-revision',
        verificationScope,
        dependencyClosureSha256: HASH_B,
        status: 'verified',
        authoringJobId: authoring.id,
      })
    ).toEqual({ id: verification.id, created: false });

    expect(
      assets.activateRevision({
        assetType: 'functional_script',
        revisionId: revision.id,
        verificationScopeSha256: hashValue(verificationScope),
        dependencyClosureSha256: HASH_B,
        dependencies: [
          {
            toAssetType: 'page_definition',
            toAssetId: fixture.pageId,
            toRevisionId: fixture.pageRevisionId,
            relation: 'page_scope',
            sourcePointer: '/pageScope/entryPageId',
          },
        ],
        authoringJobId: authoring.id,
      })
    ).toEqual({ activated: true });

    const current = db
      .prepare(
        `SELECT id, lifecycle, readiness_status FROM functional_script_revisions
         WHERE functional_script_id = ? ORDER BY revision_no`
      )
      .all(fixture.scriptId);
    expect(current).toEqual([
      expect.objectContaining({ id: fixture.scriptRevisionId, lifecycle: 'superseded' }),
      expect.objectContaining({
        id: revision.id,
        lifecycle: 'current',
        readiness_status: 'verified',
      }),
    ]);
    expect(
      db
        .prepare(
          `SELECT status FROM business_version_validations
           WHERE business_version_id = ? AND is_current = 1`
        )
        .get(fixture.versionId)
    ).toEqual({ status: 'needs_recheck' });
    expect(versions.findById(fixture.versionId)?.validationStatus).toBe('needs_recheck');
    expect(workflows.listAuthoringEvents(authoring.id)).toHaveLength(6);
    expect(db.prepare('SELECT COUNT(*) AS count FROM asset_revision_dependencies').get()).toEqual({
      count: 1,
    });
    expect(
      assets.activateRevision({
        assetType: 'functional_script',
        revisionId: revision.id,
        verificationScopeSha256: hashValue(verificationScope),
        dependencyClosureSha256: HASH_B,
        dependencies: [],
      })
    ).toEqual({ activated: false });
  });

  it('freezes a formal run graph and applies idempotent optimistic commands with ordered events', () => {
    const fixture = createFixture(db, versions);
    const verificationScope = { locale: 'zh-CN', viewport: 'desktop' };
    assets.recordBusinessVersionValidation({
      businessVersionId: fixture.versionId,
      deploymentRevisionId: 'deployment-revision',
      assetGraphSha256: HASH_A,
      verificationScope,
      status: 'valid',
    });
    const input = {
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      clientRunId: 'client-run-1',
      purpose: 'formal' as const,
      scenarioRevisionId: fixture.scenarioRevisionId,
      deploymentRevisionId: 'deployment-revision',
      assetGraphSha256: HASH_A,
      verificationScopeSha256: hashValue(verificationScope),
      sideEffectPolicyVersion: 'policy-v1',
      sideEffectProjection: { environment: 'test', creates: ['user'] },
      planSchemaId: 'nebula.ai-e2e.run-plan/1.0',
      plan: { calls: ['create-user', 'delete-user'] },
      todos: [
        {
          todoKey: 'create-user',
          originCallKey: 'create-user',
          functionalScriptRevisionId: fixture.scriptRevisionId,
          pageDefinitionRevisionId: fixture.pageRevisionId,
          inputRedacted: { name: 'e2e-user' },
          authContext: { kind: 'authenticated', actorKey: 'admin' },
        },
        {
          todoKey: 'delete-user',
          originCallKey: 'delete-user',
          functionalScriptRevisionId: fixture.scriptRevisionId,
          pageDefinitionRevisionId: fixture.pageRevisionId,
          inputRedacted: { userIdFrom: 'create-user.userId' },
          authContext: { kind: 'authenticated', actorKey: 'admin' },
        },
      ],
      dependencies: [
        {
          fromTodoKey: 'create-user',
          toTodoKey: 'delete-user',
          mode: 'requires_success' as const,
          requiresOutputs: ['userId'],
        },
      ],
      initialVariables: [
        {
          namespace: 'auth',
          name: 'adminPassword',
          type: 'string',
          sensitivity: 'secret' as const,
          secretRef: 'vault://e2e/admin-password',
        },
      ],
    };
    expect(() =>
      workflows.createRun({
        ...input,
        clientRunId: 'client-run-cycle',
        dependencies: [
          ...input.dependencies,
          {
            fromTodoKey: 'delete-user',
            toTodoKey: 'create-user',
            mode: 'requires_completion' as const,
          },
        ],
      })
    ).toThrow('acyclic');
    expect(db.prepare('SELECT COUNT(*) AS count FROM test_runs').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM browser_jobs').get()).toEqual({ count: 0 });
    const run = workflows.createRun(input);
    const replay = workflows.createRun(input);
    expect(replay).toEqual({ ...run, created: false });
    expect(workflows.claimNextBrowserJob()).toMatchObject({
      id: run.browserJobId,
      root_context_id: run.id,
      state: 'acquiring',
    });
    expect(workflows.claimNextBrowserJob()).toBeNull();
    workflows.transitionBrowserJob(run.browserJobId, 'active', {
      browserSessionId: 'browser-session-1',
      capabilitySnapshotSha256: HASH_B,
    });
    workflows.transitionBrowserJob(run.browserJobId, 'releasing');
    workflows.transitionBrowserJob(run.browserJobId, 'completed');
    expect(
      db
        .prepare('SELECT todo_key, state FROM run_todos WHERE run_id = ? ORDER BY todo_key')
        .all(run.id)
    ).toEqual([
      { todo_key: 'create-user', state: 'ready' },
      { todo_key: 'delete-user', state: 'waiting_dependencies' },
    ]);
    expect(
      db.prepare('SELECT value_json, secret_ref FROM run_variables WHERE run_id = ?').get(run.id)
    ).toEqual({ value_json: null, secret_ref: 'vault://e2e/admin-password' });
    expect(() =>
      db.prepare("UPDATE run_plans SET payload_json = '{}' WHERE run_id = ?").run(run.id)
    ).toThrow('run plan is immutable');

    const accepted = workflows.acceptRunCommand({
      id: 'run-command-1',
      runId: run.id,
      type: 'start',
      expectedStateVersion: 1,
      createdBy: 'main-agent',
    });
    expect(accepted).toEqual({ status: 'accepted', replayed: false, stateVersion: 1 });
    expect(
      workflows.acceptRunCommand({
        id: 'run-command-1',
        runId: run.id,
        type: 'start',
        expectedStateVersion: 1,
        createdBy: 'main-agent',
      })
    ).toEqual({ status: 'accepted', replayed: true, stateVersion: 1 });
    expect(workflows.applyRunTransition('run-command-1', 'planning')).toEqual({
      lifecycle: 'planning',
      stateVersion: 2,
    });
    expect(
      workflows.acceptRunCommand({
        id: 'run-command-stale',
        runId: run.id,
        type: 'pause',
        expectedStateVersion: 1,
        createdBy: 'main-agent',
      })
    ).toEqual({ status: 'rejected', replayed: false, stateVersion: 2 });
    expect(workflows.listRunEvents(run.id)).toMatchObject([
      { seq: 1, type: 'run.created', state_version: 1 },
      { seq: 2, type: 'run.state_changed', state_version: 2 },
      { seq: 3, type: 'run.command_rejected', state_version: 2 },
    ]);
  });

  it('seals evidence and persists policy/outbox/external reconciliation without inline secrets', () => {
    const fixture = createFixture(db, versions);
    const authoring = workflows.createAuthoringJob({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      mode: 'bootstrap',
      idempotencyKey: 'bootstrap-1',
      stage: 'discover',
      strategyVersion: 'semantic-v1',
      sourceFingerprint: 'prd-1',
      input: { prdRef: 'prd://1' },
      createdBy: 'main-agent',
    });
    const artifact = evidence.registerArtifact({
      sha256: HASH_A,
      sizeBytes: 1024,
      mediaType: 'application/json',
      storageBackend: 'local',
      storageKey: 'artifacts/dom-1.json',
      sensitivity: 'sensitive',
      redactionStatus: 'redacted',
    });
    expect(
      evidence.registerArtifact({
        sha256: HASH_A,
        sizeBytes: 1024,
        mediaType: 'application/json',
        storageBackend: 'local',
        storageKey: 'artifacts/dom-1.json',
        sensitivity: 'sensitive',
        redactionStatus: 'redacted',
      })
    ).toEqual({ id: artifact.id, created: false });
    const manifest = evidence.createManifest({
      context: { type: 'authoring', id: authoring.id },
      schemaId: 'nebula.ai-e2e.evidence-manifest/1.0',
      retentionClass: 'failure_30d',
    });
    evidence.addItem({
      manifestId: manifest.id,
      itemType: 'dom_snapshot',
      artifactObjectId: artifact.id,
      sourceService: 'proxy-adapter',
      redactionStatus: 'redacted',
      integritySha256: HASH_A,
      metadata: { captureId: 'capture-1' },
    });
    const sealed = evidence.sealManifest(manifest.id, 'complete', { reason: 'page analyzed' });
    expect(sealed.sealed).toBe(true);
    expect(sealed.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.sealManifest(manifest.id, 'complete')).toEqual({
      manifestSha256: sealed.manifestSha256,
      sealed: false,
    });
    expect(() => evidence.sealManifest(manifest.id, 'failed')).toThrow('changed completeness');
    expect(() =>
      evidence.addItem({
        manifestId: manifest.id,
        itemType: 'agent_audit',
        inline: { status: 'late' },
        sourceService: 'ai-e2e',
        redactionStatus: 'not_required',
        integritySha256: HASH_B,
        metadata: {},
      })
    ).toThrow('immutable');
    expect(
      db.prepare('SELECT ref_count FROM artifact_objects WHERE id = ?').get(artifact.id)
    ).toEqual({ ref_count: 1 });

    const policy = evidence.recordPolicyEvaluation({
      context: { type: 'authoring', id: authoring.id },
      businessVersionId: fixture.versionId,
      deploymentRevisionId: 'deployment-revision',
      policyVersion: 'policy-v1',
      sourcePlanSha256: HASH_A,
      projectionRedacted: { creates: ['user'], deletes: ['user'] },
      result: 'auto_allowed',
      reasonCodes: ['test_environment'],
    });
    expect(
      evidence.recordPolicyEvaluation({
        context: { type: 'authoring', id: authoring.id },
        businessVersionId: fixture.versionId,
        deploymentRevisionId: 'deployment-revision',
        policyVersion: 'policy-v1',
        sourcePlanSha256: HASH_A,
        projectionRedacted: { creates: ['user'], deletes: ['user'] },
        result: 'auto_allowed',
        reasonCodes: ['test_environment'],
      })
    ).toEqual({ id: policy.id, created: false });

    expect(
      evidence.enqueueOutbox({
        id: 'outbox-1',
        context: { type: 'authoring', id: authoring.id },
        targetService: 'proxy_adapter',
        commandType: 'browser.capture',
        endpointOrTool: 'browser-control.capture',
        payloadRedacted: { mode: 'dom_and_screenshot' },
        secretBindingRef: 'secret-binding://browser-lease',
      })
    ).toEqual({ created: true });
    expect(
      evidence.enqueueOutbox({
        id: 'outbox-1',
        context: { type: 'authoring', id: authoring.id },
        targetService: 'proxy_adapter',
        commandType: 'browser.capture',
        endpointOrTool: 'browser-control.capture',
        payloadRedacted: { mode: 'dom_and_screenshot' },
        secretBindingRef: 'secret-binding://browser-lease',
      })
    ).toEqual({ created: false });
    expect(evidence.claimNextOutbox()).toMatchObject({ id: 'outbox-1', status: 'dispatching' });
    evidence.settleOutbox('outbox-1', 'confirmed', { resultRef: 'capture-1' });
    expect(evidence.claimNextOutbox()).toBeNull();

    const external = evidence.linkExternalTask({
      context: { type: 'authoring', id: authoring.id },
      service: 'proxy_adapter',
      kind: 'browser_operation',
      externalId: 'operation-1',
      externalState: 'started',
      lastExternalSeq: 1,
      requestSha256: HASH_A,
      tokenHash: HASH_B,
      secretRef: 'vault://lease-token',
    });
    expect(
      evidence.linkExternalTask({
        context: { type: 'authoring', id: authoring.id },
        service: 'proxy_adapter',
        kind: 'browser_operation',
        externalId: 'operation-1',
        externalState: 'completed',
        lastExternalSeq: 2,
        resultSha256: HASH_B,
        resultRef: 'capture-1',
        terminal: true,
      })
    ).toEqual({ id: external.id, created: false });
    expect(() =>
      evidence.linkExternalTask({
        context: { type: 'authoring', id: authoring.id },
        service: 'proxy_adapter',
        kind: 'browser_operation',
        externalId: 'operation-1',
        externalState: 'started',
        lastExternalSeq: 2,
      })
    ).toThrow('same sequence');
    expect(() =>
      evidence.enqueueOutbox({
        id: 'outbox-secret',
        context: { type: 'authoring', id: authoring.id },
        targetService: 'ai_chat_service',
        commandType: 'agent.start',
        endpointOrTool: '/agent-tasks',
        payloadRedacted: { apiToken: 'raw-token' },
      })
    ).toThrow('Inline secret-like value');
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
    payload: functionalScriptFixture({
      scriptKey: 'login.success',
      name: '成功登录',
      moduleId: functionalModule.id,
      pageId: page.id,
    }),
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
    pageRevisionId: page.currentRevision.id,
    functionalModuleId: functionalModule.id,
    scriptId: script.id,
    scriptRevisionId: script.currentRevision.id,
    scenarioRevisionId: scenario.currentRevision.id,
  };
}
