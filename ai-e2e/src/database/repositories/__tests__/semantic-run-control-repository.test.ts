import { sideEffectPolicyCases } from '../../../test-support/side-effect-policy-cases.js';
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
import { functionalScriptFixture } from '../../../test-support/functional-script-fixture.js';
import Fastify from 'fastify';
import { SemanticRunService } from '../../../services/semantic-run-service.js';
import errorHandlerPlugin from '../../../server/plugins/error-handler.js';
import semanticRunRoutes from '../../../server/routes/semantic-runs.js';

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

  it('fails closed when an approved staging run loses its grant reference', () => {
    const fixture = createFixture(db, assets, 'staging', {
      kind: 'delete',
      reversibility: 'irreversible',
    });
    const created = runs.createFormalRun(runInput(fixture, 'missing-grant'));
    runs.answerDecision({
      runId: created.id,
      decisionId: created.decisionId!,
      answerKey: 'approve',
      reason: '批准精确计划',
      answeredBy: 'operator',
    });
    db.prepare('UPDATE test_runs SET active_approval_grant_id = NULL WHERE id = ?').run(created.id);
    expect(() =>
      runs.command({
        commandId: 'missing-grant-start',
        runId: created.id,
        action: 'start',
        expectedStateVersion: 3,
        createdBy: 'operator',
      })
    ).toThrow(/approval/i);
    expect(workflows.claimNextBrowserJob()).toBeNull();
  });

  it.each(sideEffectPolicyCases)(
    'Run matrix $environment $kind => $result',
    ({ environment, kind, reversibility, result }) => {
      const fixture = createFixture(db, assets, environment, { kind, reversibility });
      const run = runs.createFormalRun(runInput(fixture, 'matrix-run'));
      expect(run.admission).toBe(
        result === 'auto_allowed'
          ? 'ready'
          : result === 'approval_required'
            ? 'approval_required'
            : 'denied'
      );
    }
  );

  it.each(['revoked', 'expired'] as const)(
    're-approves the same frozen evaluation after %s without reviving the old answer',
    (status) => {
      const fixture = createFixture(db, assets, 'staging', {
        kind: 'delete',
        reversibility: 'compensatable',
      });
      const run = runs.createFormalRun(runInput(fixture, 'reapprove'));
      const oldAnswer = {
        runId: run.id,
        decisionId: run.decisionId!,
        answerKey: 'approve',
        reason: '原计划审批',
        answeredBy: 'operator',
      };
      runs.answerDecision(oldAnswer);
      const oldGrant = db
        .prepare('SELECT active_approval_grant_id AS id FROM test_runs WHERE id = ?')
        .get(run.id) as { id: string };
      db.prepare(
        `UPDATE side_effect_approval_grants SET status = ?, ${status === 'revoked' ? 'revoked_at' : 'expired_at'} = ? WHERE id = ?`
      ).run(status, new Date().toISOString(), oldGrant.id);
      expect(() => runs.assertExecutionAllowed(run.id)).toThrow(/approval/);
      const decision = db
        .prepare("SELECT id FROM decision_requests WHERE context_id = ? AND status = 'open'")
        .get(run.id) as { id: string };
      // A recovered run may still retain the old pointer; approval verifies identity independently.
      db.prepare('UPDATE test_runs SET active_approval_grant_id = ? WHERE id = ?').run(
        oldGrant.id,
        run.id
      );
      runs.answerDecision({ ...oldAnswer, decisionId: decision.id, reason: '再次精确批准' });
      const newGrant = db
        .prepare('SELECT active_approval_grant_id AS id FROM test_runs WHERE id = ?')
        .get(run.id) as { id: string };
      expect(newGrant.id).not.toBe(oldGrant.id);
      expect(() => runs.assertExecutionAllowed(run.id)).not.toThrow();
      runs.answerDecision(oldAnswer);
      expect(
        db.prepare('SELECT status FROM side_effect_approval_grants WHERE id = ?').get(oldGrant.id)
      ).toEqual({ status });
      expect(
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM side_effect_policy_evaluations WHERE context_id = ?'
          )
          .get(run.id)
      ).toEqual({ count: 1 });
      expect(
        db
          .prepare('SELECT COUNT(*) AS count FROM side_effect_approval_grants WHERE context_id = ?')
          .get(run.id)
      ).toEqual({ count: 2 });
    }
  );

  it('a completed run with failed outcome expires authority without opening another decision', () => {
    const fixture = createFixture(db, assets, 'staging', {
      kind: 'delete',
      reversibility: 'compensatable',
    });
    const run = runs.createFormalRun(runInput(fixture, 'failed-policy'));
    runs.answerDecision({
      runId: run.id,
      decisionId: run.decisionId!,
      answerKey: 'approve',
      reason: '精确批准',
      answeredBy: 'operator',
    });
    db.prepare("UPDATE test_runs SET lifecycle = 'completed', outcome = 'failed' WHERE id = ?").run(
      run.id
    );
    expect(() => runs.assertExecutionAllowed(run.id)).toThrow(/terminated/);
    expect(db.prepare('SELECT lifecycle FROM test_runs WHERE id = ?').get(run.id)).toEqual({
      lifecycle: 'completed',
    });
    expect(
      db
        .prepare("SELECT id FROM decision_requests WHERE context_id = ? AND status = 'open'")
        .get(run.id)
    ).toBeUndefined();
    expect(
      db.prepare('SELECT status FROM side_effect_approval_grants WHERE context_id = ?').get(run.id)
    ).toEqual({ status: 'expired' });
  });

  it('freezes repeated single writes as a high-risk Run plan', () => {
    const fixture = createFixture(
      db,
      assets,
      'staging',
      { kind: 'create', reversibility: 'compensatable' },
      2
    );
    const run = runs.createFormalRun(runInput(fixture, 'repeat-two'));
    expect(run.admission).toBe('approval_required');
    const evaluation = db
      .prepare(
        'SELECT projection_json_redacted FROM side_effect_policy_evaluations WHERE context_id = ?'
      )
      .get(run.id) as { projection_json_redacted: string };
    expect(JSON.parse(evaluation.projection_json_redacted).effects[0].maxAffectedItems).toBe(2);
    runs.answerDecision({
      runId: run.id,
      decisionId: run.decisionId!,
      answerKey: 'approve',
      reason: '批准重复两次',
      answeredBy: 'operator',
    });
    runs.command({
      runId: run.id,
      commandId: 'repeat-start',
      action: 'start',
      expectedStateVersion: 3,
      createdBy: 'operator',
    });
    expect(() => startTodo(runs, run.id, getTodo(db, run.id, 'first[0]').id)).not.toThrow();
  });

  it.each([
    [null, 400, 'validation_error'],
    [{}, 400, 'validation_error'],
    [{ calls: [{}] }, 400, 'validation_error'],
    [
      { calls: [{ callKey: 'ordinary', functionalScriptId: 'script', runWhen: {} }] },
      500,
      'internal_error',
    ],
    [
      {
        calls: [{ callKey: 'state-required-not found', functionalScriptId: 'script', runWhen: {} }],
      },
      500,
      'internal_error',
    ],
    [
      {
        calls: [
          { callKey: 'ordinary', functionalScriptId: 'script', repeat: { kind: 'for_each' } },
        ],
      },
      409,
      'conflict',
    ],
    [
      {
        calls: [
          { callKey: 'not found', functionalScriptId: 'script', repeat: { kind: 'for_each' } },
        ],
      },
      409,
      'conflict',
    ],
  ])('uses a stable reason for authoring scenario refusal %#', async (payload, status, code) => {
    const app = Fastify();
    app.register(errorHandlerPlugin);
    app.post('/test-revision', () =>
      assets.createRevision({
        assetType: 'test_scenario',
        assetId: 'scenario',
        businessVersionId: 'version',
        schemaId: 'nebula.ai-e2e.test-scenario/1.0',
        payload,
        changeReason: 'test',
        createdByType: 'user',
      })
    );
    try {
      const response = await app.inject({ method: 'POST', url: '/test-revision' });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code, retryable: status === 500 });
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM semantic_test_scenario_revisions').get()
      ).toEqual({ count: 0 });
    } finally {
      await app.close();
    }
  });

  it('preserves typed refusals through the real repository and API boundary', async () => {
    const app = Fastify();
    app.register(errorHandlerPlugin);
    app.register(semanticRunRoutes, { prefix: '/api/v1', service: new SemanticRunService(runs) });
    try {
      const missing = await app.inject({
        method: 'POST',
        url: '/api/v1/runs/missing/todos/missing/resume',
        headers: { 'x-correlation-id': 'real-repo-refusal' },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({
        code: 'not_found',
        message: 'Run TODO not found',
        retryable: false,
        correlationId: 'real-repo-refusal',
      });

      const fixture = createFixture(db, assets, 'test');
      const created = runs.createFormalRun(runInput(fixture, 'real-route'));
      const todo = getTodo(db, created.id, 'first');
      const refused = await app.inject({
        method: 'POST',
        url: `/api/v1/runs/${created.id}/todos/${todo.id}/start`,
        payload: {
          browserSessionId: 'session',
          tabId: 'tab',
          browserLeaseRefHash: HASH_A,
          toolPolicyHash: HASH_A,
          taskPayloadSha256: HASH_A,
          requiredAuthContext: {},
          sideEffectAuthorization: {},
          budget: {},
        },
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        code: 'conflict',
        message: 'Run is not running',
        retryable: false,
      });
      expect(db.prepare('SELECT COUNT(*) AS count FROM page_tasks').get()).toEqual({ count: 0 });
    } finally {
      await app.close();
    }
  });

  it('freezes verified scenario calls and unlocks dependent TODOs after success', () => {
    const fixture = createFixture(db, assets, 'test');
    const created = runs.createFormalRun(runInput(fixture, 'run-success'));

    expect(created).toMatchObject({ lifecycle: 'ready', admission: 'ready', stateVersion: 2 });
    expect(workflows.claimNextBrowserJob()).toBeNull();
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
    expect(workflows.claimNextBrowserJob()).toMatchObject({ root_context_id: created.id });
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
    const fixture = createFixture(db, assets, 'staging', {
      kind: 'delete',
      reversibility: 'irreversible',
    });
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
    expect(workflows.claimNextBrowserJob()).toBeNull();
    runs.command({
      commandId: 'start-staging',
      runId: created.id,
      action: 'start',
      expectedStateVersion: 3,
      createdBy: 'operator',
    });
    expect(workflows.claimNextBrowserJob()).toMatchObject({ root_context_id: created.id });
    expect(
      db
        .prepare('SELECT status, approved_by FROM side_effect_approval_grants WHERE context_id = ?')
        .get(created.id)
    ).toEqual({ status: 'active', approved_by: 'operator' });
  });

  it('treats file-upload effects as staging high risk requiring approval', () => {
    const fixture = createFixture(db, assets, 'staging', {
      kind: 'update',
      reversibility: 'reversible',
      stepActionType: 'set_files',
    });
    const created = runs.createFormalRun(runInput(fixture, 'run-upload'));

    expect(created).toMatchObject({ lifecycle: 'paused', admission: 'approval_required' });
    expect(created.decisionId).toBeTruthy();
  });

  it('expires the active approval grant when the run is cancelled after start', () => {
    const fixture = createFixture(db, assets, 'staging', {
      kind: 'delete',
      reversibility: 'irreversible',
    });
    const created = runs.createFormalRun(runInput(fixture, 'run-cancel-grant'));
    runs.answerDecision({
      runId: created.id,
      decisionId: created.decisionId!,
      answerKey: 'approve',
      reason: '已确认',
      answeredBy: 'operator',
    });
    const readyVersion = Number(
      (
        db.prepare('SELECT state_version AS v FROM test_runs WHERE id = ?').get(created.id) as {
          v: number;
        }
      ).v
    );
    runs.command({
      commandId: 'start-cancel-grant',
      runId: created.id,
      action: 'start',
      expectedStateVersion: readyVersion,
      createdBy: 'operator',
    });
    runs.command({
      commandId: 'cancel-cancel-grant',
      runId: created.id,
      action: 'cancel',
      expectedStateVersion: readyVersion + 1,
      createdBy: 'operator',
    });
    expect(
      db
        .prepare('SELECT status, reason_json FROM side_effect_approval_grants WHERE context_id = ?')
        .get(created.id)
    ).toEqual({
      status: 'expired',
      reason_json: expect.stringContaining('context_terminated'),
    });
  });

  it('expires the grant and pauses for re-approval when start finds a stale projection', () => {
    const fixture = createFixture(db, assets, 'staging', {
      kind: 'delete',
      reversibility: 'irreversible',
    });
    const created = runs.createFormalRun(runInput(fixture, 'run-stale'));
    runs.answerDecision({
      runId: created.id,
      decisionId: created.decisionId!,
      answerKey: 'approve',
      reason: '已确认',
      answeredBy: 'operator',
    });
    db.prepare('UPDATE test_runs SET side_effect_projection_sha256 = ? WHERE id = ?').run(
      'c'.repeat(64),
      created.id
    );
    const readyVersion = Number(
      (
        db.prepare('SELECT state_version AS v FROM test_runs WHERE id = ?').get(created.id) as {
          v: number;
        }
      ).v
    );
    expect(() =>
      runs.command({
        commandId: 'start-stale',
        runId: created.id,
        action: 'start',
        expectedStateVersion: readyVersion,
        createdBy: 'operator',
      })
    ).toThrow(/stale/i);
    expect(db.prepare('SELECT lifecycle FROM test_runs WHERE id = ?').get(created.id)).toEqual({
      lifecycle: 'paused',
    });
    expect(
      db
        .prepare('SELECT status FROM side_effect_approval_grants WHERE context_id = ?')
        .get(created.id)
    ).toEqual({ status: 'expired' });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS open_decisions FROM decision_requests WHERE run_id = ? AND status = 'open'"
        )
        .get(created.id)
    ).toEqual({ open_decisions: 1 });
    const rejected = db
      .prepare("SELECT error_json FROM run_commands WHERE id = 'start-stale'")
      .get() as { error_json: string };
    expect(rejected.error_json).toContain('side_effect_approval_stale');
    expect(
      db
        .prepare(
          "SELECT payload_json FROM run_events WHERE run_id = ? AND type = 'run.command_rejected'"
        )
        .get(created.id)
    ).toEqual({
      payload_json: expect.stringContaining('side_effect_approval_stale'),
    });
    const reopenDecision = db
      .prepare(
        "SELECT id FROM decision_requests WHERE run_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1"
      )
      .get(created.id) as { id: string };
    expect(() =>
      runs.answerDecision({
        runId: created.id,
        decisionId: reopenDecision.id,
        answerKey: 'approve',
        reason: '漂移下不应可批准',
        answeredBy: 'operator',
      })
    ).toThrow(/stale: risk projection changed/);
  });

  it('rejects resume with a side-effect approval code while a decision is open', () => {
    const fixture = createFixture(db, assets, 'staging', {
      kind: 'delete',
      reversibility: 'irreversible',
    });
    const created = runs.createFormalRun(runInput(fixture, 'run-open-decision'));
    const pausedVersion = Number(
      (
        db.prepare('SELECT state_version AS v FROM test_runs WHERE id = ?').get(created.id) as {
          v: number;
        }
      ).v
    );
    expect(() =>
      runs.command({
        commandId: 'resume-open-decision',
        runId: created.id,
        action: 'resume',
        expectedStateVersion: pausedVersion,
        createdBy: 'operator',
      })
    ).toThrow(/open decision and cannot start or resume/i);
  });

  it('denies production business writes and leaves no acquirable browser job', () => {
    const fixture = createFixture(db, assets, 'production', {
      kind: 'create',
      reversibility: 'compensatable',
    });
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
  environment: 'local' | 'test' | 'staging' | 'production',
  effect?: Record<string, unknown>,
  repeatCount = 1
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
    payload: functionalScriptFixture({
      scriptKey: 'account.action',
      name: '账号操作',
      moduleId: functionalModule.id,
      pageId: page.id,
      steps: effect
        ? [
            {
              id: 'step_effect',
              name: '执行账号操作',
              intent: '执行受控副作用',
              action: {
                type: typeof effect.stepActionType === 'string' ? effect.stepActionType : 'click',
                target: {
                  semantic: '账号操作按钮',
                  candidates: [
                    { strategy: 'role', role: 'button', name: { kind: 'literal', value: '提交' } },
                  ],
                  expected: { cardinality: 'exactly_one', visible: true, enabled: true },
                },
                ...(typeof effect.stepActionType === 'string' &&
                effect.stepActionType === 'set_files'
                  ? { artifacts: [] }
                  : {}),
              },
              postconditions: [],
              sideEffectId: 'effect-1',
            },
          ]
        : undefined,
      sideEffects: effect
        ? [
            {
              id: 'effect-1',
              kind: effect.kind,
              resourceType: 'fixture',
              identityFrom: { kind: 'literal', value: 'fixture-1' },
              affectedItems: { kind: 'single' },
              reversibility: effect.reversibility,
              verifyApplied: [
                {
                  id: 'assert_effect_applied',
                  kind: 'page.url',
                  expected: { kind: 'literal', value: '/' },
                  comparator: 'contains',
                  message: '副作用完成后页面仍可访问',
                },
              ],
              retryPolicy: 'verify_before_retry',
              ...effect,
            },
          ]
        : undefined,
    }),
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
        {
          callKey: 'first',
          functionalScriptId: script.id,
          ...(repeatCount > 1 ? { repeat: repeatCount } : {}),
        },
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
