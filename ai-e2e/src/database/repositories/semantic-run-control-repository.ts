import { randomUUID } from 'node:crypto';
import type { SemanticEvidenceRepository } from './semantic-evidence-repository.js';
import {
  assertNoInlineSecrets,
  hashValue,
  inImmediateTransaction,
  requireSha256,
  stableStringify,
  type DatabaseLike,
  type SupportedDatabase,
} from './semantic-repository-utils.js';
import type {
  InitialRunVariableInput,
  RunTodoDependencyInput,
  RunTodoInput,
  SemanticRunResult,
  SemanticWorkflowRepository,
} from './semantic-workflow-repository.js';

export interface CreateFormalRunInput {
  projectId: string;
  businessVersionId: string;
  clientRunId: string;
  scenarioRevisionId: string;
  deploymentRevisionId: string;
  inputs: Record<string, unknown>;
  secretRefs?: Record<string, string>;
  evidencePolicy?: 'default' | 'extended' | 'minimal';
}

export interface FormalRunCreationResult extends SemanticRunResult {
  admission: 'ready' | 'approval_required' | 'denied';
  decisionId?: string;
}

export interface StartTodoInput {
  pageTaskId?: string;
  runId: string;
  todoId: string;
  browserSessionId: string;
  tabId: string;
  browserLeaseRefHash: string;
  toolPolicyHash: string;
  taskPayloadSha256: string;
  requiredAuthContext: Record<string, unknown>;
  sideEffectAuthorization: Record<string, unknown>;
  budget: Record<string, unknown>;
  aiTaskId?: string;
  aiSessionId?: string;
}

export interface CompleteTodoAttemptInput {
  runId: string;
  todoId: string;
  pageTaskId: string;
  result:
    | 'succeeded'
    | 'assertion_failed'
    | 'execution_failed'
    | 'precondition_blocked'
    | 'recoverable_interruption'
    | 'decision_required'
    | 'outcome_unknown'
    | 'cancelled';
  reasonClass: string;
  agentTaskId: string;
  startedAt: string;
  checkpoint?: Record<string, unknown>;
  actualPage?: Record<string, unknown>;
  confirmedOutputs?: Record<string, unknown>;
  partialOutputs?: Record<string, unknown>;
  sideEffects?: Record<string, unknown>;
  downstreamImpact?: Record<string, unknown>;
  policyEvaluationId?: string;
  approvalGrantId?: string;
  evidenceManifestId?: string;
  decision?: {
    category: string;
    question: string;
    facts: Record<string, unknown>;
    evidenceRefs?: string[];
    options: Array<Record<string, unknown>>;
    recommendationKey?: string;
    impact: Record<string, unknown>;
  };
}

export interface RunCommandResult {
  lifecycle: string;
  stateVersion: number;
  replayed: boolean;
  conflict?: {
    expectedStateVersion: number;
    actualStateVersion: number;
  };
}

type DbRow = Record<string, unknown>;

export class SemanticRunControlRepository {
  private readonly db: DatabaseLike;

  constructor(
    database: SupportedDatabase,
    private readonly workflows: SemanticWorkflowRepository,
    private readonly evidence: SemanticEvidenceRepository
  ) {
    this.db = database as unknown as DatabaseLike;
  }

  createFormalRun(input: CreateFormalRunInput): FormalRunCreationResult {
    assertNoInlineSecrets(input.inputs);
    const frozen = this.buildFrozenPlan(input);
    const policy = evaluateSideEffectPolicy(frozen.environment, frozen.sideEffectProjection);
    const run = this.workflows.createRun({
      projectId: input.projectId,
      businessVersionId: input.businessVersionId,
      clientRunId: input.clientRunId,
      purpose: 'formal',
      scenarioRevisionId: input.scenarioRevisionId,
      deploymentRevisionId: input.deploymentRevisionId,
      assetGraphSha256: frozen.assetGraphSha256,
      verificationScopeSha256: frozen.verificationScopeSha256,
      sideEffectPolicyVersion: 'side-effect-policy/1.0',
      sideEffectProjection: frozen.sideEffectProjection,
      planSchemaId: 'nebula.ai-e2e.run-plan/1.0',
      plan: frozen.plan,
      todos: frozen.todos,
      dependencies: frozen.dependencies,
      initialVariables: frozen.initialVariables,
    });
    if (!run.created) {
      const existing = this.db
        .prepare('SELECT lifecycle FROM test_runs WHERE id = ?')
        .get(run.id) as { lifecycle: string } | undefined;
      const decision = this.db
        .prepare(
          `SELECT id FROM decision_requests
           WHERE run_id = ? AND category = 'side_effect_approval' ORDER BY created_at DESC LIMIT 1`
        )
        .get(run.id) as { id: string } | undefined;
      return {
        ...run,
        admission:
          existing?.lifecycle === 'cancelled' ? 'denied' : decision ? 'approval_required' : 'ready',
        ...(decision ? { decisionId: decision.id } : {}),
      };
    }

    const decisionId = policy.result === 'approval_required' ? randomUUID() : undefined;
    if (decisionId) this.insertSideEffectDecision(run.id, decisionId, frozen, policy.reasonCodes);
    const evaluation = this.evidence.recordPolicyEvaluation({
      context: { type: 'run', id: run.id },
      businessVersionId: input.businessVersionId,
      deploymentRevisionId: input.deploymentRevisionId,
      policyVersion: 'side-effect-policy/1.0',
      sourcePlanSha256: hashValue(frozen.plan),
      projectionRedacted: frozen.sideEffectProjection,
      result: policy.result,
      reasonCodes: policy.reasonCodes,
      ...(decisionId ? { decisionRequestId: decisionId } : {}),
    });
    this.applyAdmission(run.id, run.browserJobId, evaluation.id, policy.result, policy.reasonCodes);
    return {
      ...run,
      lifecycle:
        policy.result === 'auto_allowed'
          ? 'ready'
          : policy.result === 'approval_required'
            ? 'paused'
            : 'cancelled',
      stateVersion: 2,
      admission:
        policy.result === 'auto_allowed'
          ? 'ready'
          : policy.result === 'approval_required'
            ? 'approval_required'
            : 'denied',
      ...(decisionId ? { decisionId } : {}),
    };
  }

