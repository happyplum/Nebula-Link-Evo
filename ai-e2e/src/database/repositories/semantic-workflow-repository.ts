import { randomUUID } from 'node:crypto';
import {
  assertNoInlineSecrets,
  hashValue,
  inImmediateTransaction,
  requireSha256,
  stableStringify,
  type DatabaseLike,
  type SupportedDatabase,
} from './semantic-repository-utils.js';

export type AuthoringLifecycle =
  | 'created'
  | 'planning'
  | 'running'
  | 'paused'
  | 'waiting_decision'
  | 'completing'
  | 'completed'
  | 'cancelling'
  | 'cancelled'
  | 'failed';

export type RunLifecycle =
  | 'created'
  | 'planning'
  | 'ready'
  | 'running'
  | 'paused'
  | 'completing'
  | 'completed'
  | 'cancelling'
  | 'cancelled';

export interface CreateAuthoringJobParams {
  id?: string;
  projectId: string;
  businessVersionId: string;
  mode: 'bootstrap' | 'recheck' | 'repair' | 'import_conversion';
  idempotencyKey: string;
  stage: string;
  strategyVersion: string;
  sourceFingerprint: string;
  input: unknown;
  createdBy: string;
  parentRunId?: string;
}

export interface AuthoringJobResult {
  id: string;
  browserJobId: string;
  lifecycle: AuthoringLifecycle;
  stateVersion: number;
  created: boolean;
}

export interface AuthoringCommandParams {
  id: string;
  jobId: string;
  type: 'start' | 'pause' | 'resume' | 'cancel' | 'answer_decision';
  expectedStateVersion: number;
  payload?: unknown;
  createdBy: string;
}

export interface CreateAuthoringTaskParams {
  id?: string;
  jobId: string;
  taskKey: string;
  type:
    | 'ingest_prd'
    | 'extract_requirements'
    | 'discover_page'
    | 'model_page'
    | 'specify_module'
    | 'generate_script'
    | 'generate_scenario'
    | 'verify_script'
    | 'verify_scenario'
    | 'analyze_impact'
    | 'validate_version'
    | 'activate_assets';
  dependencies?: readonly string[];
  targetType?: string;
  targetId?: string;
  inputRedacted: unknown;
  toolPolicyHash: string;
  skillPolicyHash: string;
  budget: unknown;
}

export interface CompleteAuthoringAttemptParams {
  id?: string;
  taskId: string;
  status: 'succeeded' | 'failed' | 'blocked' | 'interrupted' | 'decision_required' | 'cancelled';
  agentTaskId?: string;
  pageTaskRef?: string;
  candidateAssetType?: string;
  candidateAssetId?: string;
  candidateRevisionId?: string;
  result?: unknown;
  evidenceManifestId?: string;
  error?: unknown;
  startedAt: string;
}

export interface RunTodoInput {
  id?: string;
  todoKey: string;
  originCallKey: string;
  repeatIndex?: number;
  functionalScriptRevisionId: string;
  pageDefinitionRevisionId: string;
  inputRedacted: unknown;
  inputSecretRefs?: readonly string[];
  authContext: unknown;
}

export interface RunTodoDependencyInput {
  fromTodoKey: string;
  toTodoKey: string;
  mode: 'requires_success' | 'requires_completion';
  requiresOutputs?: readonly string[];
}

export interface InitialRunVariableInput {
  id?: string;
  namespace: string;
  name: string;
  type: string;
  sensitivity: 'public' | 'sensitive' | 'secret';
  value?: unknown;
  secretRef?: string;
}

export interface CreateSemanticRunParams {
  id?: string;
  projectId: string;
  businessVersionId: string;
  clientRunId: string;
  purpose: 'formal' | 'authoring_verification';
  authoringJobId?: string;
  scenarioRevisionId: string;
  deploymentRevisionId: string;
  assetGraphSha256?: string;
  verificationScopeSha256?: string;
  sideEffectPolicyVersion: string;
  sideEffectProjection: unknown;
  planSchemaId: string;
  plan: unknown;
  todos: readonly RunTodoInput[];
  dependencies: readonly RunTodoDependencyInput[];
  initialVariables?: readonly InitialRunVariableInput[];
}

export interface SemanticRunResult {
  id: string;
  browserJobId: string;
  lifecycle: RunLifecycle;
  stateVersion: number;
  created: boolean;
}

export interface RunCommandParams {
  id: string;
  runId: string;
  type: 'create' | 'start' | 'pause' | 'resume' | 'cancel' | 'answer' | 'apply';
  expectedStateVersion: number;
  payload?: unknown;
  createdBy: string;
}

export interface CommandAcceptance {
  status: 'accepted' | 'rejected';
  replayed: boolean;
  stateVersion: number;
}

export type BrowserJobState =
  | 'queued'
  | 'acquiring'
  | 'active'
  | 'releasing'
  | 'completed'
  | 'cancelled'
  | 'failed';

const AUTHORING_TRANSITIONS: Record<AuthoringLifecycle, readonly AuthoringLifecycle[]> = {
  created: ['planning', 'cancelling', 'cancelled', 'failed'],
  planning: ['running', 'paused', 'waiting_decision', 'cancelling', 'failed'],
  running: ['paused', 'waiting_decision', 'completing', 'cancelling', 'failed'],
  paused: ['running', 'waiting_decision', 'cancelling', 'failed'],
  waiting_decision: ['running', 'paused', 'cancelling', 'failed'],
  completing: ['completed', 'failed'],
  completed: [],
  cancelling: ['cancelled', 'failed'],
  cancelled: [],
  failed: [],
};

