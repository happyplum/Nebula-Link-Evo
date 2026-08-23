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
import { SemanticRunControlRepository } from '../semantic-run-control-repository.js';
import { SemanticWorkflowRepository } from '../semantic-workflow-repository.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('semantic run control repository', () => {
  let db: DatabaseSync;
  let assets: SemanticAssetRepository;
  let workflows: SemanticWorkflowRepository;
  let runs: SemanticRunControlRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'Project')").run();
    up014(db);
    up015(db);
    up016(db);
    up017(db);
    assets = new SemanticAssetRepository(db);
    workflows = new SemanticWorkflowRepository(db);
    runs = new SemanticRunControlRepository(db, workflows, new SemanticEvidenceRepository(db));
  });

  afterEach(() => db.close());

  it('freezes verified scenario calls and unlocks dependent TODOs after success', () => {
    const fixture = createFixture(db, assets, 'test');
    const created = runs.createFormalRun(runInput(fixture, 'run-success'));

    expect(created).toMatchObject({ lifecycle: 'ready', admission: 'ready', stateVersion: 2 });
    expect(workflows.claimNextBrowserJob()).toMatchObject({ root_context_id: created.id });
    expect(
      db
        .prepare('SELECT todo_key, state FROM run_todos WHERE run_id = ? ORDER BY todo_key')
        .all(created.id)
    ).toEqual([
      { todo_key: 'first', state: 'ready' },
      { todo_key: 'second', state: 'waiting_dependencies' },
    ]);

    runs.command({
      commandId: 'start-success',
      runId: created.id,
      action: 'start',
      expectedStateVersion: 2,
      createdBy: 'operator',
    });
    const firstTodo = getTodo(db, created.id, 'first');
    const task = startTodo(runs, created.id, firstTodo.id);
    expect(
      runs.completeTodoAttempt({
        runId: created.id,
        todoId: firstTodo.id,
        pageTaskId: task.pageTaskId,
        result: 'succeeded',
        reasonClass: 'acceptance_passed',
        agentTaskId: 'agent-first',
        startedAt: new Date().toISOString(),
        confirmedOutputs: { accountId: 'account-1' },
      })
    ).toMatchObject({ todoState: 'passed', runLifecycle: 'running' });
    expect(getTodo(db, created.id, 'second').state).toBe('ready');

    const secondTodo = getTodo(db, created.id, 'second');
    const secondTask = startTodo(runs, created.id, secondTodo.id);
    expect(
      runs.completeTodoAttempt({
        runId: created.id,
        todoId: secondTodo.id,
        pageTaskId: secondTask.pageTaskId,
        result: 'succeeded',
        reasonClass: 'acceptance_passed',
        agentTaskId: 'agent-second',
        startedAt: new Date().toISOString(),
      })
    ).toMatchObject({ todoState: 'passed', runLifecycle: 'completed' });
    expect(
      db.prepare('SELECT lifecycle, outcome FROM test_runs WHERE id = ?').get(created.id)
    ).toEqual({
      lifecycle: 'completed',
      outcome: 'passed',
    });
  });

  it('requires staging approval before the browser FIFO can acquire a high-risk run', () => {
    const fixture = createFixture(db, assets, 'staging', { kind: 'delete', irreversible: true });
    const created = runs.createFormalRun(runInput(fixture, 'run-staging'));

    expect(created).toMatchObject({ lifecycle: 'paused', admission: 'approval_required' });
    expect(created.decisionId).toBeTruthy();
    expect(workflows.claimNextBrowserJob()).toBeNull();
    expect(
      runs.answerDecision({
        runId: created.id,
        decisionId: created.decisionId!,
        answerKey: 'approve',
        reason: '隔离测试数据已确认',
        answeredBy: 'operator',
      })
    ).toEqual({ decisionStatus: 'applied' });
    expect(workflows.claimNextBrowserJob()).toMatchObject({ root_context_id: created.id });
    expect(
      db
        .prepare('SELECT status, approved_by FROM side_effect_approval_grants WHERE context_id = ?')
        .get(created.id)
    ).toEqual({ status: 'active', approved_by: 'operator' });
  });

  it('denies production business writes and leaves no acquirable browser job', () => {
    const fixture = createFixture(db, assets, 'production', { kind: 'submit' });
    const created = runs.createFormalRun(runInput(fixture, 'run-production'));

    expect(created).toMatchObject({ lifecycle: 'cancelled', admission: 'denied' });
    expect(workflows.claimNextBrowserJob()).toBeNull();
    expect(
      db.prepare('SELECT state FROM browser_jobs WHERE id = ?').get(created.browserJobId)
    ).toEqual({
      state: 'cancelled',
    });
  });

  it('propagates dependency skips only from terminal failure', () => {
    const fixture = createFixture(db, assets, 'test');
    const created = runs.createFormalRun(runInput(fixture, 'run-failed'));
    runs.command({
      commandId: 'start-failed',
      runId: created.id,
      action: 'start',
      expectedStateVersion: 2,
      createdBy: 'operator',
    });
    const firstTodo = getTodo(db, created.id, 'first');
    const task = startTodo(runs, created.id, firstTodo.id);
    expect(
      runs.completeTodoAttempt({
        runId: created.id,
        todoId: firstTodo.id,
        pageTaskId: task.pageTaskId,
        result: 'assertion_failed',
        reasonClass: 'expected_text_missing',
        agentTaskId: 'agent-failed',
        startedAt: new Date().toISOString(),
      })
    ).toMatchObject({ todoState: 'failed', runLifecycle: 'completed' });
    expect(getTodo(db, created.id, 'second')).toMatchObject({ state: 'skipped' });
    expect(db.prepare('SELECT outcome FROM test_runs WHERE id = ?').get(created.id)).toEqual({
      outcome: 'failed',
    });
  });

  it('keeps a recoverable interruption non-terminal until explicit resume', () => {
    const fixture = createFixture(db, assets, 'test');
    const created = runs.createFormalRun(runInput(fixture, 'run-interrupted'));
    runs.command({
      commandId: 'start-interrupted',
      runId: created.id,
      action: 'start',
      expectedStateVersion: 2,
      createdBy: 'operator',
    });
    const firstTodo = getTodo(db, created.id, 'first');
    const task = startTodo(runs, created.id, firstTodo.id);
    expect(
      runs.completeTodoAttempt({
        runId: created.id,
        todoId: firstTodo.id,
        pageTaskId: task.pageTaskId,
        result: 'recoverable_interruption',
        reasonClass: 'agent_stream_disconnected',
        agentTaskId: 'agent-interrupted',
        startedAt: new Date().toISOString(),
        checkpoint: { step: 2, sideEffects: 'none_confirmed' },
      })
    ).toMatchObject({ todoState: 'interrupted', runLifecycle: 'running' });
    expect(getTodo(db, created.id, 'second').state).toBe('waiting_dependencies');
    expect(runs.resumeInterruptedTodo(created.id, firstTodo.id)).toEqual({ state: 'ready' });
  });

  it('requires a decision for outcome unknown and resolves downstream impact explicitly', () => {
    const fixture = createFixture(db, assets, 'test');
    const created = runs.createFormalRun(runInput(fixture, 'run-unknown'));
    runs.command({
      commandId: 'start-unknown',
      runId: created.id,
      action: 'start',
      expectedStateVersion: 2,
      createdBy: 'operator',
    });
    const firstTodo = getTodo(db, created.id, 'first');
    const task = startTodo(runs, created.id, firstTodo.id);
    const completed = runs.completeTodoAttempt({
      runId: created.id,
      todoId: firstTodo.id,
      pageTaskId: task.pageTaskId,
      result: 'outcome_unknown',
      reasonClass: 'connection_lost_after_submit',
      agentTaskId: 'agent-unknown',
      startedAt: new Date().toISOString(),
      partialOutputs: { submitted: 'unknown' },
    });
    expect(completed).toMatchObject({ todoState: 'waiting_decision', runLifecycle: 'running' });
    expect(() => runs.resumeInterruptedTodo(created.id, firstTodo.id)).toThrow('not interrupted');
    const decision = db
      .prepare("SELECT id FROM decision_requests WHERE todo_id = ? AND status = 'open'")
      .get(firstTodo.id) as { id: string };
    expect(
      runs.answerDecision({
        runId: created.id,
        decisionId: decision.id,
        answerKey: 'fail',
        reason: '无法证明副作用未发生，按失败处理',
        answeredBy: 'operator',
      })
    ).toEqual({ decisionStatus: 'applied', todoState: 'failed' });
    expect(getTodo(db, created.id, 'second').state).toBe('skipped');
    expect(
      db.prepare('SELECT lifecycle, outcome FROM test_runs WHERE id = ?').get(created.id)
    ).toEqual({
      lifecycle: 'completed',
      outcome: 'failed',
    });
  });

  it('persists rejected optimistic commands and finishes cancelling after the active attempt', () => {
    const fixture = createFixture(db, assets, 'test');
    const created = runs.createFormalRun(runInput(fixture, 'run-cancel'));
    expect(
      runs.command({
        commandId: 'stale-command',
        runId: created.id,
        action: 'start',
        expectedStateVersion: 1,
        createdBy: 'operator',
      })
    ).toMatchObject({ conflict: { expectedStateVersion: 1, actualStateVersion: 2 } });
    expect(db.prepare('SELECT status FROM run_commands WHERE id = ?').get('stale-command')).toEqual(
      {
        status: 'rejected',
      }
    );
    runs.command({
      commandId: 'start-cancel',
      runId: created.id,
      action: 'start',
      expectedStateVersion: 2,
      createdBy: 'operator',
    });
    const firstTodo = getTodo(db, created.id, 'first');
    const task = startTodo(runs, created.id, firstTodo.id);
    expect(
      runs.command({
        commandId: 'cancel-active',
        runId: created.id,
        action: 'cancel',
        expectedStateVersion: 3,
        createdBy: 'operator',
      })
    ).toMatchObject({ lifecycle: 'cancelling' });
    expect(
      runs.completeTodoAttempt({
        runId: created.id,
        todoId: firstTodo.id,
        pageTaskId: task.pageTaskId,
        result: 'cancelled',
        reasonClass: 'cancelled_at_safe_boundary',
        agentTaskId: 'agent-cancelled',
        startedAt: new Date().toISOString(),
      })
    ).toMatchObject({ runLifecycle: 'cancelled' });
    expect(getTodo(db, created.id, 'second').state).toBe('cancelled');
  });
});