  command(params: {
    commandId: string;
    runId: string;
    action: 'start' | 'pause' | 'resume' | 'cancel';
    expectedStateVersion: number;
    reason?: string;
    createdBy: string;
  }): RunCommandResult {
    const requestSha256 = hashValue({ action: params.action, reason: params.reason ?? null });
    return inImmediateTransaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT * FROM run_commands WHERE id = ?')
        .get(params.commandId) as DbRow | undefined;
      if (existing) {
        if (
          existing.run_id !== params.runId ||
          existing.request_sha256 !== requestSha256 ||
          Number(existing.expected_state_version) !== params.expectedStateVersion
        ) {
          throw new Error('Run command id was reused with different input');
        }
        const run = this.requireRun(params.runId);
        return {
          lifecycle: String(run.lifecycle),
          stateVersion: Number(run.state_version),
          replayed: true,
        };
      }
      const run = this.requireRun(params.runId);
      if (Number(run.state_version) !== params.expectedStateVersion) {
        const actualStateVersion = Number(run.state_version);
        this.insertRejectedCommand(params, requestSha256, actualStateVersion);
        this.appendRunEvent(
          params.runId,
          'run.command_rejected',
          'run',
          params.commandId,
          {
            action: params.action,
            reason: 'state_version_conflict',
            expectedStateVersion: params.expectedStateVersion,
            actualStateVersion,
          },
          new Date().toISOString()
        );
        return {
          lifecycle: String(run.lifecycle),
          stateVersion: actualStateVersion,
          replayed: false,
          conflict: { expectedStateVersion: params.expectedStateVersion, actualStateVersion },
        };
      }
      const from = String(run.lifecycle);
      const to = commandTarget(from, params.action);
      if (params.action === 'resume') this.assertRunCanResume(params.runId);
      const now = new Date().toISOString();
      const nextVersion = Number(run.state_version) + 1;
      this.db
        .prepare(
          `INSERT INTO run_commands
            (id, run_id, type, expected_state_version, request_sha256, status,
             result_json, created_by, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`
        )
        .run(
          params.commandId,
          params.runId,
          params.action,
          params.expectedStateVersion,
          requestSha256,
          stableStringify({ lifecycle: to }),
          params.createdBy,
          now,
          now
        );
      if (params.action === 'cancel') {
        const runningTodo = this.db
          .prepare("SELECT 1 FROM run_todos WHERE run_id = ? AND state = 'running' LIMIT 1")
          .get(params.runId);
        if (!runningTodo) {
          this.cancelRemainingTodos(params.runId, now);
          this.updateRunLifecycle(run, 'cancelled', nextVersion, now, {
            outcome: 'cancelled',
            reason: { code: 'cancelled_by_user', reason: params.reason ?? null },
          });
        } else {
          this.updateRunLifecycle(run, 'cancelling', nextVersion, now, {
            reason: { code: 'cancel_requested', reason: params.reason ?? null },
          });
        }
      } else {
        this.updateRunLifecycle(run, to, nextVersion, now);
      }
      return {
        lifecycle:
          params.action === 'cancel' &&
          !this.db
            .prepare("SELECT 1 FROM run_todos WHERE run_id = ? AND state = 'running' LIMIT 1")
            .get(params.runId)
            ? 'cancelled'
            : to,
        stateVersion: nextVersion,
        replayed: false,
      };
    });
  }

  enqueueCloseBrowser(commandId: string, runId: string, createdBy: string): { created: boolean } {
    this.requireRun(runId);
    return this.evidence.enqueueOutbox({
      id: commandId,
      context: { type: 'run', id: runId },
      targetService: 'proxy_adapter',
      commandType: 'browser_session.close',
      endpointOrTool: '/api/v1/browser-execution/sessions/:sessionId',
      payloadRedacted: { runId, requestedBy: createdBy },
    });
  }

  startTodo(input: StartTodoInput): { pageTaskId: string; taskNo: number } {
    requireSha256(input.browserLeaseRefHash, 'browserLeaseRefHash');
    requireSha256(input.toolPolicyHash, 'toolPolicyHash');
    requireSha256(input.taskPayloadSha256, 'taskPayloadSha256');
    assertNoInlineSecrets(input.requiredAuthContext);
    assertNoInlineSecrets(input.sideEffectAuthorization);
    assertNoInlineSecrets(input.budget);
    return inImmediateTransaction(this.db, () => {
      const todo = this.requireTodo(input.todoId);
      if (todo.run_id !== input.runId) {
        throw new Error('Run TODO does not belong to the requested run');
      }
      if (todo.state !== 'ready') throw new Error('Run TODO is not ready');
      const run = this.requireRun(String(todo.run_id));
      if (run.lifecycle !== 'running') throw new Error('Run is not running');
      if (
        this.db
          .prepare(
            `SELECT 1 FROM page_tasks WHERE run_id = ?
             AND state IN ('created','running','paused') LIMIT 1`
          )
          .get(todo.run_id)
      ) {
        throw new Error('Run already has an active page task');
      }
      const next = this.db
        .prepare('SELECT COALESCE(MAX(task_no), 0) + 1 AS task_no FROM page_tasks WHERE run_id = ?')
        .get(todo.run_id) as { task_no: number | bigint };
      const taskNo = Number(next.task_no);
      const pageTaskId = input.pageTaskId ?? randomUUID();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO page_tasks
            (id, run_id, task_no, state, todo_ids_json, page_definition_revision_id,
             browser_session_id, tab_id, required_auth_context_json,
             side_effect_authorization_json, browser_lease_ref_hash, ai_task_id,
             ai_session_id, tool_policy_hash, task_payload_sha256, budget_json,
             started_at, created_at)
           VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          pageTaskId,
          todo.run_id,
          taskNo,
          stableStringify([input.todoId]),
          todo.page_definition_revision_id,
          input.browserSessionId,
          input.tabId,
          stableStringify(input.requiredAuthContext),
          stableStringify(input.sideEffectAuthorization),
          input.browserLeaseRefHash,
          input.aiTaskId ?? null,
          input.aiSessionId ?? null,
          input.toolPolicyHash,
          input.taskPayloadSha256,
          stableStringify(input.budget),
          now,
          now
        );
      this.db
        .prepare(
          `UPDATE run_todos SET state = 'running', state_version = state_version + 1,
             started_at = COALESCE(started_at, ?) WHERE id = ?`
        )
        .run(now, input.todoId);
      this.db
        .prepare('UPDATE test_runs SET active_page_task_id = ? WHERE id = ?')
        .run(pageTaskId, todo.run_id);
      this.appendRunEvent(
        String(todo.run_id),
        'page_task.started',
        'page_task',
        pageTaskId,
        { todoId: input.todoId, taskNo },
        now
      );
      this.appendRunEvent(
        String(todo.run_id),
        'todo.state_changed',
        'todo',
        input.todoId,
        { from: 'ready', to: 'running' },
        now
      );
      return { pageTaskId, taskNo };
    });
  }

  completeTodoAttempt(input: CompleteTodoAttemptInput): {
    attemptId: string;
    todoState: string;
    runLifecycle: string;
  } {
    for (const value of [
      input.checkpoint,
      input.actualPage,
      input.confirmedOutputs,
      input.partialOutputs,
      input.sideEffects,
      input.downstreamImpact,
      input.decision,
    ]) {
      if (value !== undefined) assertNoInlineSecrets(value);
    }
    return inImmediateTransaction(this.db, () => {
      const todo = this.requireTodo(input.todoId);
      if (todo.run_id !== input.runId) {
        throw new Error('Run TODO does not belong to the requested run');
      }
      if (todo.state !== 'running') throw new Error('Run TODO is not running');
      const pageTask = this.db
        .prepare('SELECT * FROM page_tasks WHERE id = ?')
        .get(input.pageTaskId) as DbRow | undefined;
      if (
        !pageTask ||
        pageTask.run_id !== todo.run_id ||
        pageTask.state !== 'running' ||
        !parseArray(pageTask.todo_ids_json).includes(input.todoId)
      ) {
        throw new Error('Page task does not own the running TODO');
      }
      const next = this.db
        .prepare(
          `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
           FROM execution_attempts WHERE todo_id = ?`
        )
        .get(input.todoId) as { attempt_no: number | bigint };
      const attemptId = randomUUID();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO execution_attempts
            (id, run_id, todo_id, page_task_id, attempt_no, script_revision_id,
             result, reason_class, last_checkpoint_json, actual_page_json,
             confirmed_outputs_json, partial_outputs_json, side_effects_json,
             downstream_impact_json, policy_evaluation_id, approval_grant_id,
             evidence_manifest_id, agent_task_id, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          attemptId,
          todo.run_id,
          input.todoId,
          input.pageTaskId,
          Number(next.attempt_no),
          todo.functional_script_revision_id,
          input.result,
          input.reasonClass,
          input.checkpoint ? stableStringify(input.checkpoint) : null,
          input.actualPage ? stableStringify(input.actualPage) : null,
          input.confirmedOutputs ? stableStringify(input.confirmedOutputs) : null,
          input.partialOutputs ? stableStringify(input.partialOutputs) : null,
          input.sideEffects ? stableStringify(input.sideEffects) : null,
          input.downstreamImpact ? stableStringify(input.downstreamImpact) : null,
          input.policyEvaluationId ?? null,
          input.approvalGrantId ?? null,
          input.evidenceManifestId ?? null,
          input.agentTaskId,
          input.startedAt,
          now
        );
      const todoState = todoStateForResult(input.result);
      this.db
        .prepare(
          `UPDATE run_todos SET state = ?, state_version = state_version + 1,
             current_attempt_id = ?, published_outputs_json = ?, partial_outputs_json = ?,
             side_effect_summary_json = ?, block_reason_json = ?, completed_at = ?
           WHERE id = ?`
        )
        .run(
          todoState,
          attemptId,
          input.result === 'succeeded' && input.confirmedOutputs
            ? stableStringify(input.confirmedOutputs)
            : null,
          input.partialOutputs ? stableStringify(input.partialOutputs) : null,
          input.sideEffects ? stableStringify(input.sideEffects) : null,
          ['blocked', 'interrupted', 'waiting_decision'].includes(todoState)
            ? stableStringify({ result: input.result, reasonClass: input.reasonClass })
            : null,
          ['passed', 'failed', 'skipped', 'cancelled'].includes(todoState) ? now : null,
          input.todoId
        );
      this.db
        .prepare(`UPDATE page_tasks SET state = ?, result_json = ?, completed_at = ? WHERE id = ?`)
        .run(
          todoState === 'passed'
            ? 'completed'
            : todoState === 'interrupted' || todoState === 'waiting_decision'
              ? 'interrupted'
              : todoState === 'cancelled'
                ? 'cancelled'
                : 'failed',
          stableStringify({ result: input.result, reasonClass: input.reasonClass }),
          now,
          input.pageTaskId
        );
      this.db
        .prepare('UPDATE test_runs SET active_page_task_id = NULL WHERE id = ?')
        .run(todo.run_id);
      let decisionId: string | undefined;
      if (
        input.result === 'decision_required' ||
        input.result === 'outcome_unknown' ||
        input.result === 'precondition_blocked'
      ) {
        decisionId = this.insertAttemptDecision(todo, attemptId, input, now);
      }
      const runIsCancelling =
        (
          this.db.prepare('SELECT lifecycle FROM test_runs WHERE id = ?').get(todo.run_id) as {
            lifecycle: string;
          }
        ).lifecycle === 'cancelling';
      if (
        todoState === 'passed' ||
        todoState === 'failed' ||
        (todoState === 'cancelled' && !runIsCancelling)
      ) {
        this.propagateTodoDependencies(String(todo.run_id), input.todoId, todoState, now);
      }
      this.appendRunEvent(
        String(todo.run_id),
        'attempt.completed',
        'attempt',
        attemptId,
        { todoId: input.todoId, result: input.result, todoState, decisionId: decisionId ?? null },
        now
      );
      this.appendRunEvent(
        String(todo.run_id),
        'todo.state_changed',
        'todo',
        input.todoId,
        { from: 'running', to: todoState },
        now
      );
      const lifecycle = this.settleRunIfPossible(String(todo.run_id), now);
      return { attemptId, todoState, runLifecycle: lifecycle };
    });
  }

  resumeInterruptedTodo(runId: string, todoId: string): { state: 'ready' } {
    return inImmediateTransaction(this.db, () => {
      const todo = this.requireTodo(todoId);
      if (todo.run_id !== runId) {
        throw new Error('Run TODO does not belong to the requested run');
      }
      if (todo.state !== 'interrupted') throw new Error('Run TODO is not interrupted');
      const latest = this.db
        .prepare(
          `SELECT result FROM execution_attempts WHERE todo_id = ?
           ORDER BY attempt_no DESC LIMIT 1`
        )
        .get(todoId) as { result: string } | undefined;
      if (!latest || latest.result !== 'recoverable_interruption') {
        throw new Error('Outcome-unknown TODO requires a decision before recovery');
      }
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE run_todos SET state = 'ready', state_version = state_version + 1,
             block_reason_json = NULL, completed_at = NULL WHERE id = ?`
        )
        .run(todoId);
      this.appendRunEvent(
        String(todo.run_id),
        'todo.state_changed',
        'todo',
        todoId,
        { from: 'interrupted', to: 'ready', recovery: 'explicit' },
        now
      );
      return { state: 'ready' };
    });
  }

  answerDecision(params: {
    runId: string;
    decisionId: string;
    answerKey: string;
    reason: string;
    answeredBy: string;
  }): { decisionStatus: string; todoState?: string } {
    return inImmediateTransaction(this.db, () => {
      const decision = this.db
        .prepare('SELECT * FROM decision_requests WHERE id = ? AND run_id = ?')
        .get(params.decisionId, params.runId) as DbRow | undefined;
      if (!decision) throw new Error('Run decision not found');
      const existing = this.db
        .prepare('SELECT answer_key FROM decision_answers WHERE decision_request_id = ?')
        .get(params.decisionId) as { answer_key: string } | undefined;
      if (existing) {
        if (existing.answer_key !== params.answerKey) {
          throw new Error('Run decision was already answered differently');
        }
        const todo = decision.todo_id ? this.requireTodo(String(decision.todo_id)) : undefined;
        return {
          decisionStatus: String(decision.status),
          ...(todo ? { todoState: String(todo.state) } : {}),
        };
      }
      if (decision.status !== 'open') throw new Error('Run decision is not open');
      const options = parseArray(decision.options_json) as Array<Record<string, unknown>>;
      if (!options.some((option) => option.key === params.answerKey)) {
        throw new Error('Run decision answer is not one of the allowed options');
      }
      const now = new Date().toISOString();
      const answerId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO decision_answers
            (id, decision_request_id, answer_key, reason, answered_by_type,
             answered_by_id, created_at)
           VALUES (?, ?, ?, ?, 'user', ?, ?)`
        )
        .run(answerId, params.decisionId, params.answerKey, params.reason, params.answeredBy, now);
      this.db
        .prepare(
          `UPDATE decision_requests SET status = 'applied', state_version = state_version + 1,
             answered_at = ?, applied_at = ? WHERE id = ?`
        )
        .run(now, now, params.decisionId);
      let todoState: string | undefined;
      if (decision.category === 'side_effect_approval') {
        if (params.answerKey === 'approve') {
          const run = this.requireRun(params.runId);
          const evaluation = this.db
            .prepare('SELECT * FROM side_effect_policy_evaluations WHERE id = ?')
            .get(run.current_policy_evaluation_id) as DbRow | undefined;
          if (!evaluation) throw new Error('Side-effect policy evaluation not found');
          const grantId = randomUUID();
          this.db
            .prepare(
              `INSERT INTO side_effect_approval_grants
                (id, evaluation_id, context_type, context_id, business_version_id,
                 deployment_revision_id, policy_version, approved_projection_json_redacted,
                 approved_projection_sha256, decision_request_id, decision_answer_id, status,
                 approved_by, approved_at, reason_json)
               VALUES (?, ?, 'run', ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
            )
            .run(
              grantId,
              evaluation.id,
              params.runId,
              evaluation.business_version_id,
              evaluation.deployment_revision_id,
              evaluation.policy_version,
              evaluation.projection_json_redacted,
              evaluation.projection_sha256,
              params.decisionId,
              answerId,
              params.answeredBy,
              now,
              stableStringify({ reason: params.reason })
            );
          this.db
            .prepare(
              `UPDATE test_runs SET lifecycle = 'ready', state_version = state_version + 1,
                 pause_reason_json = NULL, active_approval_grant_id = ?
               WHERE id = ? AND lifecycle = 'paused'`
            )
            .run(grantId, params.runId);
        } else {
          this.cancelRunForDecision(params.runId, params.decisionId, now);
        }
      } else if (decision.todo_id) {
        todoState = decisionTodoState(params.answerKey);
        this.db
          .prepare(
            `UPDATE run_todos SET state = ?, state_version = state_version + 1,
               block_reason_json = NULL, completed_at = ? WHERE id = ?`
          )
          .run(
            todoState,
            ['failed', 'cancelled'].includes(todoState) ? now : null,
            decision.todo_id
          );
        if (['failed', 'cancelled'].includes(todoState)) {
          this.propagateTodoDependencies(params.runId, String(decision.todo_id), todoState, now);
        }
      }
      this.appendRunEvent(
        params.runId,
        'decision.applied',
        'decision',
        params.decisionId,
        { answerKey: params.answerKey, todoState: todoState ?? null },
        now
      );
      this.settleRunIfPossible(params.runId, now);
      return { decisionStatus: 'applied', ...(todoState ? { todoState } : {}) };
    });
  }

  private buildFrozenPlan(input: CreateFormalRunInput) {
    const validation = this.db
      .prepare(
        `SELECT asset_graph_sha256, verification_scope_sha256, verification_scope_json
         FROM business_version_validations
         WHERE business_version_id = ? AND deployment_revision_id = ?
           AND status = 'valid' AND is_current = 1`
      )
      .get(input.businessVersionId, input.deploymentRevisionId) as DbRow | undefined;
    if (!validation) throw new Error('Business version has no valid verification scope');
    const scenario = this.db
      .prepare(
        `SELECT revisions.*, scenarios.id AS scenario_id
         FROM semantic_test_scenario_revisions AS revisions
         JOIN semantic_test_scenarios AS scenarios ON scenarios.id = revisions.test_scenario_id
         WHERE revisions.id = ? AND revisions.business_version_id = ?
           AND revisions.lifecycle = 'current' AND revisions.validation_status = 'valid'
           AND revisions.readiness_status = 'verified'`
      )
      .get(input.scenarioRevisionId, input.businessVersionId) as DbRow | undefined;
    if (!scenario) throw new Error('Scenario revision is not current and verified');
    this.requireExecutableVerification(
      input.businessVersionId,
      'test_scenario',
      String(scenario.scenario_id),
      input.scenarioRevisionId,
      input.deploymentRevisionId,
      String(validation.verification_scope_sha256)
    );
    const deployment = this.db
      .prepare('SELECT payload_json FROM deployment_profile_revisions WHERE id = ?')
      .get(input.deploymentRevisionId) as { payload_json: string } | undefined;
    if (!deployment) throw new Error('Deployment revision not found');
    const deploymentPayload = parseObject(deployment.payload_json);
    const environment = String(deploymentPayload.environment ?? 'test');
    const payload = parseObject(scenario.payload_json);
    const calls = parseArray(payload.calls) as Array<Record<string, unknown>>;
    const edges = parseArray(payload.edges) as Array<Record<string, unknown>>;
    const todos: RunTodoInput[] = [];
    const frozenCalls: Array<Record<string, unknown>> = [];
    const sideEffects: Array<Record<string, unknown>> = [];
    for (const call of calls) {
      const callKey = requireText(call.callKey, 'scenario callKey');
      const scriptId = requireText(call.functionalScriptId, 'functionalScriptId');
      const script = this.db
        .prepare(
          `SELECT revisions.*, scripts.functional_module_id
           FROM functional_script_revisions AS revisions
           JOIN functional_scripts AS scripts ON scripts.id = revisions.functional_script_id
           WHERE scripts.id = ? AND revisions.business_version_id = ?
             AND revisions.lifecycle = 'current' AND revisions.validation_status = 'valid'
             AND revisions.readiness_status = 'verified'`
        )
        .get(scriptId, input.businessVersionId) as DbRow | undefined;
      if (!script) throw new Error(`Functional script '${scriptId}' is not current and verified`);
      this.requireExecutableVerification(
        input.businessVersionId,
        'functional_script',
        scriptId,
        String(script.id),
        input.deploymentRevisionId,
        String(validation.verification_scope_sha256)
      );
      const scriptPayload = parseObject(script.payload_json);
      const pageId = requireText(scriptPayload.entryPageDefinitionId, 'entryPageDefinitionId');
      const pageRevision = this.db
        .prepare(
          `SELECT id FROM page_definition_revisions
           WHERE page_definition_id = ? AND business_version_id = ? AND lifecycle = 'current'`
        )
        .get(pageId, input.businessVersionId) as { id: string } | undefined;
      if (!pageRevision) throw new Error(`Script page '${pageId}' is not current`);
      const repeatCount = normalizeRepeatCount(call.repeat);
      for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
        const todoKey = repeatCount === 1 ? callKey : `${callKey}[${repeatIndex}]`;
        todos.push({
          todoKey,
          originCallKey: callKey,
          repeatIndex,
          functionalScriptRevisionId: String(script.id),
          pageDefinitionRevisionId: pageRevision.id,
          inputRedacted: {
            ...(isObject(call.inputs) ? call.inputs : {}),
            runInputs: input.inputs,
          },
          authContext: isObject(call.authContext)
            ? call.authContext
            : isObject(payload.initialAuth)
              ? payload.initialAuth
              : { kind: 'unknown' },
        });
      }
      const effects = collectSideEffects(scriptPayload);
      sideEffects.push(
        ...effects.map((effect) => ({ ...effect, callKey, scriptRevisionId: script.id }))
      );
      frozenCalls.push({
        callKey,
        functionalScriptId: scriptId,
        functionalScriptRevisionId: script.id,
        functionalModuleId: script.functional_module_id,
        pageDefinitionRevisionId: pageRevision.id,
        repeatCount,
      });
    }
    const dependencies = expandDependencies(edges, todos);
    const initialVariables: InitialRunVariableInput[] = Object.entries(input.secretRefs ?? {}).map(
      ([name, secretRef]) => ({
        namespace: 'input',
        name,
        type: 'string',
        sensitivity: 'secret',
        secretRef,
      })
    );
    return {
      assetGraphSha256: String(validation.asset_graph_sha256),
      verificationScopeSha256: String(validation.verification_scope_sha256),
      environment,
      sideEffectProjection: { environment, effects: sideEffects },
      plan: {
        schema: 'nebula.ai-e2e.run-plan/1.0',
        businessVersionId: input.businessVersionId,
        scenarioRevisionId: input.scenarioRevisionId,
        deploymentRevisionId: input.deploymentRevisionId,
        verificationScope: parseObject(validation.verification_scope_json),
        evidencePolicy: input.evidencePolicy ?? 'default',
        calls: frozenCalls,
        edges,
      },
      todos,
      dependencies,
      initialVariables,
    };
  }

  private requireExecutableVerification(
    versionId: string,
    assetType: 'functional_script' | 'test_scenario',
    assetId: string,
    revisionId: string,
    deploymentRevisionId: string,
    verificationScopeSha256: string
  ): void {
    const verification = this.db
      .prepare(
        `SELECT 1 FROM asset_revision_verifications
         WHERE business_version_id = ? AND asset_type = ? AND asset_id = ?
           AND asset_revision_id = ? AND deployment_revision_id = ?
           AND verification_scope_sha256 = ? AND status = 'verified' AND is_current = 1`
      )
      .get(
        versionId,
        assetType,
        assetId,
        revisionId,
        deploymentRevisionId,
        verificationScopeSha256
      );
    if (!verification) throw new Error(`No verified scope for ${assetType} '${assetId}'`);
  }

  private insertSideEffectDecision(
    runId: string,
    decisionId: string,
    frozen: ReturnType<SemanticRunControlRepository['buildFrozenPlan']>,
    reasonCodes: string[]
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO decision_requests
          (id, context_type, context_id, run_id, status, category, required_authority,
           question, facts_json, options_json, recommendation_key, impact_json,
           state_version, created_by, created_at)
         VALUES (?, 'run', ?, ?, 'open', 'side_effect_approval', 'user', ?, ?, ?,
           'approve', ?, 1, 'system', ?)`
      )
      .run(
        decisionId,
        runId,
        runId,
        '该运行包含 staging 高风险副作用，是否批准当前冻结计划？',
        stableStringify({ environment: frozen.environment, reasonCodes }),
        stableStringify([
          { key: 'approve', label: '批准当前计划' },
          { key: 'reject', label: '拒绝并取消运行' },
        ]),
        stableStringify({ sideEffectProjection: frozen.sideEffectProjection, plan: frozen.plan }),
        now
      );
  }

  private applyAdmission(
    runId: string,
    browserJobId: string,
    evaluationId: string,
    result: 'auto_allowed' | 'approval_required' | 'denied',
    reasonCodes: string[]
  ): void {
    inImmediateTransaction(this.db, () => {
      const run = this.requireRun(runId);
      const now = new Date().toISOString();
      const lifecycle =
        result === 'auto_allowed'
          ? 'ready'
          : result === 'approval_required'
            ? 'paused'
            : 'cancelled';
      this.db
        .prepare(
          `UPDATE test_runs SET lifecycle = ?, outcome = ?, state_version = state_version + 1,
             current_policy_evaluation_id = ?, pause_reason_json = ?, termination_reason_json = ?,
             completed_at = ? WHERE id = ?`
        )
        .run(
          lifecycle,
          result === 'denied' ? 'cancelled' : null,
          evaluationId,
          result === 'approval_required'
            ? stableStringify({ code: 'approval_required', reasonCodes })
            : null,
          result === 'denied'
            ? stableStringify({ code: 'side_effect_policy_denied', reasonCodes })
            : null,
          result === 'denied' ? now : null,
          runId
        );
      if (result === 'denied') {
        this.db
          .prepare("UPDATE browser_jobs SET state = 'cancelled', released_at = ? WHERE id = ?")
          .run(now, browserJobId);
      }
      this.appendRunEvent(
        runId,
        'side_effect_policy.evaluated',
        'side_effect_approval',
        evaluationId,
        { result, reasonCodes },
        now
      );
      this.appendRunEvent(
        runId,
        'run.lifecycle_changed',
        'run',
        runId,
        { from: run.lifecycle, to: lifecycle },
        now
      );
    });
  }

  private insertRejectedCommand(
    params: {
      commandId: string;
      runId: string;
      action: 'start' | 'pause' | 'resume' | 'cancel';
      expectedStateVersion: number;
      createdBy: string;
    },
    requestSha256: string,
    actualStateVersion: number
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO run_commands
          (id, run_id, type, expected_state_version, request_sha256, status,
           error_json, created_by, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, 'rejected', ?, ?, ?, ?)`
      )
      .run(
        params.commandId,
        params.runId,
        params.action,
        params.expectedStateVersion,
        requestSha256,
        stableStringify({ code: 'state_version_conflict', actualStateVersion }),
        params.createdBy,
        now,
        now
      );
  }

  private assertRunCanResume(runId: string): void {
    if (
      this.db
        .prepare("SELECT 1 FROM decision_requests WHERE run_id = ? AND status = 'open' LIMIT 1")
        .get(runId)
    ) {
      throw new Error('Run has an open decision');
    }
  }

  private cancelRemainingTodos(runId: string, now: string): void {
    this.db
      .prepare(
        `UPDATE run_todos SET state = 'cancelled', state_version = state_version + 1,
           completed_at = ?, block_reason_json = ?
         WHERE run_id = ? AND state NOT IN ('passed','failed','skipped','cancelled','running')`
      )
      .run(now, stableStringify({ code: 'run_cancelled' }), runId);
  }

  private updateRunLifecycle(
    run: DbRow,
    lifecycle: string,
    stateVersion: number,
    now: string,
    options: { outcome?: string; reason?: Record<string, unknown> } = {}
  ): void {
    this.db
      .prepare(
        `UPDATE test_runs SET lifecycle = ?, state_version = ?, outcome = COALESCE(?, outcome),
           started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
           completed_at = CASE WHEN ? IN ('completed','cancelled') THEN ? ELSE completed_at END,
           termination_reason_json = COALESCE(?, termination_reason_json)
         WHERE id = ? AND state_version = ?`
      )
      .run(
        lifecycle,
        stateVersion,
        options.outcome ?? null,
        lifecycle,
        now,
        lifecycle,
        now,
        options.reason ? stableStringify(options.reason) : null,
        run.id,
        run.state_version
      );
    this.appendRunEvent(
      String(run.id),
      'run.lifecycle_changed',
      'run',
      String(run.id),
      { from: run.lifecycle, to: lifecycle, reason: options.reason ?? null },
      now
    );
  }

  private insertAttemptDecision(
    todo: DbRow,
    attemptId: string,
    input: CompleteTodoAttemptInput,
    now: string
  ): string {
    const decisionId = randomUUID();
    const decision =
      input.decision ??
      (input.result === 'outcome_unknown'
        ? {
            category: 'outcome_unknown',
            question: '操作结果无法确认，请根据证据决定后续处理。',
            facts: { reasonClass: input.reasonClass },
            evidenceRefs: input.evidenceManifestId ? [input.evidenceManifestId] : [],
            options: [
              { key: 'resume', label: '确认未发生并重新检查' },
              { key: 'fail', label: '按失败处理' },
              { key: 'cancel', label: '取消该 TODO' },
            ],
            impact: input.downstreamImpact ?? {},
          }
        : {
            category: 'operator_decision',
            question: '该步骤需要人工决策。',
            facts: { reasonClass: input.reasonClass },
            options: [
              { key: 'resume', label: '继续' },
              { key: 'fail', label: '按失败处理' },
              { key: 'cancel', label: '取消该 TODO' },
            ],
            impact: input.downstreamImpact ?? {},
          });
    this.db
      .prepare(
        `INSERT INTO decision_requests
          (id, context_type, context_id, run_id, todo_id, attempt_id, status, category,
           required_authority, question, facts_json, evidence_refs_json, options_json,
           recommendation_key, impact_json, state_version, created_by, created_at)
         VALUES (?, 'run', ?, ?, ?, ?, 'open', ?, 'user', ?, ?, ?, ?, ?, ?, 1, 'system', ?)`
      )
      .run(
        decisionId,
        todo.run_id,
        todo.run_id,
        todo.id,
        attemptId,
        decision.category,
        decision.question,
        stableStringify(decision.facts),
        stableStringify(decision.evidenceRefs ?? []),
        stableStringify(decision.options),
        decision.recommendationKey ?? null,
        stableStringify(decision.impact),
        now
      );
    this.appendRunEvent(
      String(todo.run_id),
      'decision.requested',
      'decision',
      decisionId,
      { todoId: todo.id, attemptId, category: decision.category },
      now
    );
    return decisionId;
  }

  private propagateTodoDependencies(
    runId: string,
    completedTodoId: string,
    completedState: string,
    now: string
  ): void {
    const queue = [{ todoId: completedTodoId, state: completedState }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const outgoing = this.db
        .prepare(
          `SELECT dependencies.*, todos.state AS target_state
           FROM run_todo_dependencies AS dependencies
           JOIN run_todos AS todos ON todos.id = dependencies.to_todo_id
           WHERE dependencies.run_id = ? AND dependencies.from_todo_id = ?`
        )
        .all(runId, current.todoId) as DbRow[];
      for (const edge of outgoing) {
        if (!['waiting_dependencies', 'ready'].includes(String(edge.target_state))) continue;
        if (edge.mode === 'requires_success' && current.state !== 'passed') {
          this.db
            .prepare(
              `UPDATE run_todos SET state = 'skipped', state_version = state_version + 1,
                 skip_reason_json = ?, completed_at = ? WHERE id = ?`
            )
            .run(
              stableStringify({ code: 'dependency_not_passed', upstreamTodoId: current.todoId }),
              now,
              edge.to_todo_id
            );
          this.appendRunEvent(
            runId,
            'todo.state_changed',
            'todo',
            String(edge.to_todo_id),
            { from: edge.target_state, to: 'skipped', upstreamTodoId: current.todoId },
            now
          );
          queue.push({ todoId: String(edge.to_todo_id), state: 'skipped' });
          continue;
        }
        if (this.dependenciesSatisfied(runId, String(edge.to_todo_id))) {
          this.db
            .prepare(
              `UPDATE run_todos SET state = 'ready', state_version = state_version + 1
               WHERE id = ? AND state = 'waiting_dependencies'`
            )
            .run(edge.to_todo_id);
          this.appendRunEvent(
            runId,
            'todo.state_changed',
            'todo',
            String(edge.to_todo_id),
            { from: 'waiting_dependencies', to: 'ready' },
            now
          );
        }
      }
    }
  }

  private dependenciesSatisfied(runId: string, todoId: string): boolean {
    const incoming = this.db
      .prepare(
        `SELECT dependencies.mode, todos.state
         FROM run_todo_dependencies AS dependencies
         JOIN run_todos AS todos ON todos.id = dependencies.from_todo_id
         WHERE dependencies.run_id = ? AND dependencies.to_todo_id = ?`
      )
      .all(runId, todoId) as Array<{ mode: string; state: string }>;
    return incoming.every((edge) =>
      edge.mode === 'requires_success'
        ? edge.state === 'passed'
        : ['passed', 'failed', 'skipped', 'cancelled'].includes(edge.state)
    );
  }

  private settleRunIfPossible(runId: string, now: string): string {
    const run = this.requireRun(runId);
    if (run.lifecycle === 'cancelling') {
      if (
        !this.db
          .prepare("SELECT 1 FROM run_todos WHERE run_id = ? AND state = 'running' LIMIT 1")
          .get(runId)
      ) {
        this.cancelRemainingTodos(runId, now);
        this.db
          .prepare(
            `UPDATE test_runs SET lifecycle = 'cancelled', outcome = 'cancelled',
               state_version = state_version + 1, completed_at = ? WHERE id = ?`
          )
          .run(now, runId);
        this.appendRunEvent(
          runId,
          'run.completed',
          'run',
          runId,
          { lifecycle: 'cancelled', outcome: 'cancelled' },
          now
        );
        return 'cancelled';
      }
      return 'cancelling';
    }
    const states = (
      this.db.prepare('SELECT state FROM run_todos WHERE run_id = ?').all(runId) as Array<{
        state: string;
      }>
    ).map((row) => row.state);
    if (
      states.some((state) =>
        [
          'waiting_dependencies',
          'ready',
          'running',
          'waiting_decision',
          'blocked',
          'interrupted',
        ].includes(state)
      )
    ) {
      return String(run.lifecycle);
    }
    const outcome = states.every((state) => state === 'passed') ? 'passed' : 'failed';
    this.db
      .prepare(
        `UPDATE test_runs SET lifecycle = 'completed', outcome = ?,
           state_version = state_version + 1, completed_at = ? WHERE id = ?`
      )
      .run(outcome, now, runId);
    this.appendRunEvent(
      runId,
      'run.completed',
      'run',
      runId,
      { lifecycle: 'completed', outcome },
      now
    );
    return 'completed';
  }

  private cancelRunForDecision(runId: string, decisionId: string, now: string): void {
    this.cancelRemainingTodos(runId, now);
    const run = this.requireRun(runId);
    this.db
      .prepare(
        `UPDATE test_runs SET lifecycle = 'cancelled', outcome = 'cancelled',
           state_version = state_version + 1, termination_reason_json = ?, completed_at = ?
         WHERE id = ?`
      )
      .run(stableStringify({ code: 'decision_rejected', decisionId }), now, runId);
    if (run.browser_job_id) {
      this.db
        .prepare(
          `UPDATE browser_jobs SET state = 'cancelled', released_at = ?
           WHERE id = ? AND state = 'queued'`
        )
        .run(now, run.browser_job_id);
    }
  }

  private requireRun(runId: string): DbRow {
    const run = this.db.prepare('SELECT * FROM test_runs WHERE id = ?').get(runId) as
      | DbRow
      | undefined;
    if (!run) throw new Error('Run not found');
    return run;
  }

  private requireTodo(todoId: string): DbRow {
    const todo = this.db.prepare('SELECT * FROM run_todos WHERE id = ?').get(todoId) as
      | DbRow
      | undefined;
    if (!todo) throw new Error('Run TODO not found');
    return todo;
  }

  private appendRunEvent(
    runId: string,
    type: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
    now: string
  ): void {
    const run = this.db
      .prepare('SELECT next_event_seq, state_version FROM test_runs WHERE id = ?')
      .get(runId) as
      | { next_event_seq: number | bigint; state_version: number | bigint }
      | undefined;
    if (!run) throw new Error('Run not found');
    const seq = Number(run.next_event_seq);
    this.db
      .prepare('UPDATE test_runs SET next_event_seq = next_event_seq + 1 WHERE id = ?')
      .run(runId);
    this.db
      .prepare(
        `INSERT INTO run_events
          (id, run_id, seq, schema_version, type, entity_type, entity_id,
           state_version, payload_json, occurred_at, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        runId,
        seq,
        type,
        entityType,
        entityId,
        Number(run.state_version),
        stableStringify(payload),
        now,
        now
      );
  }
}

function commandTarget(from: string, action: 'start' | 'pause' | 'resume' | 'cancel'): string {
  if (action === 'start' && from === 'ready') return 'running';
  if (action === 'pause' && ['ready', 'running'].includes(from)) return 'paused';
  if (action === 'resume' && from === 'paused') return 'running';
  if (action === 'cancel' && !['completed', 'cancelled'].includes(from)) return 'cancelling';
  throw new Error(`Invalid run command ${action} from ${from}`);
}

function todoStateForResult(result: CompleteTodoAttemptInput['result']): string {
  switch (result) {
    case 'succeeded':
      return 'passed';
    case 'assertion_failed':
    case 'execution_failed':
      return 'failed';
    case 'precondition_blocked':
      return 'blocked';
    case 'recoverable_interruption':
      return 'interrupted';
    case 'decision_required':
    case 'outcome_unknown':
      return 'waiting_decision';
    case 'cancelled':
      return 'cancelled';
  }
}

function decisionTodoState(answerKey: string): string {
  if (answerKey === 'resume') return 'ready';
  if (answerKey === 'fail') return 'failed';
  if (answerKey === 'cancel') return 'cancelled';
  throw new Error(`Unsupported TODO decision answer '${answerKey}'`);
}

function evaluateSideEffectPolicy(
  environment: string,
  projection: { effects: Array<Record<string, unknown>> }
): { result: 'auto_allowed' | 'approval_required' | 'denied'; reasonCodes: string[] } {
  const effects = projection.effects;
  const hasBusinessWrite = effects.some((effect) =>
    ['create', 'update', 'delete', 'upload', 'submit'].includes(String(effect.kind))
  );
  const hasHighRisk = effects.some(
    (effect) =>
      ['delete', 'upload'].includes(String(effect.kind)) ||
      effect.irreversible === true ||
      (typeof effect.quantity === 'number' && effect.quantity > 1)
  );
  if (environment === 'production' && hasBusinessWrite) {
    return { result: 'denied', reasonCodes: ['production_business_write_denied'] };
  }
  if (environment === 'staging' && hasHighRisk) {
    return { result: 'approval_required', reasonCodes: ['staging_high_risk_approval'] };
  }
  return { result: 'auto_allowed', reasonCodes: ['declared_effects_within_policy'] };
}

function collectSideEffects(
  scriptPayload: Record<string, unknown>
): Array<Record<string, unknown>> {
  return (parseArray(scriptPayload.steps) as Array<Record<string, unknown>>)
    .map((step) => (isObject(step.effect) ? step.effect : null))
    .filter((effect): effect is Record<string, unknown> => Boolean(effect));
}

function expandDependencies(
  edges: Array<Record<string, unknown>>,
  todos: RunTodoInput[]
): RunTodoDependencyInput[] {
  const byCall = new Map<string, RunTodoInput[]>();
  for (const todo of todos) {
    const list = byCall.get(todo.originCallKey) ?? [];
    list.push(todo);
    byCall.set(todo.originCallKey, list);
  }
  const dependencies: RunTodoDependencyInput[] = [];
  for (const edge of edges) {
    const fromKey = requireText(edge.fromCallKey, 'fromCallKey');
    const toKey = requireText(edge.toCallKey, 'toCallKey');
    const fromTodos = byCall.get(fromKey) ?? [];
    const toTodos = byCall.get(toKey) ?? [];
    for (const from of fromTodos) {
      for (const to of toTodos) {
        dependencies.push({
          fromTodoKey: from.todoKey,
          toTodoKey: to.todoKey,
          mode: edge.mode === 'requires_completion' ? 'requires_completion' : 'requires_success',
          requiresOutputs: Array.isArray(edge.requiresOutputs)
            ? edge.requiresOutputs.filter((value): value is string => typeof value === 'string')
            : [],
        });
      }
    }
  }
  return dependencies;
}

function normalizeRepeatCount(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100)
    return value;
  if (isObject(value) && typeof value.count === 'number') {
    const count = value.count;
    if (Number.isInteger(count) && count > 0 && count <= 100) return count;
  }
  return 1;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is required`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return isObject(parsed) ? parsed : {};
}

function parseArray(value: unknown): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