const RUN_TRANSITIONS: Record<RunLifecycle, readonly RunLifecycle[]> = {
  created: ['planning', 'cancelling', 'cancelled'],
  planning: ['ready', 'paused', 'cancelling'],
  ready: ['running', 'paused', 'cancelling'],
  running: ['paused', 'completing', 'cancelling'],
  paused: ['running', 'cancelling'],
  completing: ['completed', 'cancelling'],
  completed: [],
  cancelling: ['cancelled'],
  cancelled: [],
};

export class SemanticWorkflowRepository {
  private readonly db: DatabaseLike;

  constructor(db: SupportedDatabase) {
    this.db = db as unknown as DatabaseLike;
  }

  createAuthoringJob(params: CreateAuthoringJobParams): AuthoringJobResult {
    assertNoInlineSecrets(params.input);
    const requestSha256 = hashValue({
      projectId: params.projectId,
      businessVersionId: params.businessVersionId,
      mode: params.mode,
      stage: params.stage,
      strategyVersion: params.strategyVersion,
      sourceFingerprint: params.sourceFingerprint,
      input: params.input,
      parentRunId: params.parentRunId ?? null,
    });
    return inImmediateTransaction(this.db, () => {
      const existing = this.db
        .prepare(
          `SELECT id, browser_job_id, lifecycle, state_version, request_sha256
           FROM authoring_jobs WHERE business_version_id = ? AND idempotency_key = ?`
        )
        .get(params.businessVersionId, params.idempotencyKey) as
        | {
            id: string;
            browser_job_id: string;
            lifecycle: AuthoringLifecycle;
            state_version: number | bigint;
            request_sha256: string;
          }
        | undefined;
      if (existing) {
        if (existing.request_sha256 !== requestSha256) {
          throw new Error('Authoring idempotency key was reused with different input');
        }
        return {
          id: existing.id,
          browserJobId: existing.browser_job_id,
          lifecycle: existing.lifecycle,
          stateVersion: Number(existing.state_version),
          created: false,
        };
      }
      this.requireProjectVersion(params.projectId, params.businessVersionId);
      const id = params.id ?? randomUUID();
      const browserJobId = params.parentRunId
        ? this.requireParentRunBrowserJob(params.parentRunId, params.businessVersionId)
        : this.enqueueBrowserJob('authoring', id);
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO authoring_jobs
            (id, project_id, business_version_id, mode, idempotency_key, request_sha256,
             parent_run_id, browser_job_id, lifecycle, stage, strategy_version,
             source_fingerprint, input_sha256, state_version, next_event_seq,
             created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, 1, 2, ?, ?)`
        )
        .run(
          id,
          params.projectId,
          params.businessVersionId,
          params.mode,
          params.idempotencyKey,
          requestSha256,
          params.parentRunId ?? null,
          browserJobId,
          params.stage,
          params.strategyVersion,
          params.sourceFingerprint,
          hashValue(params.input),
          params.createdBy,
          now
        );
      this.insertAuthoringEvent(
        id,
        1,
        'authoring.created',
        'authoring_job',
        id,
        1,
        {
          mode: params.mode,
          browserJobId,
        },
        null,
        null,
        now
      );
      return { id, browserJobId, lifecycle: 'created', stateVersion: 1, created: true };
    });
  }

  acceptAuthoringCommand(params: AuthoringCommandParams): CommandAcceptance {
    if (params.payload !== undefined) assertNoInlineSecrets(params.payload);
    const requestSha256 = hashValue({ type: params.type, payload: params.payload ?? null });
    return inImmediateTransaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT * FROM authoring_commands WHERE id = ?')
        .get(params.id) as Record<string, unknown> | undefined;
      if (existing) {
        if (
          existing.job_id !== params.jobId ||
          existing.request_sha256 !== requestSha256 ||
          Number(existing.expected_state_version) !== params.expectedStateVersion
        ) {
          throw new Error('Authoring command id was reused with different input');
        }
        return {
          status: String(existing.status) as 'accepted' | 'rejected',
          replayed: true,
          stateVersion: this.authoringStateVersion(params.jobId),
        };
      }
      const job = this.db
        .prepare('SELECT state_version, next_event_seq FROM authoring_jobs WHERE id = ?')
        .get(params.jobId) as
        | { state_version: number | bigint; next_event_seq: number | bigint }
        | undefined;
      if (!job) throw new Error('Authoring job not found');
      const stateVersion = Number(job.state_version);
      const accepted = stateVersion === params.expectedStateVersion;
      const now = new Date().toISOString();
      const error = accepted
        ? null
        : stableStringify({ code: 'state_version_conflict', actualStateVersion: stateVersion });
      this.db
        .prepare(
          `INSERT INTO authoring_commands
            (id, job_id, type, expected_state_version, request_sha256, status,
             error_json, created_by, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.id,
          params.jobId,
          params.type,
          params.expectedStateVersion,
          requestSha256,
          accepted ? 'accepted' : 'rejected',
          error,
          params.createdBy,
          now,
          accepted ? null : now
        );
      if (!accepted) {
        this.bumpAuthoringEvent(
          params.jobId,
          Number(job.next_event_seq),
          'authoring.command_rejected',
          'authoring_job',
          params.jobId,
          { commandId: params.id, expectedStateVersion: params.expectedStateVersion, stateVersion },
          now
        );
      }
      return { status: accepted ? 'accepted' : 'rejected', replayed: false, stateVersion };
    });
  }