function runInput(fixture: ReturnType<typeof createFixture>, clientRunId: string) {
  return {
    projectId: 'project-1',
    businessVersionId: fixture.versionId,
    clientRunId,
    scenarioRevisionId: fixture.scenarioRevisionId,
    deploymentRevisionId: fixture.deploymentRevisionId,
    inputs: { accountName: 'browser-center-fixture' },
  };
}

function startTodo(runs: SemanticRunControlRepository, runId: string, todoId: string) {
  return runs.startTodo({
    runId,
    todoId,
    browserSessionId: 'browser-session',
    tabId: 'tab-1',
    browserLeaseRefHash: HASH_A,
    toolPolicyHash: HASH_A,
    taskPayloadSha256: HASH_B,
    requiredAuthContext: { kind: 'anonymous' },
    sideEffectAuthorization: { result: 'auto_allowed' },
    budget: { maxToolCalls: 20 },
  });
}

function getTodo(db: DatabaseSync, runId: string, todoKey: string) {
  return db
    .prepare('SELECT * FROM run_todos WHERE run_id = ? AND todo_key = ?')
    .get(runId, todoKey) as {
    id: string;
    state: string;
  };
}

function createFixture(
  db: DatabaseSync,
  assets: SemanticAssetRepository,
  environment: 'test' | 'staging' | 'production',
  effect?: Record<string, unknown>
) {
  const versions = new BusinessVersionRepository(db);
  const now = new Date().toISOString();
  const deploymentRevisionId = `deployment-revision-${environment}`;
  db.prepare(
    `INSERT INTO deployment_profiles (id, project_id, profile_key, name, created_at)
     VALUES (?, 'project-1', ?, ?, ?)`
  ).run(`deployment-${environment}`, environment, environment, now);
  db.prepare(
    `INSERT INTO deployment_profile_revisions
      (id, deployment_profile_id, revision_no, lifecycle, schema_id, payload_json,
       content_sha256, validation_status, change_reason, created_by_type, created_at)
     VALUES (?, ?, 1, 'current', 'nebula.ai-e2e.deployment-profile/1.0', ?, ?,
       'valid', 'fixture', 'system', ?)`
  ).run(
    deploymentRevisionId,
    `deployment-${environment}`,
    JSON.stringify({
      schema: 'nebula.ai-e2e.deployment-profile/1.0',
      environment,
      origin: `https://${environment}.example.test`,
      allowedOrigins: [`https://${environment}.example.test`],
    }),
    HASH_A,
    now
  );
  const version = versions.create({
    projectId: 'project-1',
    versionKey: `release-${environment}`,
    name: `Release ${environment}`,
    createdBy: 'system',
    requestId: `create-${environment}`,
    deploymentRevisionId,
  }).version;
  const page = versions.createPage({
    businessVersionId: version.id,
    pageKey: 'account',
    payload: {
      schema: 'nebula.ai-e2e.page-definition/1.0',
      name: '账号页',
      routeMode: 'path',
      routeTemplate: '/account',
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
    moduleKey: 'account.manage',
    primaryPageDefinitionId: page.id,
    payload: {
      schema: 'nebula.ai-e2e.functional-module/1.0',
      name: '账号管理',
      sortOrder: 0,
      primaryPageDefinitionId: page.id,
    },
    createdBy: 'system',
  });
  const script = versions.createFunctionalScript({
    businessVersionId: version.id,
    functionalModuleId: functionalModule.id,
    scriptKey: 'account.action',
    name: '账号操作',
    payload: {
      schema: 'nebula.ai-e2e.functional-script/1.0',
      scriptKey: 'account.action',
      functionalModuleId: functionalModule.id,
      entryPageDefinitionId: page.id,
      steps: effect ? [{ action: 'click', effect }] : [{ action: 'observe' }],
    },
    createdBy: 'system',
    readinessStatus: 'verified',
  });
  const scenario = versions.createScenario({
    businessVersionId: version.id,
    scenarioKey: 'account-flow',
    name: '账号流程',
    payload: {
      schema: 'nebula.ai-e2e.scenario/1.0',
      scenarioKey: 'account-flow',
      name: '账号流程',
      purpose: '验证依赖传播',
      prdSourceRefs: [],
      actors: [],
      initialAuth: { kind: 'anonymous' },
      inputs: [],
      finalAcceptance: [],
      calls: [
        { callKey: 'first', functionalScriptId: script.id },
        { callKey: 'second', functionalScriptId: script.id },
      ],
      edges: [
        {
          fromCallKey: 'first',
          toCallKey: 'second',
          mode: 'requires_success',
          requiresOutputs: ['accountId'],
        },
      ],
      exports: [],
    },
    createdBy: 'system',
    readinessStatus: 'verified',
  });
  const verificationScope = { locale: 'zh-CN', viewport: 'desktop' };
  assets.recordBusinessVersionValidation({
    businessVersionId: version.id,
    deploymentRevisionId,
    assetGraphSha256: HASH_A,
    verificationScope,
    status: 'valid',
  });
  for (const executable of [
    {
      assetType: 'functional_script' as const,
      assetId: script.id,
      revisionId: script.currentRevision.id,
    },
    {
      assetType: 'test_scenario' as const,
      assetId: scenario.id,
      revisionId: scenario.currentRevision.id,
    },
  ]) {
    assets.recordVerification({
      businessVersionId: version.id,
      assetType: executable.assetType,
      assetId: executable.assetId,
      assetRevisionId: executable.revisionId,
      deploymentRevisionId,
      verificationScope,
      dependencyClosureSha256: HASH_B,
      status: 'verified',
    });
  }
  expect(hashValue(verificationScope)).toMatch(/^[a-f0-9]{64}$/);
  return {
    versionId: version.id,
    deploymentRevisionId,
    scenarioRevisionId: scenario.currentRevision.id,
  };
}