  createAuthoringTask(params: CreateAuthoringTaskParams): { id: string; created: boolean } {
    assertNoInlineSecrets(params.inputRedacted);
    assertNoInlineSecrets(params.budget);
    requireSha256(params.toolPolicyHash, 'toolPolicyHash');
    requireSha256(params.skillPolicyHash, 'skillPolicyHash');
    return inImmediateTransaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT id, input_sha256 FROM authoring_tasks WHERE job_id = ? AND task_key = ?')
        .get(params.jobId, params.taskKey) as { id: string; input_sha256: string } | undefined;
      const inputSha256 = hashValue(params.inputRedacted);
      if (existing) {
        if (existing.input_sha256 !== inputSha256) {
          throw new Error('Authoring task key was reused with different input');
        }
        return { id: existing.id, created: false };
      }
      const job = this.db
        .prepare('SELECT lifecycle, next_event_seq FROM authoring_jobs WHERE id = ?')
        .get(params.jobId) as
        | { lifecycle: AuthoringLifecycle; next_event_seq: number | bigint }
        | undefined;
      if (!job || ['completed', 'cancelled', 'failed'].includes(job.lifecycle)) {
        throw new Error('Authoring job is not writable');
      }
      const dependencies = params.dependencies ?? [];
      for (const dependencyKey of dependencies) {
        if (
          !this.db
            .prepare('SELECT id FROM authoring_tasks WHERE job_id = ? AND task_key = ?')
            .get(params.jobId, dependencyKey)
        ) {
          throw new Error(`Unknown authoring task dependency: ${dependencyKey}`);
        }
      }
      const id = params.id ?? randomUUID();
      const state = dependencies.length === 0 ? 'ready' : 'pending';
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO authoring_tasks
            (id, job_id, task_key, type, state, dependencies_json, target_type, target_id,
             input_sha256, input_json_redacted, tool_policy_hash, skill_policy_hash,
             budget_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.jobId,
          params.taskKey,
          params.type,
          state,
          stableStringify(dependencies),
          params.targetType ?? null,
          params.targetId ?? null,
          inputSha256,
          stableStringify(params.inputRedacted),
          params.toolPolicyHash,
          params.skillPolicyHash,
          stableStringify(params.budget),
          now
        );
      this.bumpAuthoringEvent(
        params.jobId,
        Number(job.next_event_seq),
        'authoring_task.created',
        'authoring_task',
        id,
        { taskKey: params.taskKey, state },
        now
      );
      return { id, created: true };
    });
  }

  startAuthoringTask(taskId: string): void {
    inImmediateTransaction(this.db, () => {
      const task = this.db
        .prepare(
          `SELECT t.*, j.next_event_seq, j.lifecycle AS job_lifecycle
           FROM authoring_tasks t JOIN authoring_jobs j ON j.id = t.job_id WHERE t.id = ?`
        )
        .get(taskId) as Record<string, unknown> | undefined;
      if (!task || task.state !== 'ready') throw new Error('Authoring task is not ready');
      if (['completed', 'cancelled', 'failed'].includes(String(task.job_lifecycle))) {
        throw new Error('Authoring job is not writable');
      }
      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE authoring_tasks SET state = 'running', started_at = ? WHERE id = ?")
        .run(now, taskId);
      this.db
        .prepare(
          `UPDATE authoring_jobs SET active_task_id = ?, lifecycle = 'running',
             started_at = COALESCE(started_at, ?), state_version = state_version + 1
           WHERE id = ?`
        )
        .run(taskId, now, task.job_id);
      this.bumpAuthoringEvent(
        String(task.job_id),
        Number(task.next_event_seq),
        'authoring_task.state_changed',
        'authoring_task',
        taskId,
        { from: 'ready', to: 'running' },
        now
      );
    });
  }

  completeAuthoringAttempt(params: CompleteAuthoringAttemptParams): {
    id: string;
    attemptNo: number;
  } {
    if (params.result !== undefined) assertNoInlineSecrets(params.result);
    if (params.error !== undefined) assertNoInlineSecrets(params.error);
    return inImmediateTransaction(this.db, () => {
      const task = this.db
        .prepare(
          `SELECT t.*, j.next_event_seq FROM authoring_tasks t
           JOIN authoring_jobs j ON j.id = t.job_id WHERE t.id = ?`
        )
        .get(params.taskId) as Record<string, unknown> | undefined;
      if (!task || task.state !== 'running') throw new Error('Authoring task is not running');
      const next = this.db
        .prepare(
          'SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no FROM authoring_attempts WHERE task_id = ?'
        )
        .get(params.taskId) as { attempt_no: number | bigint };
      const attemptNo = Number(next.attempt_no);
      const id = params.id ?? randomUUID();
      const completedAt = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO authoring_attempts
            (id, job_id, task_id, attempt_no, agent_task_id, page_task_ref, status,
             candidate_asset_type, candidate_asset_id, candidate_revision_id, input_sha256,
             result_json, evidence_manifest_id, error_json, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          task.job_id,
          params.taskId,
          attemptNo,
          params.agentTaskId ?? null,
          params.pageTaskRef ?? null,
          params.status,
          params.candidateAssetType ?? null,
          params.candidateAssetId ?? null,
          params.candidateRevisionId ?? null,
          task.input_sha256,
          params.result === undefined ? null : stableStringify(params.result),
          params.evidenceManifestId ?? null,
          params.error === undefined ? null : stableStringify(params.error),
          params.startedAt,
          completedAt
        );
      const state =
        params.status === 'decision_required'
          ? 'waiting_decision'
          : params.status === 'interrupted'
            ? 'blocked'
            : params.status;
      this.db
        .prepare(
          `UPDATE authoring_tasks
           SET state = ?, current_attempt_id = ?, completed_at = ? WHERE id = ?`
        )
        .run(state, id, completedAt, params.taskId);
      this.db
        .prepare(
          `UPDATE authoring_jobs SET active_task_id = NULL,
             lifecycle = CASE WHEN ? = 'waiting_decision' THEN 'waiting_decision' ELSE lifecycle END,
             state_version = state_version + 1
           WHERE id = ?`
        )
        .run(state, task.job_id);
      this.bumpAuthoringEvent(
        String(task.job_id),
        Number(task.next_event_seq),
        'authoring_attempt.completed',
        'authoring_attempt',
        id,
        { taskId: params.taskId, attemptNo, status: params.status, taskState: state },
        completedAt
      );
      return { id, attemptNo };
    });
  }

  applyAuthoringTransition(
    commandId: string,
    to: AuthoringLifecycle,
    result?: unknown
  ): { lifecycle: AuthoringLifecycle; stateVersion: number } {
    if (result !== undefined) assertNoInlineSecrets(result);
    return inImmediateTransaction(this.db, () => {
      const command = this.db
        .prepare('SELECT * FROM authoring_commands WHERE id = ?')
        .get(commandId) as Record<string, unknown> | undefined;
      if (!command || command.status !== 'accepted') throw new Error('Accepted command not found');
      const job = this.db
        .prepare('SELECT * FROM authoring_jobs WHERE id = ?')
        .get(command.job_id) as Record<string, unknown> | undefined;
      if (!job) throw new Error('Authoring job not found');
      const from = String(job.lifecycle) as AuthoringLifecycle;
      const stateVersion = Number(job.state_version);
      if (stateVersion !== Number(command.expected_state_version)) {
        throw new Error('Authoring state version changed before command application');
      }
      if (!AUTHORING_TRANSITIONS[from].includes(to)) {
        throw new Error(`Invalid authoring transition ${from} -> ${to}`);
      }
      const nextVersion = stateVersion + 1;
      const now = new Date().toISOString();
      const terminal = ['completed', 'cancelled', 'failed'].includes(to);
      this.db
        .prepare(
          `UPDATE authoring_jobs
           SET lifecycle = ?, state_version = ?,
               started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
               completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
               outcome = CASE
                 WHEN ? = 'completed' THEN 'succeeded'
                 WHEN ? = 'cancelled' THEN 'cancelled'
                 WHEN ? = 'failed' THEN 'failed'
                 ELSE outcome END,
               result_json = COALESCE(?, result_json), next_event_seq = next_event_seq + 1
           WHERE id = ? AND state_version = ?`
        )
        .run(
          to,
          nextVersion,
          to,
          now,
          terminal ? 1 : 0,
          now,
          to,
          to,
          to,
          result === undefined ? null : stableStringify(result),
          job.id,
          stateVersion
        );
      this.db
        .prepare(
          `UPDATE authoring_commands SET status = 'completed', result_json = ?, completed_at = ?
           WHERE id = ?`
        )
        .run(result === undefined ? null : stableStringify(result), now, commandId);
      this.insertAuthoringEvent(
        String(job.id),
        Number(job.next_event_seq),
        'authoring.state_changed',
        'authoring_job',
        String(job.id),
        nextVersion,
        { from, to, result: result ?? null },
        commandId,
        commandId,
        now
      );
      return { lifecycle: to, stateVersion: nextVersion };
    });
  }

  createRun(params: CreateSemanticRunParams): SemanticRunResult {
    this.validateRunInput(params);
    const requestSha256 = hashValue(params);
    return inImmediateTransaction(this.db, () => {
      const existing = this.db
        .prepare(
          `SELECT id, browser_job_id, lifecycle, state_version, request_sha256
           FROM test_runs WHERE project_id = ? AND client_run_id = ?`
        )
        .get(params.projectId, params.clientRunId) as
        | {
            id: string;
            browser_job_id: string;
            lifecycle: RunLifecycle;
            state_version: number | bigint;
            request_sha256: string;
          }
        | undefined;
      if (existing) {
        if (existing.request_sha256 !== requestSha256) {
          throw new Error('clientRunId was reused with different input');
        }
        return {
          id: existing.id,
          browserJobId: existing.browser_job_id,
          lifecycle: existing.lifecycle,
          stateVersion: Number(existing.state_version),
          created: false,
        };
      }
      this.requireRunTargets(params);
      const id = params.id ?? randomUUID();
      let browserJobId: string;
      if (params.purpose === 'authoring_verification') {
        if (!params.authoringJobId) throw new Error('Authoring verification requires authoringJobId');
        browserJobId = this.requireAuthoringBrowserJob(
          params.authoringJobId,
          params.businessVersionId
        );
      } else {
        browserJobId = this.enqueueBrowserJob('run', id);
      }
      const now = new Date().toISOString();
      const projectionSha256 = hashValue(params.sideEffectProjection);
      this.db
        .prepare(
          `INSERT INTO test_runs
            (id, project_id, business_version_id, client_run_id, request_sha256, purpose,
             authoring_job_id, browser_job_id, scenario_revision_id, deployment_revision_id,
             lifecycle, state_version, next_event_seq, side_effect_policy_version,
             side_effect_projection_sha256, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', 1, 2, ?, ?, ?)`
        )
        .run(
          id,
          params.projectId,
          params.businessVersionId,
          params.clientRunId,
          requestSha256,
          params.purpose,
          params.authoringJobId ?? null,
          browserJobId,
          params.scenarioRevisionId,
          params.deploymentRevisionId,
          params.sideEffectPolicyVersion,
          projectionSha256,
          now
        );
      const planJson = stableStringify(params.plan);
      this.db
        .prepare(
          `INSERT INTO run_plans (id, run_id, schema_id, payload_json, content_sha256, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), id, params.planSchemaId, planJson, hashValue(params.plan), now);
      const todoIds = new Map<string, string>();
      const insertTodo = this.db.prepare(
        `INSERT INTO run_todos
          (id, run_id, todo_key, origin_call_key, repeat_index,
           functional_script_revision_id, page_definition_revision_id, state,
           input_json_redacted, input_secret_refs_json, auth_context_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting_dependencies', ?, ?, ?)`
      );
      for (const todo of params.todos) {
        if (todoIds.has(todo.todoKey)) throw new Error(`Duplicate todoKey: ${todo.todoKey}`);
        const todoId = todo.id ?? randomUUID();
        todoIds.set(todo.todoKey, todoId);
        insertTodo.run(
          todoId,
          id,
          todo.todoKey,
          todo.originCallKey,
          todo.repeatIndex ?? 0,
          todo.functionalScriptRevisionId,
          todo.pageDefinitionRevisionId,
          stableStringify(todo.inputRedacted),
          stableStringify(todo.inputSecretRefs ?? []),
          stableStringify(todo.authContext)
        );
      }
      const insertDependency = this.db.prepare(
        `INSERT INTO run_todo_dependencies
          (run_id, from_todo_id, to_todo_id, mode, requires_outputs_json)
         VALUES (?, ?, ?, ?, ?)`
      );
      const dependentTodoIds = new Set<string>();
      for (const dependency of params.dependencies) {
        const fromId = todoIds.get(dependency.fromTodoKey);
        const toId = todoIds.get(dependency.toTodoKey);
        if (!fromId || !toId) throw new Error('Run dependency references an unknown todoKey');
        dependentTodoIds.add(toId);
        insertDependency.run(
          id,
          fromId,
          toId,
          dependency.mode,
          stableStringify(dependency.requiresOutputs ?? [])
        );
      }
      for (const todoId of todoIds.values()) {
        if (!dependentTodoIds.has(todoId)) {
          this.db.prepare("UPDATE run_todos SET state = 'ready' WHERE id = ?").run(todoId);
        }
      }
      const insertVariable = this.db.prepare(
        `INSERT INTO run_variables
          (id, run_id, namespace, name, type, sensitivity, status,
           value_json, secret_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`
      );
      for (const variable of params.initialVariables ?? []) {
        const isSecret = variable.sensitivity === 'secret';
        if (
          isSecret !== Boolean(variable.secretRef) ||
          (isSecret && variable.value !== undefined)
        ) {
          throw new Error(
            'Secret run variables require secretRef and cannot contain inline values'
          );
        }
        insertVariable.run(
          variable.id ?? randomUUID(),
          id,
          variable.namespace,
          variable.name,
          variable.type,
          variable.sensitivity,
          variable.value === undefined ? null : stableStringify(variable.value),
          variable.secretRef ?? null,
          now
        );
      }
      this.insertRunEvent(
        id,
        1,
        'run.created',
        'run',
        id,
        1,
        {
          browserJobId,
          todoCount: params.todos.length,
          sideEffectProjectionSha256: projectionSha256,
        },
        null,
        null,
        now
      );
      return { id, browserJobId, lifecycle: 'created', stateVersion: 1, created: true };
    });
  }

  acceptRunCommand(params: RunCommandParams): CommandAcceptance {
    if (params.payload !== undefined) assertNoInlineSecrets(params.payload);
    const requestSha256 = hashValue({ type: params.type, payload: params.payload ?? null });
    return inImmediateTransaction(this.db, () => {
      const existing = this.db.prepare('SELECT * FROM run_commands WHERE id = ?').get(params.id) as
        | Record<string, unknown>
        | undefined;
      if (existing) {
        if (
          existing.run_id !== params.runId ||
          existing.request_sha256 !== requestSha256 ||
          Number(existing.expected_state_version) !== params.expectedStateVersion
        ) {
          throw new Error('Run command id was reused with different input');
        }
        return {
          status: String(existing.status) as 'accepted' | 'rejected',
          replayed: true,
          stateVersion: this.runStateVersion(params.runId),
        };
      }
      const run = this.db
        .prepare('SELECT state_version, next_event_seq FROM test_runs WHERE id = ?')
        .get(params.runId) as
        | { state_version: number | bigint; next_event_seq: number | bigint }
        | undefined;
      if (!run) throw new Error('Run not found');
      const stateVersion = Number(run.state_version);
      const accepted = stateVersion === params.expectedStateVersion;
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO run_commands
            (id, run_id, type, expected_state_version, request_sha256, status,
             error_json, created_by, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.id,
          params.runId,
          params.type,
          params.expectedStateVersion,
          requestSha256,
          accepted ? 'accepted' : 'rejected',
          accepted
            ? null
            : stableStringify({ code: 'state_version_conflict', actualStateVersion: stateVersion }),
          params.createdBy,
          now,
          accepted ? null : now
        );
      if (!accepted) {
        this.db
          .prepare('UPDATE test_runs SET next_event_seq = next_event_seq + 1 WHERE id = ?')
          .run(params.runId);
        this.insertRunEvent(
          params.runId,
          Number(run.next_event_seq),
          'run.command_rejected',
          'run',
          params.runId,
          stateVersion,
          { commandId: params.id, expectedStateVersion: params.expectedStateVersion, stateVersion },
          params.id,
          params.id,
          now
        );
      }
      return { status: accepted ? 'accepted' : 'rejected', replayed: false, stateVersion };
    });
  }

  applyRunTransition(
    commandId: string,
    to: RunLifecycle,
    outcome?: 'passed' | 'failed' | 'cancelled',
    result?: unknown
  ): { lifecycle: RunLifecycle; stateVersion: number } {
    if (result !== undefined) assertNoInlineSecrets(result);
    return inImmediateTransaction(this.db, () => {
      const command = this.db.prepare('SELECT * FROM run_commands WHERE id = ?').get(commandId) as
        | Record<string, unknown>
        | undefined;
      if (!command || command.status !== 'accepted') throw new Error('Accepted command not found');
      const run = this.db.prepare('SELECT * FROM test_runs WHERE id = ?').get(command.run_id) as
        | Record<string, unknown>
        | undefined;
      if (!run) throw new Error('Run not found');
      const from = String(run.lifecycle) as RunLifecycle;
      const stateVersion = Number(run.state_version);
      if (stateVersion !== Number(command.expected_state_version)) {
        throw new Error('Run state version changed before command application');
      }
      if (!RUN_TRANSITIONS[from].includes(to))
        throw new Error(`Invalid run transition ${from} -> ${to}`);
      if (to === 'completed' && !outcome) throw new Error('Completed runs require an outcome');
      if (to === 'cancelled' && outcome && outcome !== 'cancelled') {
        throw new Error('Cancelled runs can only use cancelled outcome');
      }
      const nextVersion = stateVersion + 1;
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE test_runs
           SET lifecycle = ?, outcome = COALESCE(?, outcome), state_version = ?,
               started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
               completed_at = CASE WHEN ? IN ('completed','cancelled') THEN ? ELSE completed_at END,
               summary_json = COALESCE(?, summary_json), next_event_seq = next_event_seq + 1
           WHERE id = ? AND state_version = ?`
        )
        .run(
          to,
          outcome ?? null,
          nextVersion,
          to,
          now,
          to,
          now,
          result === undefined ? null : stableStringify(result),
          run.id,
          stateVersion
        );
      this.db
        .prepare(
          `UPDATE run_commands SET status = 'completed', result_json = ?, completed_at = ?
           WHERE id = ?`
        )
        .run(result === undefined ? null : stableStringify(result), now, commandId);
      this.insertRunEvent(
        String(run.id),
        Number(run.next_event_seq),
        'run.state_changed',
        'run',
        String(run.id),
        nextVersion,
        { from, to, outcome: outcome ?? null, result: result ?? null },
        commandId,
        commandId,
        now
      );
      return { lifecycle: to, stateVersion: nextVersion };
    });
  }

  listRunEvents(runId: string, afterSeq = 0): unknown[] {
    return this.db
      .prepare('SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq')
      .all(runId, afterSeq);
  }

  listAuthoringEvents(jobId: string, afterSeq = 0): unknown[] {
    return this.db
      .prepare('SELECT * FROM authoring_events WHERE job_id = ? AND seq > ? ORDER BY seq')
      .all(jobId, afterSeq);
  }

  claimNextBrowserJob(): Record<string, unknown> | null {
    return inImmediateTransaction(this.db, () => {
      const active = this.db
        .prepare(
          `SELECT id FROM browser_jobs WHERE state IN ('acquiring','active','releasing') LIMIT 1`
        )
        .get();
      if (active) return null;
      const job = this.db
        .prepare(
          `SELECT jobs.* FROM browser_jobs AS jobs
           LEFT JOIN test_runs AS runs
             ON jobs.root_context_type = 'run' AND runs.id = jobs.root_context_id
           LEFT JOIN authoring_jobs AS authoring
             ON jobs.root_context_type = 'authoring' AND authoring.id = jobs.root_context_id
           WHERE jobs.state = 'queued'
             AND (
               (jobs.root_context_type = 'run'
                 AND runs.lifecycle IN ('created','planning','ready','running','completing'))
               OR
               (jobs.root_context_type = 'authoring'
                 AND authoring.lifecycle IN ('created','planning','running','completing'))
             )
           ORDER BY jobs.queue_seq LIMIT 1`
        )
        .get() as Record<string, unknown> | undefined;
      if (!job) return null;
      this.db
        .prepare("UPDATE browser_jobs SET state = 'acquiring' WHERE id = ? AND state = 'queued'")
        .run(job.id);
      return { ...job, state: 'acquiring' };
    });
  }

  transitionBrowserJob(
    id: string,
    to: BrowserJobState,
    options?: { browserSessionId?: string; capabilitySnapshotSha256?: string; error?: unknown }
  ): void {
    if (options?.capabilitySnapshotSha256) {
      requireSha256(options.capabilitySnapshotSha256, 'capabilitySnapshotSha256');
    }
    if (options?.error !== undefined) assertNoInlineSecrets(options.error);
    const allowed: Record<BrowserJobState, readonly BrowserJobState[]> = {
      queued: ['acquiring', 'cancelled'],
      acquiring: ['active', 'cancelled', 'failed'],
      active: ['releasing', 'failed'],
      releasing: ['completed', 'failed'],
      completed: [],
      cancelled: [],
      failed: [],
    };
    inImmediateTransaction(this.db, () => {
      const job = this.db.prepare('SELECT state FROM browser_jobs WHERE id = ?').get(id) as
        | { state: BrowserJobState }
        | undefined;
      if (!job) throw new Error('Browser job not found');
      if (job.state === to) return;
      if (!allowed[job.state].includes(to)) {
        throw new Error(`Invalid browser job transition ${job.state} -> ${to}`);
      }
      if (to === 'active' && !options?.browserSessionId) {
        throw new Error('Active browser jobs require browserSessionId');
      }
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE browser_jobs
           SET state = ?, browser_session_id = COALESCE(?, browser_session_id),
               capability_snapshot_sha256 = COALESCE(?, capability_snapshot_sha256),
               acquired_at = CASE WHEN ? = 'active' THEN ? ELSE acquired_at END,
               released_at = CASE WHEN ? IN ('completed','cancelled','failed') THEN ? ELSE released_at END,
               error_json = COALESCE(?, error_json)
           WHERE id = ?`
        )
        .run(
          to,
          options?.browserSessionId ?? null,
          options?.capabilitySnapshotSha256 ?? null,
          to,
          now,
          to,
          now,
          options?.error === undefined ? null : stableStringify(options.error),
          id
        );
    });
  }

  private validateRunInput(params: CreateSemanticRunParams): void {
    assertNoInlineSecrets(params.plan);
    assertNoInlineSecrets(params.sideEffectProjection);
    for (const todo of params.todos) {
      assertNoInlineSecrets(todo.inputRedacted);
      assertNoInlineSecrets(todo.authContext);
    }
    for (const variable of params.initialVariables ?? []) {
      if (variable.value !== undefined) assertNoInlineSecrets(variable.value);
    }
    if (params.assetGraphSha256) requireSha256(params.assetGraphSha256, 'assetGraphSha256');
    if (params.verificationScopeSha256) {
      requireSha256(params.verificationScopeSha256, 'verificationScopeSha256');
    }
    if (params.todos.length > 1000) throw new Error('Run plan exceeds the 1000 TODO limit');
    const todoKeys = new Set<string>();
    for (const todo of params.todos) {
      if (todoKeys.has(todo.todoKey)) throw new Error(`Duplicate todoKey: ${todo.todoKey}`);
      todoKeys.add(todo.todoKey);
    }
    const outgoing = new Map<string, Set<string>>();
    const indegree = new Map([...todoKeys].map((key) => [key, 0]));
    const edgeKeys = new Set<string>();
    for (const dependency of params.dependencies) {
      if (!todoKeys.has(dependency.fromTodoKey) || !todoKeys.has(dependency.toTodoKey)) {
        throw new Error('Run dependency references an unknown todoKey');
      }
      if (dependency.fromTodoKey === dependency.toTodoKey) {
        throw new Error('Run TODO cannot depend on itself');
      }
      const edgeKey = `${dependency.fromTodoKey}\u0000${dependency.toTodoKey}`;
      if (edgeKeys.has(edgeKey)) throw new Error('Duplicate run TODO dependency');
      edgeKeys.add(edgeKey);
      const targets = outgoing.get(dependency.fromTodoKey) ?? new Set<string>();
      targets.add(dependency.toTodoKey);
      outgoing.set(dependency.fromTodoKey, targets);
      indegree.set(dependency.toTodoKey, (indegree.get(dependency.toTodoKey) ?? 0) + 1);
    }
    const ready = [...indegree].filter(([, degree]) => degree === 0).map(([key]) => key);
    let visited = 0;
    while (ready.length > 0) {
      const key = ready.pop();
      if (key === undefined) break;
      visited += 1;
      for (const target of outgoing.get(key) ?? []) {
        const nextDegree = (indegree.get(target) ?? 0) - 1;
        indegree.set(target, nextDegree);
        if (nextDegree === 0) ready.push(target);
      }
    }
    if (visited !== todoKeys.size) throw new Error('Run TODO dependency graph must be acyclic');
  }

  private requireRunTargets(params: CreateSemanticRunParams): void {
    this.requireProjectVersion(params.projectId, params.businessVersionId);
    const scenario = this.db
      .prepare(
        `SELECT business_version_id, lifecycle FROM semantic_test_scenario_revisions WHERE id = ?`
      )
      .get(params.scenarioRevisionId) as
      | { business_version_id: string; lifecycle: string }
      | undefined;
    if (
      !scenario ||
      scenario.business_version_id !== params.businessVersionId ||
      scenario.lifecycle !== 'current'
    ) {
      throw new Error('Run scenario revision is not current in the business version');
    }
    const binding = this.db
      .prepare(
        `SELECT 1 FROM version_deployment_bindings
         WHERE business_version_id = ? AND deployment_revision_id = ?`
      )
      .get(params.businessVersionId, params.deploymentRevisionId);
    if (!binding) throw new Error('Run deployment revision is not bound to the business version');
    if (params.purpose === 'formal') {
      if (!params.assetGraphSha256 || !params.verificationScopeSha256) {
        throw new Error('Formal runs require exact asset graph and verification scope hashes');
      }
      const validation = this.db
        .prepare(
          `SELECT id FROM business_version_validations
           WHERE business_version_id = ? AND deployment_revision_id = ?
             AND asset_graph_sha256 = ? AND verification_scope_sha256 = ?
             AND status = 'valid' AND is_current = 1`
        )
        .get(
          params.businessVersionId,
          params.deploymentRevisionId,
          params.assetGraphSha256,
          params.verificationScopeSha256
        );
      if (!validation) throw new Error('Formal run has no matching valid business version scope');
    } else {
      if (!params.authoringJobId)
        throw new Error('Authoring verification runs require authoringJobId');
      const job = this.db
        .prepare('SELECT business_version_id FROM authoring_jobs WHERE id = ?')
        .get(params.authoringJobId) as { business_version_id: string } | undefined;
      if (!job || job.business_version_id !== params.businessVersionId) {
        throw new Error('Authoring job does not belong to the business version');
      }
    }
  }

  private requireProjectVersion(projectId: string, versionId: string): void {
    const version = this.db
      .prepare('SELECT project_id, archived_at FROM business_versions WHERE id = ?')
      .get(versionId) as { project_id: string; archived_at: string | null } | undefined;
    if (!version || version.project_id !== projectId) {
      throw new Error('Business version does not belong to the project');
    }
    if (version.archived_at) throw new Error('Archived business versions are read-only');
  }

  private requireParentRunBrowserJob(parentRunId: string, versionId: string): string {
    const run = this.db
      .prepare('SELECT business_version_id, browser_job_id FROM test_runs WHERE id = ?')
      .get(parentRunId) as { business_version_id: string; browser_job_id: string } | undefined;
    if (!run || run.business_version_id !== versionId) {
      throw new Error('Parent run does not belong to the business version');
    }
    return run.browser_job_id;
  }

  private requireAuthoringBrowserJob(authoringJobId: string, versionId: string): string {
    const job = this.db
      .prepare('SELECT business_version_id, browser_job_id FROM authoring_jobs WHERE id = ?')
      .get(authoringJobId) as { business_version_id: string; browser_job_id: string } | undefined;
    if (!job || job.business_version_id !== versionId) {
      throw new Error('Authoring job does not belong to the business version');
    }
    return job.browser_job_id;
  }

  private enqueueBrowserJob(contextType: 'run' | 'authoring', contextId: string): string {
    const meta = this.db
      .prepare("SELECT next_queue_seq FROM browser_job_queue_meta WHERE key = 'global'")
      .get() as { next_queue_seq: number | bigint };
    const seq = Number(meta.next_queue_seq);
    const id = randomUUID();
    this.db
      .prepare(
        "UPDATE browser_job_queue_meta SET next_queue_seq = next_queue_seq + 1 WHERE key = 'global'"
      )
      .run();
    this.db
      .prepare(
        `INSERT INTO browser_jobs
          (id, root_context_type, root_context_id, queue_seq, state, created_at)
         VALUES (?, ?, ?, ?, 'queued', ?)`
      )
      .run(id, contextType, contextId, seq, new Date().toISOString());
    return id;
  }

  private runStateVersion(runId: string): number {
    const row = this.db.prepare('SELECT state_version FROM test_runs WHERE id = ?').get(runId) as
      | { state_version: number | bigint }
      | undefined;
    if (!row) throw new Error('Run not found');
    return Number(row.state_version);
  }

  private authoringStateVersion(jobId: string): number {
    const row = this.db
      .prepare('SELECT state_version FROM authoring_jobs WHERE id = ?')
      .get(jobId) as { state_version: number | bigint } | undefined;
    if (!row) throw new Error('Authoring job not found');
    return Number(row.state_version);
  }

  private insertRunEvent(
    runId: string,
    seq: number,
    type: string,
    entityType: string,
    entityId: string,
    stateVersion: number | null,
    payload: unknown,
    correlationId: string | null,
    causationId: string | null,
    now: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO run_events
          (id, run_id, seq, schema_version, type, entity_type, entity_id, state_version,
           correlation_id, causation_id, payload_json, occurred_at, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        runId,
        seq,
        type,
        entityType,
        entityId,
        stateVersion,
        correlationId,
        causationId,
        stableStringify(payload),
        now,
        now
      );
  }

  private insertAuthoringEvent(
    jobId: string,
    seq: number,
    type: string,
    entityType: string,
    entityId: string,
    stateVersion: number | null,
    payload: unknown,
    correlationId: string | null,
    causationId: string | null,
    now: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO authoring_events
          (id, job_id, seq, schema_version, type, entity_type, entity_id, state_version,
           correlation_id, causation_id, payload_json, occurred_at, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        jobId,
        seq,
        type,
        entityType,
        entityId,
        stateVersion,
        correlationId,
        causationId,
        stableStringify(payload),
        now,
        now
      );
  }

  private bumpAuthoringEvent(
    jobId: string,
    seq: number,
    type: string,
    entityType: string,
    entityId: string,
    payload: unknown,
    now: string
  ): void {
    this.db
      .prepare('UPDATE authoring_jobs SET next_event_seq = next_event_seq + 1 WHERE id = ?')
      .run(jobId);
    this.insertAuthoringEvent(
      jobId,
      seq,
      type,
      entityType,
      entityId,
      null,
      payload,
      null,
      null,
      now
    );
  }
}
