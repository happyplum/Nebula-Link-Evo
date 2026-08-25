import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentTaskError } from './errors.js';
import type {
  AgentTaskExecutionResult,
  AgentTaskProblem,
  AgentTaskStatus,
  AgentTaskToolCallSummary,
  AgentTaskUsage,
  AgentTaskView,
  AgentTaskOperationReservation,
  PersistedAgentTaskRequest,
} from './types.js';
import { AGENT_TASK_LIMITS, validateBoundedObjectSchema } from './validation.js';

interface TaskRow {
  task_id: string;
  client_task_id: string;
  request_hash: string;
  idempotency_key: string | null;
  status: AgentTaskStatus;
  request_json: string;
  output_json: string | null;
  error_json: string | null;
  termination_reason: string | null;
  usage_json: string | null;
  tool_calls_json: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface TaskStateRow {
  task_id: string;
  state_version: number;
  next_event_seq: number;
  last_checkpoint_id: string | null;
}

interface HarnessProjectionRow {
  task_id: string;
  session_id: string;
  projected_dsh_seq: number;
  durable_dsh_seq: number;
  durable_revision: string | null;
  pending_result_call_id: string | null;
  pending_result_hash: string | null;
  pending_result_json: string | null;
}

interface TaskEventRow {
  id: string;
  task_id: string;
  seq: number;
  type: string;
  entity_type: AgentTaskEventRecord['entityType'];
  entity_id: string;
  state_version: number;
  correlation_id: string | null;
  causation_id: string | null;
  payload_json: string;
  occurred_at: string;
  created_at: string;
}

interface TaskCommandRow {
  id: string;
  task_id: string;
  type: AgentTaskCommandRecord['type'];
  expected_state_version: number;
  request_hash: string;
  status: AgentTaskCommandRecord['status'];
  result_json: string | null;
  error_json: string | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

interface CheckpointRow {
  id: string;
  task_id: string;
  checkpoint_no: number;
  state_version: number;
  content_sha256: string;
  payload_json: string;
  created_at: string;
}

interface SkillRow {
  skill_id: string;
  version: string;
  content_hash: string;
  manifest_json: string;
  instructions_text: string;
  source_ref: string;
  registered_at: string;
}

interface TaskSkillBindingRow {
  task_id: string;
  ordinal: number;
  skill_id: string;
  version: string;
  content_hash: string;
  policy_sha256: string;
  bound_at: string;
}

export interface CreateStoredAgentTask {
  taskId: string;
  request: PersistedAgentTaskRequest;
  requestHash: string;
  idempotencyKey?: string;
}

export interface CreateStoredAgentTaskResult {
  task: AgentTaskView;
  created: boolean;
}

export interface CreateStoredAgentTaskSkills {
  pins: Array<{ skillId: string; version: string; contentHash: string }>;
  policySha256: string;
  boundAt: string;
}

export interface AgentTaskPersistenceState {
  taskId: string;
  stateVersion: number;
  nextEventSeq: number;
  lastCheckpointId?: string;
}

export interface AgentTaskEventRecord {
  id: string;
  taskId: string;
  seq: number;
  type: string;
  entityType: 'task' | 'command' | 'checkpoint' | 'skill';
  entityId: string;
  stateVersion: number;
  correlationId?: string;
  causationId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface AgentTaskCommandRecord {
  id: string;
  taskId: string;
  type: 'pause' | 'resume' | 'interrupt' | 'cancel';
  expectedStateVersion: number;
  requestHash: string;
  status: 'accepted' | 'completed' | 'rejected';
  result?: unknown;
  error?: AgentTaskProblem;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

export interface AgentTaskCheckpointRecord {
  id: string;
  taskId: string;
  checkpointNo: number;
  stateVersion: number;
  contentSha256: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SkillManifestV1 {
  schema: 'nebula.ai.skill/1.0';
  id: string;
  version: string;
  description: string;
  contentHash: string;
  requiredModelRole: 'decision';
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredToolPatterns: string[];
  limits: { maxToolCalls: number; maxModelTurns: number; maxTokens?: number };
}

export interface SkillVersionRecord {
  manifest: SkillManifestV1;
  instructions: string;
  sourceRef: string;
  registeredAt: string;
}

export interface AgentTaskSkillBindingRecord {
  taskId: string;
  ordinal: number;
  skillId: string;
  version: string;
  contentHash: string;
  policySha256: string;
  boundAt: string;
}

export interface PendingHarnessResultRecord {
  taskId: string;
  sessionId: string;
  projectedDshSeq: number;
  callId: string;
  resultHash: string;
  output: unknown;
}

export interface CreateAgentTaskCommand {
  id: string;
  taskId: string;
  type: AgentTaskCommandRecord['type'];
  expectedStateVersion: number;
  requestHash: string;
  createdBy: string;
  reason?: string;
  createdAt: string;
}

export interface SaveAgentTaskCheckpoint {
  id: string;
  taskId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class AgentTaskRepository {
  private readonly db: DatabaseSync;
  private readonly events = new EventEmitter();
  private readonly pendingEvents: AgentTaskEventRecord[] = [];
  private transactionDepth = 0;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = FULL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_data_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL CHECK(length(checksum) = 64),
        applied_at TEXT NOT NULL
      );
    `);
    this.applyMigration(
      1,
      'agent-task-core',
      `
      CREATE TABLE IF NOT EXISTS agent_tasks (
        task_id TEXT PRIMARY KEY,
        client_task_id TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('created','running','paused','completed','failed','interrupted','cancelled','blocked')),
        request_json TEXT NOT NULL,
        output_json TEXT,
        error_json TEXT,
        termination_reason TEXT,
        usage_json TEXT,
        tool_calls_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_updated_at ON agent_tasks(updated_at DESC);
    `
    );
    this.applyMigration(
      2,
      'agent-command-event-skill-foundation',
      `
      CREATE TABLE IF NOT EXISTS agent_task_state (
        task_id TEXT PRIMARY KEY REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
        state_version INTEGER NOT NULL DEFAULT 1 CHECK(state_version > 0),
        next_event_seq INTEGER NOT NULL DEFAULT 1 CHECK(next_event_seq > 0),
        last_checkpoint_id TEXT
      );
      INSERT INTO agent_task_state (task_id, state_version, next_event_seq)
        SELECT task_id, 1, 1 FROM agent_tasks
        WHERE NOT EXISTS (
          SELECT 1 FROM agent_task_state state WHERE state.task_id = agent_tasks.task_id
        );

      CREATE TABLE IF NOT EXISTS agent_task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
        seq INTEGER NOT NULL CHECK(seq > 0),
        type TEXT NOT NULL,
        entity_type TEXT NOT NULL CHECK(entity_type IN ('task','command','checkpoint','skill')),
        entity_id TEXT NOT NULL,
        state_version INTEGER NOT NULL CHECK(state_version > 0),
        correlation_id TEXT,
        causation_id TEXT,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_task_events_entity
        ON agent_task_events(task_id, entity_type, entity_id, seq);

      CREATE TABLE IF NOT EXISTS agent_task_commands (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
        type TEXT NOT NULL CHECK(type IN ('pause','resume','interrupt','cancel')),
        expected_state_version INTEGER NOT NULL CHECK(expected_state_version > 0),
        request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
        status TEXT NOT NULL CHECK(status IN ('accepted','completed','rejected')),
        result_json TEXT,
        error_json TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent_task_commands_task
        ON agent_task_commands(task_id, created_at);

      CREATE TABLE IF NOT EXISTS agent_task_checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
        checkpoint_no INTEGER NOT NULL CHECK(checkpoint_no > 0),
        state_version INTEGER NOT NULL CHECK(state_version > 0),
        content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, checkpoint_no)
      );

      CREATE TABLE IF NOT EXISTS skill_registry_versions (
        skill_id TEXT NOT NULL,
        version TEXT NOT NULL,
        content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
        manifest_json TEXT NOT NULL,
        instructions_text TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        PRIMARY KEY(skill_id, version)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_registry_content
        ON skill_registry_versions(skill_id, version, content_hash);

      CREATE TABLE IF NOT EXISTS agent_task_skill_bindings (
        task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        skill_id TEXT NOT NULL,
        version TEXT NOT NULL,
        content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
        policy_sha256 TEXT NOT NULL CHECK(length(policy_sha256) = 64),
        bound_at TEXT NOT NULL,
        PRIMARY KEY(task_id, skill_id),
        UNIQUE(task_id, ordinal),
        FOREIGN KEY(skill_id, version, content_hash)
          REFERENCES skill_registry_versions(skill_id, version, content_hash) ON DELETE RESTRICT
      );

      CREATE TRIGGER IF NOT EXISTS trg_skill_registry_version_immutable
        BEFORE UPDATE OF content_hash, manifest_json, instructions_text, source_ref
        ON skill_registry_versions
        BEGIN SELECT RAISE(ABORT, 'skill version is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS trg_agent_task_checkpoint_immutable
        BEFORE UPDATE ON agent_task_checkpoints
        BEGIN SELECT RAISE(ABORT, 'agent task checkpoint is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS trg_agent_task_event_immutable
        BEFORE UPDATE ON agent_task_events
        BEGIN SELECT RAISE(ABORT, 'agent task event is immutable'); END;
    `
    );
    this.applyMigration(
      3,
      'agent-task-harness-projection',
      `
      CREATE TABLE IF NOT EXISTS agent_task_harness_projection (
        task_id TEXT PRIMARY KEY REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
        session_id TEXT NOT NULL UNIQUE,
        projected_dsh_seq INTEGER NOT NULL DEFAULT 0 CHECK(projected_dsh_seq >= 0),
        durable_dsh_seq INTEGER NOT NULL DEFAULT 0 CHECK(durable_dsh_seq >= 0),
        durable_revision TEXT,
        pending_result_call_id TEXT,
        pending_result_hash TEXT CHECK(pending_result_hash IS NULL OR length(pending_result_hash) = 64),
        pending_result_json TEXT,
        pending_recorded_at TEXT,
        result_confirmed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS agent_task_harness_events (
        task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
        dsh_seq INTEGER NOT NULL CHECK(dsh_seq >= 0),
        dsh_event_type TEXT NOT NULL,
        PRIMARY KEY(task_id, dsh_seq)
      );
    `
    );
    this.applyMigration(
      4,
      'agent-task-token-reservations',
      `
      CREATE TABLE IF NOT EXISTS agent_task_token_reservations (
        reservation_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
        estimated_input INTEGER NOT NULL CHECK(estimated_input >= 0),
        output_cap INTEGER NOT NULL CHECK(output_cap > 0),
        reserved_total INTEGER NOT NULL CHECK(reserved_total > 0),
        actual_input INTEGER CHECK(actual_input IS NULL OR actual_input >= 0),
        actual_output INTEGER CHECK(actual_output IS NULL OR actual_output >= 0),
        status TEXT NOT NULL CHECK(status IN ('reserved', 'settled')),
        created_at TEXT NOT NULL,
        settled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent_task_token_reservations_task
        ON agent_task_token_reservations(task_id, status);
    `
    );
    this.applyMigration(
      5,
      'agent-task-retention',
      `
      ALTER TABLE agent_tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1));
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_retention
        ON agent_tasks(pinned, status, completed_at);
    `
    );
    this.applyMigration(
      6,
      'agent-task-operation-reservations',
      `
      CREATE TABLE IF NOT EXISTS agent_task_operations (
        task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
        tool_call_id TEXT NOT NULL,
        operation_id TEXT NOT NULL UNIQUE,
        tool_name TEXT NOT NULL,
        request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
        args_json TEXT NOT NULL,
        quantity_json TEXT NOT NULL,
        authorization_json TEXT NOT NULL,
        browser_binding_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN (
          'reserved','dispatched','succeeded','failed','outcome_unknown','interrupted'
        )),
        proxy_status TEXT,
        created_at TEXT NOT NULL,
        dispatched_at TEXT,
        settled_at TEXT,
        PRIMARY KEY (task_id, tool_call_id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_task_operations_recovery
        ON agent_task_operations(task_id, status);
    `
    );
  }

  listRetentionCandidates(now = Date.now()): Array<{
    taskId: string;
    sessionId: string;
    status: AgentTaskStatus;
  }> {
    const successBefore = new Date(now - 7 * 24 * 60 * 60 * 1_000).toISOString();
    const failureBefore = new Date(now - 30 * 24 * 60 * 60 * 1_000).toISOString();
    return this.db
      .prepare(
        `SELECT task.task_id AS taskId, projection.session_id AS sessionId, task.status
         FROM agent_tasks task
         JOIN agent_task_harness_projection projection ON projection.task_id = task.task_id
         WHERE task.pinned = 0 AND task.completed_at IS NOT NULL AND (
           (task.status = 'completed' AND task.completed_at < ?) OR
           (task.status IN ('failed','interrupted','cancelled','blocked') AND task.completed_at < ?)
         )
         ORDER BY task.completed_at ASC`
      )
      .all(successBefore, failureBefore) as unknown as Array<{
      taskId: string;
      sessionId: string;
      status: AgentTaskStatus;
    }>;
  }

  deleteRetainedTask(taskId: string): void {
    this.transaction(() => {
      const task = this.requireTask(taskId);
      if (!['completed', 'failed', 'interrupted', 'cancelled', 'blocked'].includes(task.status)) {
        throw new AgentTaskError(
          'conflict',
          `Agent task ${taskId} is not eligible for retention GC`
        );
      }
      for (const table of [
        'agent_task_commands',
        'agent_task_checkpoints',
        'agent_task_skill_bindings',
        'agent_task_events',
        'agent_task_harness_events',
        'agent_task_token_reservations',
        'agent_task_operations',
        'agent_task_harness_projection',
        'agent_task_state',
      ]) {
        this.db.prepare(`DELETE FROM ${table} WHERE task_id = ?`).run(taskId);
      }
      this.db.prepare('DELETE FROM agent_tasks WHERE task_id = ?').run(taskId);
    });
  }

  setPinned(taskId: string, pinned: boolean): void {
    const updated = this.db
      .prepare('UPDATE agent_tasks SET pinned = ?, updated_at = ? WHERE task_id = ?')
      .run(pinned ? 1 : 0, new Date().toISOString(), taskId);
    if (updated.changes !== 1)
      throw new AgentTaskError('not_found', `Agent task ${taskId} was not found`);
  }

  reserveOperation(taskId: string, operation: AgentTaskOperationReservation): void {
    const now = new Date().toISOString();
    const immutable = {
      requestHash: operation.requestHash,
      args: JSON.stringify(operation.canonicalArgs),
      quantity: JSON.stringify(operation.quantity),
      authorization: JSON.stringify(operation.authorization),
      binding: JSON.stringify(operation.browserBinding),
    };
    this.transaction(() => {
      this.requireTask(taskId);
      const existing = this.db
        .prepare(
          `SELECT operation_id, tool_name, request_hash, args_json, quantity_json,
                  authorization_json, browser_binding_json
           FROM agent_task_operations WHERE task_id = ? AND tool_call_id = ?`
        )
        .get(taskId, operation.toolCallId) as
        | {
            operation_id: string;
            tool_name: string;
            request_hash: string;
            args_json: string;
            quantity_json: string;
            authorization_json: string;
            browser_binding_json: string;
          }
        | undefined;
      if (existing) {
        if (
          existing.operation_id !== operation.operationId ||
          existing.tool_name !== operation.toolName ||
          existing.request_hash !== immutable.requestHash ||
          existing.args_json !== immutable.args ||
          existing.quantity_json !== immutable.quantity ||
          existing.authorization_json !== immutable.authorization ||
          existing.browser_binding_json !== immutable.binding
        ) {
          throw new AgentTaskError(
            'conflict',
            `Agent task operation ${operation.toolCallId} immutable identity changed`
          );
        }
        return;
      }
      this.db
        .prepare(
          `INSERT INTO agent_task_operations (
             task_id, tool_call_id, operation_id, tool_name, request_hash, args_json,
             quantity_json, authorization_json, browser_binding_json, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?)`
        )
        .run(
          taskId,
          operation.toolCallId,
          operation.operationId,
          operation.toolName,
          immutable.requestHash,
          immutable.args,
          immutable.quantity,
          immutable.authorization,
          immutable.binding,
          now
        );
    });
  }

  markOperationDispatched(taskId: string, toolCallId: string): void {
    const updated = this.db
      .prepare(
        `UPDATE agent_task_operations SET status = 'dispatched', dispatched_at = ?
         WHERE task_id = ? AND tool_call_id = ? AND status = 'reserved'`
      )
      .run(new Date().toISOString(), taskId, toolCallId);
    if (updated.changes !== 1) {
      const existing = this.db
        .prepare('SELECT status FROM agent_task_operations WHERE task_id = ? AND tool_call_id = ?')
        .get(taskId, toolCallId) as { status: string } | undefined;
      if (existing?.status !== 'dispatched') {
        throw new AgentTaskError(
          'conflict',
          `Agent task operation ${toolCallId} is not dispatchable`
        );
      }
    }
  }

  settleOperation(
    taskId: string,
    toolCallId: string,
    status: 'succeeded' | 'failed' | 'outcome_unknown',
    proxyStatus?: string
  ): void {
    const updated = this.db
      .prepare(
        `UPDATE agent_task_operations SET status = ?, proxy_status = ?, settled_at = ?
         WHERE task_id = ? AND tool_call_id = ? AND status = 'dispatched'`
      )
      .run(status, proxyStatus ?? null, new Date().toISOString(), taskId, toolCallId);
    if (updated.changes !== 1) {
      const existing = this.db
        .prepare(
          'SELECT status, proxy_status FROM agent_task_operations WHERE task_id = ? AND tool_call_id = ?'
        )
        .get(taskId, toolCallId) as { status: string; proxy_status: string | null } | undefined;
      if (existing?.status !== status || existing.proxy_status !== (proxyStatus ?? null)) {
        throw new AgentTaskError(
          'conflict',
          `Agent task operation ${toolCallId} settlement changed`
        );
      }
    }
  }

  createOrGet(input: CreateStoredAgentTask): CreateStoredAgentTaskResult {
    const existing = this.findExisting(
      input.request.clientTaskId,
      input.requestHash,
      input.idempotencyKey
    );
    if (existing) return { task: existing, created: false };

    const now = new Date().toISOString();
    try {
      return this.transaction(() => {
        this.db
          .prepare(
            `
          INSERT INTO agent_tasks (
            task_id, client_task_id, request_hash, idempotency_key, status, request_json,
            output_json, error_json, termination_reason, usage_json, tool_calls_json,
            created_at, updated_at, started_at, completed_at
          ) VALUES (?, ?, ?, ?, 'created', ?, NULL, NULL, NULL, NULL, '[]', ?, ?, NULL, NULL)
        `
          )
          .run(
            input.taskId,
            input.request.clientTaskId,
            input.requestHash,
            input.idempotencyKey ?? null,
            JSON.stringify(input.request),
            now,
            now
          );
        this.db
          .prepare(
            `INSERT INTO agent_task_state (task_id, state_version, next_event_seq)
             VALUES (?, 1, 1)`
          )
          .run(input.taskId);
        this.appendEventInTransaction({
          id: `task-created:${input.taskId}`,
          taskId: input.taskId,
          type: 'agent_task.created',
          entityType: 'task',
          entityId: input.taskId,
          stateVersion: 1,
          payload: { clientTaskId: input.request.clientTaskId },
          occurredAt: now,
        });
        return { task: this.requireTask(input.taskId), created: true };
      });
    } catch (error) {
      const raced = input.idempotencyKey
        ? this.getByIdempotencyKey(input.idempotencyKey)
        : this.getByClientTaskId(input.request.clientTaskId);
      if (raced) {
        this.assertSameRequest(raced.taskId, input.requestHash);
        return { task: raced, created: false };
      }
      throw error;
    }
  }

  findExisting(
    clientTaskId: string,
    requestHash: string,
    idempotencyKey?: string
  ): AgentTaskView | null {
    const byIdentity = idempotencyKey
      ? this.getByIdempotencyKey(idempotencyKey)
      : this.getByClientTaskId(clientTaskId);
    if (byIdentity) {
      this.assertSameRequest(byIdentity.taskId, requestHash);
      return byIdentity;
    }
    const sameClient = this.getByClientTaskId(clientTaskId);
    if (!sameClient) return null;
    this.assertSameRequest(sameClient.taskId, requestHash);
    return sameClient;
  }

  createOrGetWithSkills(
    input: CreateStoredAgentTask,
    skills?: CreateStoredAgentTaskSkills
  ): CreateStoredAgentTaskResult {
    return this.transaction(() => {
      const stored = this.createOrGet(input);
      if (skills && skills.pins.length > 0) {
        this.bindTaskSkills(stored.task.taskId, skills.pins, skills.policySha256, skills.boundAt);
      }
      return { ...stored, task: this.requireTask(stored.task.taskId) };
    });
  }

  get(taskId: string): AgentTaskView | null {
    const row = this.db.prepare('SELECT * FROM agent_tasks WHERE task_id = ?').get(taskId) as
      | TaskRow
      | undefined;
    return row ? this.toView(row) : null;
  }

  markRunning(taskId: string): AgentTaskView {
    const now = new Date().toISOString();
    return this.transaction(() => {
      const result = this.db
        .prepare(
          `
        UPDATE agent_tasks
        SET status = 'running', updated_at = ?, started_at = COALESCE(started_at, ?)
        WHERE task_id = ? AND status = 'created'
      `
        )
        .run(now, now, taskId);
      if (result.changes === 1) {
        const stateVersion = this.incrementStateVersion(taskId);
        this.appendEventInTransaction({
          id: `task-running:${taskId}:${stateVersion}`,
          taskId,
          type: 'agent_task.state_changed',
          entityType: 'task',
          entityId: taskId,
          stateVersion,
          payload: { from: 'created', to: 'running' },
          occurredAt: now,
        });
      }
      return this.requireTask(taskId);
    });
  }

  pause(taskId: string, checkpoint: SaveAgentTaskCheckpoint): AgentTaskView {
    if (checkpoint.taskId !== taskId) {
      throw new AgentTaskError('validation_failed', 'Pause checkpoint task does not match');
    }
    return this.transaction(() => {
      const task = this.transitionStatus(taskId, ['running'], 'paused');
      this.saveCheckpoint(checkpoint);
      return this.requireTask(task.taskId);
    });
  }

  resume(taskId: string): AgentTaskView {
    return this.transitionStatus(taskId, ['paused'], 'running');
  }

  complete(taskId: string, result: AgentTaskExecutionResult): AgentTaskView {
    const now = new Date().toISOString();
    return this.transaction(() => {
      const updated = this.db
        .prepare(
          `
        UPDATE agent_tasks SET status = 'completed', output_json = ?, error_json = NULL,
          termination_reason = ?, usage_json = ?, tool_calls_json = ?, updated_at = ?, completed_at = ?
        WHERE task_id = ? AND status = 'running'
      `
        )
        .run(
          JSON.stringify(result.output),
          result.terminationReason,
          JSON.stringify(result.usage),
          JSON.stringify(result.toolCalls),
          now,
          now,
          taskId
        );
      if (updated.changes === 1) {
        const stateVersion = this.incrementStateVersion(taskId);
        this.appendEventInTransaction({
          id: `task-completed:${taskId}:${stateVersion}`,
          taskId,
          type: 'agent_task.state_changed',
          entityType: 'task',
          entityId: taskId,
          stateVersion,
          payload: {
            from: 'running',
            to: 'completed',
            terminationReason: result.terminationReason,
          },
          occurredAt: now,
        });
      }
      return this.requireTask(taskId);
    });
  }

  getHarnessProjection(taskId: string): {
    sessionId: string;
    projectedDshSeq: number;
    durableDshSeq: number;
  } {
    this.requireTask(taskId);
    const sessionId = `agent-task-${taskId}`;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO agent_task_harness_projection(task_id, session_id)
         VALUES (?, ?)`
      )
      .run(taskId, sessionId);
    const row = this.db
      .prepare('SELECT * FROM agent_task_harness_projection WHERE task_id = ?')
      .get(taskId) as unknown as HarnessProjectionRow;
    if (row.session_id !== sessionId) {
      throw new AgentTaskError('conflict', 'Agent task Harness session identity is immutable');
    }
    return {
      sessionId: row.session_id,
      projectedDshSeq: row.projected_dsh_seq,
      durableDshSeq: row.durable_dsh_seq,
    };
  }

  recordPendingHarnessResult(
    taskId: string,
    callId: string,
    resultHash: string,
    output: unknown
  ): void {
    assertSha256(resultHash, 'Harness result hash');
    const serialized = stableStringify(output);
    this.transaction(() => {
      this.getHarnessProjection(taskId);
      const row = this.db
        .prepare('SELECT * FROM agent_task_harness_projection WHERE task_id = ?')
        .get(taskId) as unknown as HarnessProjectionRow;
      if (row.pending_result_call_id) {
        if (
          row.pending_result_call_id !== callId ||
          row.pending_result_hash !== resultHash ||
          row.pending_result_json !== serialized
        ) {
          throw new AgentTaskError('conflict', 'Agent task pending Harness result is immutable');
        }
        return;
      }
      const task = this.requireTask(taskId);
      if (task.status !== 'running') {
        throw new AgentTaskError('conflict', 'Agent task is not running at submit_result');
      }
      this.db
        .prepare(
          `UPDATE agent_task_harness_projection
           SET pending_result_call_id = ?, pending_result_hash = ?, pending_result_json = ?,
               pending_recorded_at = ? WHERE task_id = ?`
        )
        .run(callId, resultHash, serialized, new Date().toISOString(), taskId);
    });
  }

  listPendingHarnessResults(): PendingHarnessResultRecord[] {
    const rows = this.db
      .prepare(
        `SELECT projection.* FROM agent_task_harness_projection projection
         JOIN agent_tasks task ON task.task_id = projection.task_id
         WHERE task.status IN ('created', 'running', 'paused')
           AND projection.pending_result_call_id IS NOT NULL
           AND projection.pending_result_hash IS NOT NULL
           AND projection.pending_result_json IS NOT NULL
         ORDER BY task.created_at ASC`
      )
      .all() as unknown as HarnessProjectionRow[];
    return rows.map((row) => ({
      taskId: row.task_id,
      sessionId: row.session_id,
      projectedDshSeq: row.projected_dsh_seq,
      callId: row.pending_result_call_id as string,
      resultHash: row.pending_result_hash as string,
      output: JSON.parse(row.pending_result_json as string) as unknown,
    }));
  }

  reserveTokenBudget(
    taskId: string,
    reservationId: string,
    totalBudget: number,
    estimatedInput: number,
    requestedOutput: number
  ): number {
    for (const [value, label] of [
      [totalBudget, 'totalBudget'],
      [estimatedInput, 'estimatedInput'],
      [requestedOutput, 'requestedOutput'],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < (label === 'estimatedInput' ? 0 : 1)) {
        throw new AgentTaskError('validation_failed', `${label} is invalid`);
      }
    }
    return this.transaction(() => {
      const existing = this.db
        .prepare(
          'SELECT output_cap FROM agent_task_token_reservations WHERE reservation_id = ? AND task_id = ?'
        )
        .get(reservationId, taskId) as { output_cap: number } | undefined;
      if (existing) return existing.output_cap;
      const task = this.requireTask(taskId);
      if (task.status !== 'running') {
        throw new AgentTaskError('conflict', 'Agent task is not running at token reservation');
      }
      const row = this.db
        .prepare(
          `SELECT COALESCE(SUM(
             CASE WHEN status = 'settled' THEN actual_input + actual_output ELSE reserved_total END
           ), 0) AS used
           FROM agent_task_token_reservations WHERE task_id = ?`
        )
        .get(taskId) as { used: number };
      const remaining = totalBudget - row.used;
      const outputCap = Math.min(requestedOutput, remaining - estimatedInput);
      if (outputCap < 1) {
        throw new AgentTaskError(
          'budget_exceeded',
          'Agent task token budget cannot reserve this request'
        );
      }
      this.db
        .prepare(
          `INSERT INTO agent_task_token_reservations(
             reservation_id, task_id, estimated_input, output_cap, reserved_total, status, created_at
           ) VALUES (?, ?, ?, ?, ?, 'reserved', ?)`
        )
        .run(
          reservationId,
          taskId,
          estimatedInput,
          outputCap,
          estimatedInput + outputCap,
          new Date().toISOString()
        );
      return outputCap;
    });
  }

  settleTokenBudget(
    taskId: string,
    reservationId: string,
    inputTokens: number,
    outputTokens: number
  ): void {
    if (
      !Number.isSafeInteger(inputTokens) ||
      inputTokens < 0 ||
      !Number.isSafeInteger(outputTokens) ||
      outputTokens < 0
    ) {
      throw new AgentTaskError('validation_failed', 'Actual token usage is invalid');
    }
    this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT status, actual_input, actual_output FROM agent_task_token_reservations
           WHERE reservation_id = ? AND task_id = ?`
        )
        .get(reservationId, taskId) as
        | {
            status: 'reserved' | 'settled';
            actual_input: number | null;
            actual_output: number | null;
          }
        | undefined;
      if (!row) throw new AgentTaskError('conflict', 'Token reservation is missing');
      if (row.status === 'settled') {
        if (row.actual_input !== inputTokens || row.actual_output !== outputTokens) {
          throw new AgentTaskError('conflict', 'Settled token usage is immutable');
        }
        return;
      }
      this.db
        .prepare(
          `UPDATE agent_task_token_reservations
           SET actual_input = ?, actual_output = ?, status = 'settled', settled_at = ?
           WHERE reservation_id = ? AND task_id = ? AND status = 'reserved'`
        )
        .run(inputTokens, outputTokens, new Date().toISOString(), reservationId, taskId);
    });
  }

  completeHarness(taskId: string, result: AgentTaskExecutionResult): AgentTaskView {
    const commit = result.harness;
    if (!commit) return this.complete(taskId, result);
    return this.transaction(() => {
      const projection = this.db
        .prepare('SELECT * FROM agent_task_harness_projection WHERE task_id = ?')
        .get(taskId) as HarnessProjectionRow | undefined;
      if (!projection || projection.session_id !== commit.sessionId) {
        throw new AgentTaskError('conflict', 'Agent task Harness projection is missing');
      }
      if (
        projection.pending_result_call_id !== commit.resultCallId ||
        projection.pending_result_hash !== commit.resultHash ||
        projection.pending_result_json !== stableStringify(result.output)
      ) {
        throw new AgentTaskError(
          'conflict',
          'Durable Harness result does not match pending result'
        );
      }
      if (projection.projected_dsh_seq > commit.durableSeq) {
        throw new AgentTaskError(
          'execution_failed',
          'Agent task Harness cursor exceeds durable seq'
        );
      }
      let next = projection.projected_dsh_seq;
      for (const event of commit.events) {
        if (event.seq < next) continue;
        if (event.seq !== next || event.seq >= commit.durableSeq) {
          throw new AgentTaskError(
            'execution_failed',
            'Agent task Harness suffix is not contiguous'
          );
        }
        this.db
          .prepare(
            `INSERT INTO agent_task_harness_events(task_id, dsh_seq, dsh_event_type)
             VALUES (?, ?, ?)`
          )
          .run(taskId, event.seq, event.type);
        next += 1;
      }
      if (next !== commit.durableSeq) {
        throw new AgentTaskError('execution_failed', 'Agent task Harness suffix is incomplete');
      }
      this.db
        .prepare(
          `UPDATE agent_task_harness_projection
           SET projected_dsh_seq = ?, durable_dsh_seq = ?, durable_revision = ?,
               result_confirmed_at = ? WHERE task_id = ?`
        )
        .run(next, commit.durableSeq, commit.durableRevision, new Date().toISOString(), taskId);
      return this.complete(taskId, result);
    });
  }

  fail(
    taskId: string,
    status: Extract<AgentTaskStatus, 'failed' | 'interrupted' | 'blocked' | 'cancelled'>,
    error: AgentTaskProblem,
    toolCalls: AgentTaskToolCallSummary[] = [],
    usage?: AgentTaskUsage
  ): AgentTaskView {
    const now = new Date().toISOString();
    return this.transaction(() => {
      const current = this.requireTask(taskId);
      const updated = this.db
        .prepare(
          `
        UPDATE agent_tasks SET status = ?, error_json = ?, usage_json = ?, tool_calls_json = ?,
          termination_reason = ?, updated_at = ?, completed_at = ?
        WHERE task_id = ? AND status IN ('created', 'running', 'paused')
      `
        )
        .run(
          status,
          JSON.stringify(error),
          usage ? JSON.stringify(usage) : null,
          JSON.stringify(toolCalls),
          error.code,
          now,
          now,
          taskId
        );
      if (updated.changes === 1) {
        const stateVersion = this.incrementStateVersion(taskId);
        this.appendEventInTransaction({
          id: `task-${status}:${taskId}:${stateVersion}`,
          taskId,
          type: 'agent_task.state_changed',
          entityType: 'task',
          entityId: taskId,
          stateVersion,
          payload: { from: current.status, to: status, errorCode: error.code },
          occurredAt: now,
        });
      }
      return this.requireTask(taskId);
    });
  }

  recoverUnfinished(): number {
    const now = new Date().toISOString();
    const problem: AgentTaskProblem = {
      code: 'service_restarted',
      message: 'Agent task was interrupted because ai-chat-service restarted',
      retryable: true,
    };
    return this.transaction(() => {
      this.db
        .prepare(
          "UPDATE agent_task_operations SET status = 'interrupted', settled_at = ? WHERE status = 'reserved'"
        )
        .run(now);
      this.db
        .prepare(
          "UPDATE agent_task_operations SET status = 'outcome_unknown', settled_at = ? WHERE status = 'dispatched'"
        )
        .run(now);
      const rows = this.db
        .prepare(
          "SELECT task_id, status FROM agent_tasks WHERE status IN ('created', 'running', 'paused')"
        )
        .all() as unknown as Array<{ task_id: string; status: AgentTaskStatus }>;
      for (const row of rows) {
        this.db
          .prepare(
            `UPDATE agent_tasks SET status = 'interrupted', error_json = ?,
               termination_reason = 'service_restarted', updated_at = ?, completed_at = ?
             WHERE task_id = ?`
          )
          .run(JSON.stringify(problem), now, now, row.task_id);
        const stateVersion = this.incrementStateVersion(row.task_id);
        this.appendEventInTransaction({
          id: `task-recovered:${row.task_id}:${stateVersion}`,
          taskId: row.task_id,
          type: 'agent_task.state_changed',
          entityType: 'task',
          entityId: row.task_id,
          stateVersion,
          payload: { from: row.status, to: 'interrupted', errorCode: problem.code },
          occurredAt: now,
        });
      }
      const commands = this.db
        .prepare("SELECT * FROM agent_task_commands WHERE status = 'accepted'")
        .all() as unknown as TaskCommandRow[];
      for (const row of commands) {
        this.db
          .prepare(
            `UPDATE agent_task_commands
             SET status = 'rejected', error_json = ?, completed_at = ?
             WHERE id = ? AND status = 'accepted'`
          )
          .run(JSON.stringify(problem), now, row.id);
        const state = this.getPersistenceState(row.task_id);
        this.appendEventInTransaction({
          id: `command-recovered:${row.id}`,
          taskId: row.task_id,
          type: 'agent_task.command.rejected',
          entityType: 'command',
          entityId: row.id,
          stateVersion: state.stateVersion,
          payload: { commandType: row.type, errorCode: problem.code },
          occurredAt: now,
        });
      }
      return rows.length;
    });
  }

  getPersistenceState(taskId: string): AgentTaskPersistenceState {
    this.requireTask(taskId);
    const row = this.db.prepare('SELECT * FROM agent_task_state WHERE task_id = ?').get(taskId) as
      | TaskStateRow
      | undefined;
    if (!row) throw new AgentTaskError('not_found', `Agent task state ${taskId} was not found`);
    return mapTaskState(row);
  }

  listEvents(taskId: string, afterSeq = 0, limit = 100): AgentTaskEventRecord[] {
    this.requireTask(taskId);
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_task_events
         WHERE task_id = ? AND seq > ? ORDER BY seq LIMIT ?`
      )
      .all(taskId, afterSeq, boundedLimit) as unknown as TaskEventRow[];
    return rows.map(mapTaskEvent);
  }

  appendEvent(
    taskId: string,
    type: string,
    payload: Record<string, unknown>,
    entity?: { type: AgentTaskEventRecord['entityType']; id: string }
  ): AgentTaskEventRecord {
    if (!type || type.length > 200) {
      throw new AgentTaskError('validation_failed', 'Agent event type is invalid');
    }
    if (entity && (!entity.id || entity.id.length > 256)) {
      throw new AgentTaskError('validation_failed', 'Agent event entity id is invalid');
    }
    return this.transaction(() => {
      const state = this.getPersistenceState(taskId);
      return this.appendEventInTransaction({
        id: `runtime:${taskId}:${randomUUID()}`,
        taskId,
        type,
        entityType: entity?.type ?? 'task',
        entityId: entity?.id ?? taskId,
        stateVersion: state.stateVersion,
        payload,
        occurredAt: new Date().toISOString(),
      });
    });
  }

  subscribeEvents(taskId: string, listener: (event: AgentTaskEventRecord) => void): () => void {
    this.requireTask(taskId);
    const eventName = taskEventName(taskId);
    this.events.on(eventName, listener);
    return () => this.events.off(eventName, listener);
  }

  createCommand(input: CreateAgentTaskCommand): AgentTaskCommandRecord {
    assertSha256(input.requestHash, 'Agent command requestHash');
    if (!Number.isSafeInteger(input.expectedStateVersion) || input.expectedStateVersion < 1) {
      throw new AgentTaskError('validation_failed', 'expectedStateVersion must be positive');
    }
    return this.transaction(() => {
      const existing = this.getCommand(input.id);
      if (existing) {
        if (
          existing.taskId !== input.taskId ||
          existing.requestHash !== input.requestHash ||
          existing.type !== input.type
        ) {
          throw new AgentTaskError(
            'conflict',
            'Agent command id was reused with a different request'
          );
        }
        return existing;
      }
      const state = this.getPersistenceState(input.taskId);
      if (state.stateVersion !== input.expectedStateVersion) {
        throw new AgentTaskError(
          'conflict',
          `Agent task state version is ${state.stateVersion}, not ${input.expectedStateVersion}`
        );
      }
      this.db
        .prepare(
          `INSERT INTO agent_task_commands (
            id, task_id, type, expected_state_version, request_hash, status, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?)`
        )
        .run(
          input.id,
          input.taskId,
          input.type,
          input.expectedStateVersion,
          input.requestHash,
          input.createdBy,
          input.createdAt
        );
      this.appendEventInTransaction({
        id: `command-accepted:${input.id}`,
        taskId: input.taskId,
        type: 'agent_task.command.accepted',
        entityType: 'command',
        entityId: input.id,
        stateVersion: state.stateVersion,
        payload: {
          commandType: input.type,
          createdBy: input.createdBy,
          ...(input.reason ? { reason: input.reason } : {}),
        },
        occurredAt: input.createdAt,
      });
      const created = this.getCommand(input.id);
      if (!created) throw new Error(`Agent command ${input.id} was not persisted`);
      return created;
    });
  }

  completeCommand(
    id: string,
    input: {
      status: Extract<AgentTaskCommandRecord['status'], 'completed' | 'rejected'>;
      completedAt: string;
      result?: unknown;
      error?: AgentTaskProblem;
    }
  ): AgentTaskCommandRecord {
    assertSafePayload(input.result, 'command.result');
    assertSafePayload(input.error, 'command.error');
    return this.transaction(() => {
      const command = this.getCommand(id);
      if (!command) throw new AgentTaskError('not_found', `Agent command ${id} was not found`);
      if (command.status !== 'accepted') return command;
      this.db
        .prepare(
          `UPDATE agent_task_commands
           SET status = ?, result_json = ?, error_json = ?, completed_at = ?
           WHERE id = ? AND status = 'accepted'`
        )
        .run(
          input.status,
          input.result === undefined ? null : JSON.stringify(input.result),
          input.error ? JSON.stringify(input.error) : null,
          input.completedAt,
          id
        );
      const state = this.getPersistenceState(command.taskId);
      this.appendEventInTransaction({
        id: `command-${input.status}:${id}`,
        taskId: command.taskId,
        type: `agent_task.command.${input.status}`,
        entityType: 'command',
        entityId: id,
        stateVersion: state.stateVersion,
        payload: {
          commandType: command.type,
          commandStatus: input.status,
          ...(input.error ? { errorCode: input.error.code } : {}),
        },
        occurredAt: input.completedAt,
      });
      const completed = this.getCommand(id);
      if (!completed) throw new Error(`Agent command ${id} was not persisted`);
      return completed;
    });
  }

  getCommand(id: string): AgentTaskCommandRecord | null {
    const row = this.db.prepare('SELECT * FROM agent_task_commands WHERE id = ?').get(id) as
      | TaskCommandRow
      | undefined;
    return row ? mapTaskCommand(row) : null;
  }

  saveCheckpoint(input: SaveAgentTaskCheckpoint): AgentTaskCheckpointRecord {
    assertSafePayload(input.payload, 'checkpoint.payload');
    const contentSha256 = sha256(stableStringify(input.payload));
    return this.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM agent_task_checkpoints WHERE id = ?')
        .get(input.id) as CheckpointRow | undefined;
      if (existing) {
        if (existing.task_id !== input.taskId || existing.content_sha256 !== contentSha256) {
          throw new AgentTaskError(
            'conflict',
            'Agent checkpoint id was reused with different content'
          );
        }
        return mapCheckpoint(existing);
      }
      const state = this.getPersistenceState(input.taskId);
      const sequence = this.db
        .prepare(
          `SELECT COALESCE(MAX(checkpoint_no), 0) + 1 AS checkpoint_no
           FROM agent_task_checkpoints WHERE task_id = ?`
        )
        .get(input.taskId) as { checkpoint_no: number };
      this.db
        .prepare(
          `INSERT INTO agent_task_checkpoints (
            id, task_id, checkpoint_no, state_version, content_sha256, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.id,
          input.taskId,
          sequence.checkpoint_no,
          state.stateVersion,
          contentSha256,
          stableStringify(input.payload),
          input.createdAt
        );
      this.db
        .prepare('UPDATE agent_task_state SET last_checkpoint_id = ? WHERE task_id = ?')
        .run(input.id, input.taskId);
      this.appendEventInTransaction({
        id: `checkpoint-created:${input.id}`,
        taskId: input.taskId,
        type: 'agent_task.checkpoint.created',
        entityType: 'checkpoint',
        entityId: input.id,
        stateVersion: state.stateVersion,
        payload: { checkpointNo: sequence.checkpoint_no, contentSha256 },
        occurredAt: input.createdAt,
      });
      const checkpoint = this.getLatestCheckpoint(input.taskId);
      if (!checkpoint) throw new Error(`Agent checkpoint ${input.id} was not persisted`);
      return checkpoint;
    });
  }

  getLatestCheckpoint(taskId: string): AgentTaskCheckpointRecord | null {
    this.requireTask(taskId);
    const row = this.db
      .prepare(
        `SELECT checkpoint.* FROM agent_task_checkpoints checkpoint
         JOIN agent_task_state state ON state.last_checkpoint_id = checkpoint.id
         WHERE state.task_id = ?`
      )
      .get(taskId) as CheckpointRow | undefined;
    return row ? mapCheckpoint(row) : null;
  }

  registerSkillVersion(input: SkillVersionRecord): { skill: SkillVersionRecord; created: boolean } {
    validateSkillVersion(input);
    const computedHash = computeSkillContentHash(input.manifest, input.instructions);
    if (computedHash !== input.manifest.contentHash) {
      throw new AgentTaskError('validation_failed', 'Skill contentHash does not match its content');
    }
    return this.transaction(() => {
      const existing = this.getSkillVersion(input.manifest.id, input.manifest.version);
      if (existing) {
        if (
          existing.manifest.contentHash !== input.manifest.contentHash ||
          stableStringify(existing.manifest) !== stableStringify(input.manifest) ||
          existing.instructions !== input.instructions ||
          existing.sourceRef !== input.sourceRef
        ) {
          throw new AgentTaskError(
            'conflict',
            'Skill id and version were reused with different content'
          );
        }
        return { skill: existing, created: false };
      }
      this.db
        .prepare(
          `INSERT INTO skill_registry_versions (
            skill_id, version, content_hash, manifest_json, instructions_text, source_ref,
            registered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.manifest.id,
          input.manifest.version,
          input.manifest.contentHash,
          stableStringify(input.manifest),
          input.instructions,
          input.sourceRef,
          input.registeredAt
        );
      return { skill: input, created: true };
    });
  }

  getSkillVersion(skillId: string, version: string): SkillVersionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM skill_registry_versions WHERE skill_id = ? AND version = ?')
      .get(skillId, version) as SkillRow | undefined;
    return row ? mapSkill(row) : null;
  }

  bindTaskSkills(
    taskId: string,
    pins: Array<{ skillId: string; version: string; contentHash: string }>,
    policySha256: string,
    boundAt: string
  ): AgentTaskSkillBindingRecord[] {
    assertSha256(policySha256, 'Skill policy hash');
    if (new Set(pins.map((pin) => pin.skillId)).size !== pins.length) {
      throw new AgentTaskError('validation_failed', 'Skill pins must not contain duplicate ids');
    }
    if (pins.length === 0) return [];
    return this.transaction(() => {
      const state = this.getPersistenceState(taskId);
      const existing = this.listTaskSkillBindings(taskId);
      if (existing.length > 0) {
        const expected = pins.map((pin, ordinal) => ({ ...pin, ordinal }));
        const actual = existing.map(({ skillId, version, contentHash, ordinal }) => ({
          skillId,
          version,
          contentHash,
          ordinal,
        }));
        if (
          stableStringify(actual) !== stableStringify(expected) ||
          existing.some((binding) => binding.policySha256 !== policySha256)
        ) {
          throw new AgentTaskError('conflict', 'Agent task Skill pins are immutable');
        }
        return existing;
      }
      pins.forEach((pin, ordinal) => {
        assertSha256(pin.contentHash, `Skill ${pin.skillId} contentHash`);
        const skill = this.getSkillVersion(pin.skillId, pin.version);
        if (!skill || skill.manifest.contentHash !== pin.contentHash) {
          throw new AgentTaskError(
            'validation_failed',
            `Skill ${pin.skillId}@${pin.version} does not match the registry hash`
          );
        }
        this.db
          .prepare(
            `INSERT INTO agent_task_skill_bindings (
              task_id, ordinal, skill_id, version, content_hash, policy_sha256, bound_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(taskId, ordinal, pin.skillId, pin.version, pin.contentHash, policySha256, boundAt);
      });
      this.appendEventInTransaction({
        id: `skills-bound:${taskId}`,
        taskId,
        type: 'agent_task.skills_bound',
        entityType: 'skill',
        entityId: taskId,
        stateVersion: state.stateVersion,
        payload: {
          policySha256,
          pins: pins.map(({ skillId, version, contentHash }) => ({
            skillId,
            version,
            contentHash,
          })),
        },
        occurredAt: boundAt,
      });
      return this.listTaskSkillBindings(taskId);
    });
  }

  listTaskSkillBindings(taskId: string): AgentTaskSkillBindingRecord[] {
    this.requireTask(taskId);
    const rows = this.db
      .prepare('SELECT * FROM agent_task_skill_bindings WHERE task_id = ? ORDER BY ordinal')
      .all(taskId) as unknown as TaskSkillBindingRow[];
    return rows.map(mapTaskSkillBinding);
  }

  close(): void {
    this.events.removeAllListeners();
    this.db.close();
  }

  /** Package-internal connection used for consistent backup and retention transactions. */
  connection(): DatabaseSync {
    return this.db;
  }

  private transitionStatus(
    taskId: string,
    allowedFrom: AgentTaskStatus[],
    to: Extract<AgentTaskStatus, 'running' | 'paused'>
  ): AgentTaskView {
    const now = new Date().toISOString();
    return this.transaction(() => {
      const current = this.requireTask(taskId);
      if (!allowedFrom.includes(current.status)) {
        throw new AgentTaskError(
          'conflict',
          `Agent task cannot transition from ${current.status} to ${to}`
        );
      }
      const updated = this.db
        .prepare(
          'UPDATE agent_tasks SET status = ?, updated_at = ? WHERE task_id = ? AND status = ?'
        )
        .run(to, now, taskId, current.status);
      if (updated.changes !== 1) {
        throw new AgentTaskError('conflict', 'Agent task state changed concurrently');
      }
      const stateVersion = this.incrementStateVersion(taskId);
      this.appendEventInTransaction({
        id: `task-${to}:${taskId}:${stateVersion}`,
        taskId,
        type: 'agent_task.state_changed',
        entityType: 'task',
        entityId: taskId,
        stateVersion,
        payload: { from: current.status, to },
        occurredAt: now,
      });
      return this.requireTask(taskId);
    });
  }

  private incrementStateVersion(taskId: string): number {
    const row = this.db
      .prepare(
        `UPDATE agent_task_state SET state_version = state_version + 1
         WHERE task_id = ? RETURNING state_version`
      )
      .get(taskId) as { state_version: number } | undefined;
    if (!row) throw new AgentTaskError('not_found', `Agent task state ${taskId} was not found`);
    return row.state_version;
  }

  private appendEventInTransaction(
    input: Omit<AgentTaskEventRecord, 'seq' | 'createdAt'>
  ): AgentTaskEventRecord {
    assertSafePayload(input.payload, 'event.payload');
    const sequence = this.db
      .prepare(
        `UPDATE agent_task_state SET next_event_seq = next_event_seq + 1
         WHERE task_id = ? RETURNING next_event_seq - 1 AS seq`
      )
      .get(input.taskId) as { seq: number } | undefined;
    if (!sequence) {
      throw new AgentTaskError('not_found', `Agent task state ${input.taskId} was not found`);
    }
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_task_events (
          id, task_id, seq, type, entity_type, entity_id, state_version, correlation_id,
          causation_id, payload_json, occurred_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.taskId,
        sequence.seq,
        input.type,
        input.entityType,
        input.entityId,
        input.stateVersion,
        input.correlationId ?? null,
        input.causationId ?? null,
        stableStringify(input.payload),
        input.occurredAt,
        createdAt
      );
    const row = this.db
      .prepare('SELECT * FROM agent_task_events WHERE task_id = ? AND seq = ?')
      .get(input.taskId, sequence.seq) as unknown as TaskEventRow;
    const event = mapTaskEvent(row);
    this.pendingEvents.push(event);
    return event;
  }

  private applyMigration(version: number, name: string, sql: string): void {
    const checksum = sha256(sql);
    const existing = this.db
      .prepare('SELECT name, checksum FROM agent_data_schema_migrations WHERE version = ?')
      .get(version) as { name: string; checksum: string } | undefined;
    if (existing) {
      if (existing.name !== name || existing.checksum !== checksum) {
        throw new Error(`Agent data migration ${version} checksum mismatch`);
      }
      return;
    }
    this.transaction(() => {
      this.db.exec(sql);
      this.db
        .prepare(
          `INSERT INTO agent_data_schema_migrations (version, name, checksum, applied_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(version, name, checksum, new Date().toISOString());
    });
  }

  private transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work();
    const pendingStart = this.pendingEvents.length;
    const result = (() => {
      this.db.exec('BEGIN IMMEDIATE');
      this.transactionDepth += 1;
      try {
        const value = work();
        this.db.exec('COMMIT');
        return value;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // Preserve the original persistence failure.
        }
        this.pendingEvents.splice(pendingStart);
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    })();
    const committedEvents = this.pendingEvents.splice(pendingStart);
    for (const event of committedEvents) this.publishEvent(event);
    return result;
  }

  private publishEvent(event: AgentTaskEventRecord): void {
    for (const listener of this.events.listeners(taskEventName(event.taskId))) {
      try {
        (listener as (value: AgentTaskEventRecord) => void)(event);
      } catch {
        // Event consumers cannot affect durable task state.
      }
    }
  }

  private getByClientTaskId(clientTaskId: string): AgentTaskView | null {
    const row = this.db
      .prepare('SELECT * FROM agent_tasks WHERE client_task_id = ?')
      .get(clientTaskId) as TaskRow | undefined;
    return row ? this.toView(row) : null;
  }

  private getByIdempotencyKey(key: string): AgentTaskView | null {
    const row = this.db.prepare('SELECT * FROM agent_tasks WHERE idempotency_key = ?').get(key) as
      | TaskRow
      | undefined;
    return row ? this.toView(row) : null;
  }

  private assertSameRequest(taskId: string, requestHash: string): void {
    const row = this.db
      .prepare('SELECT request_hash FROM agent_tasks WHERE task_id = ?')
      .get(taskId) as { request_hash: string } | undefined;
    if (!row || row.request_hash !== requestHash) {
      throw new AgentTaskError(
        'conflict',
        'Idempotency key or clientTaskId was reused with a different request'
      );
    }
  }

  private requireTask(taskId: string): AgentTaskView {
    const task = this.get(taskId);
    if (!task) throw new AgentTaskError('not_found', `Agent task ${taskId} was not found`);
    return task;
  }

  private toView(row: TaskRow): AgentTaskView {
    const request = JSON.parse(row.request_json) as PersistedAgentTaskRequest;
    const state = this.db
      .prepare('SELECT * FROM agent_task_state WHERE task_id = ?')
      .get(row.task_id) as TaskStateRow | undefined;
    if (!state)
      throw new AgentTaskError('not_found', `Agent task state ${row.task_id} was not found`);
    return {
      schema: request.schema,
      taskId: row.task_id,
      clientTaskId: row.client_task_id,
      status: row.status,
      stateVersion: state.state_version,
      eventSeq: state.next_event_seq - 1,
      ...(state.last_checkpoint_id ? { lastCheckpointId: state.last_checkpoint_id } : {}),
      modelRole: request.modelRole,
      request,
      ...(row.output_json ? { output: JSON.parse(row.output_json) as unknown } : {}),
      ...(row.error_json ? { error: JSON.parse(row.error_json) as AgentTaskProblem } : {}),
      ...(row.termination_reason ? { terminationReason: row.termination_reason } : {}),
      ...(row.usage_json ? { usage: JSON.parse(row.usage_json) as AgentTaskUsage } : {}),
      toolCalls: JSON.parse(row.tool_calls_json) as AgentTaskToolCallSummary[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.started_at ? { startedAt: row.started_at } : {}),
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    };
  }
}

function mapTaskState(row: TaskStateRow): AgentTaskPersistenceState {
  return {
    taskId: row.task_id,
    stateVersion: row.state_version,
    nextEventSeq: row.next_event_seq,
    ...(row.last_checkpoint_id ? { lastCheckpointId: row.last_checkpoint_id } : {}),
  };
}

function mapTaskEvent(row: TaskEventRow): AgentTaskEventRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    seq: row.seq,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    stateVersion: row.state_version,
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    ...(row.causation_id ? { causationId: row.causation_id } : {}),
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function mapTaskCommand(row: TaskCommandRow): AgentTaskCommandRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    expectedStateVersion: row.expected_state_version,
    requestHash: row.request_hash,
    status: row.status,
    ...(row.result_json ? { result: JSON.parse(row.result_json) as unknown } : {}),
    ...(row.error_json ? { error: JSON.parse(row.error_json) as AgentTaskProblem } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function mapCheckpoint(row: CheckpointRow): AgentTaskCheckpointRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    checkpointNo: row.checkpoint_no,
    stateVersion: row.state_version,
    contentSha256: row.content_sha256,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function mapSkill(row: SkillRow): SkillVersionRecord {
  return {
    manifest: JSON.parse(row.manifest_json) as SkillManifestV1,
    instructions: row.instructions_text,
    sourceRef: row.source_ref,
    registeredAt: row.registered_at,
  };
}

function mapTaskSkillBinding(row: TaskSkillBindingRow): AgentTaskSkillBindingRecord {
  return {
    taskId: row.task_id,
    ordinal: row.ordinal,
    skillId: row.skill_id,
    version: row.version,
    contentHash: row.content_hash,
    policySha256: row.policy_sha256,
    boundAt: row.bound_at,
  };
}

export function computeSkillContentHash(manifest: SkillManifestV1, instructions: string): string {
  const { contentHash: _contentHash, ...manifestWithoutHash } = manifest;
  return sha256(stableStringify({ manifest: manifestWithoutHash, instructions }));
}

function validateSkillVersion(input: SkillVersionRecord): void {
  const { manifest, instructions, sourceRef } = input;
  const manifestKeys = [
    'schema',
    'id',
    'version',
    'description',
    'contentHash',
    'requiredModelRole',
    'inputSchema',
    'outputSchema',
    'requiredToolPatterns',
    'limits',
  ];
  const unknownManifestKeys = Object.keys(manifest).filter((key) => !manifestKeys.includes(key));
  if (unknownManifestKeys.length > 0) {
    throw new AgentTaskError('validation_failed', 'Skill manifest contains unknown fields', false, {
      unknownFields: unknownManifestKeys,
    });
  }
  if (manifest.schema !== 'nebula.ai.skill/1.0') {
    throw new AgentTaskError('validation_failed', 'Skill schema is unsupported');
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(manifest.id)) {
    throw new AgentTaskError('validation_failed', 'Skill id must be a stable lowercase key');
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new AgentTaskError('validation_failed', 'Skill version must use semantic versioning');
  }
  assertSha256(manifest.contentHash, 'Skill contentHash');
  if (manifest.requiredModelRole !== 'decision') {
    throw new AgentTaskError('validation_failed', 'Skill requiredModelRole must be decision');
  }
  if (
    typeof manifest.description !== 'string' ||
    manifest.description.length < 1 ||
    manifest.description.length > 1000 ||
    typeof instructions !== 'string' ||
    instructions.length < 1 ||
    typeof sourceRef !== 'string' ||
    sourceRef.length < 1 ||
    sourceRef.length > 1000
  ) {
    throw new AgentTaskError('validation_failed', 'Skill text metadata is invalid');
  }
  if (
    !Array.isArray(manifest.requiredToolPatterns) ||
    manifest.requiredToolPatterns.length > 32 ||
    manifest.requiredToolPatterns.some(
      (pattern) => typeof pattern !== 'string' || pattern.length < 1 || pattern.length > 200
    )
  ) {
    throw new AgentTaskError('validation_failed', 'Skill requiredToolPatterns are invalid');
  }
  if (new Set(manifest.requiredToolPatterns).size !== manifest.requiredToolPatterns.length) {
    throw new AgentTaskError('validation_failed', 'Skill requiredToolPatterns contain duplicates');
  }
  if (
    manifest.requiredToolPatterns.some(
      (pattern) =>
        !/^[a-z0-9][a-z0-9._-]*(?:\.\*)?$/.test(pattern) ||
        pattern === '*' ||
        pattern.includes('..')
    )
  ) {
    throw new AgentTaskError('validation_failed', 'Skill tool patterns are unsafe');
  }
  if (
    manifest.requiredToolPatterns.some(
      (pattern) =>
        pattern !== 'browser-control.operation_execute' &&
        pattern !== 'vision.*' &&
        !/^vision\.[a-z0-9][a-z0-9._-]*$/.test(pattern)
    )
  ) {
    throw new AgentTaskError(
      'tool_not_allowed',
      'Skill tool patterns are outside the v1 server policy'
    );
  }
  if (!manifest.limits || typeof manifest.limits !== 'object' || Array.isArray(manifest.limits)) {
    throw new AgentTaskError('validation_failed', 'Skill limits must be an object');
  }
  const unknownLimitKeys = Object.keys(manifest.limits).filter(
    (key) => !['maxToolCalls', 'maxModelTurns', 'maxTokens'].includes(key)
  );
  if (unknownLimitKeys.length > 0) {
    throw new AgentTaskError('validation_failed', 'Skill limits contain unknown fields', false, {
      unknownFields: unknownLimitKeys,
    });
  }
  if (
    !Number.isSafeInteger(manifest.limits.maxToolCalls) ||
    manifest.limits.maxToolCalls < 0 ||
    manifest.limits.maxToolCalls > AGENT_TASK_LIMITS.maxToolCalls ||
    !Number.isSafeInteger(manifest.limits.maxModelTurns) ||
    manifest.limits.maxModelTurns < 1 ||
    manifest.limits.maxModelTurns > AGENT_TASK_LIMITS.maxModelTurns ||
    (manifest.limits.maxTokens !== undefined &&
      (!Number.isSafeInteger(manifest.limits.maxTokens) ||
        manifest.limits.maxTokens < 1 ||
        manifest.limits.maxTokens > AGENT_TASK_LIMITS.maxTokens))
  ) {
    throw new AgentTaskError('validation_failed', 'Skill limits are invalid');
  }
  validateBoundedObjectSchema(manifest.inputSchema);
  validateBoundedObjectSchema(manifest.outputSchema);
  const packageBytes = Buffer.byteLength(stableStringify({ manifest, instructions }), 'utf8');
  if (packageBytes > 256 * 1024) {
    throw new AgentTaskError('validation_failed', 'Skill package exceeds 256 KiB');
  }
  if (/:\/\/[^/@\s]+:[^/@\s]+@/.test(sourceRef)) {
    throw new AgentTaskError('validation_failed', 'Skill sourceRef must not contain credentials');
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new AgentTaskError('validation_failed', `${label} must be lowercase SHA-256`);
  }
}

function assertSafePayload(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  const serialized = stableStringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) {
    throw new AgentTaskError('validation_failed', `${path} exceeds 256 KiB`);
  }
  assertNoInlineSecret(value, path);
}

function assertNoInlineSecret(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoInlineSecret(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const isTokenMetric =
      ['inputTokens', 'outputTokens', 'totalTokens', 'maxTokens'].includes(key) &&
      Number.isSafeInteger(child) &&
      (child as number) >= 0;
    if (
      /(?:password|token|authorization|cookie|api[_-]?key|secret)/i.test(key) &&
      !/(?:ref|refs|hash)$/i.test(key) &&
      !isTokenMetric &&
      child !== null &&
      child !== ''
    ) {
      throw new AgentTaskError(
        'validation_failed',
        `${path}.${key} must use a secret reference or hash`
      );
    }
    assertNoInlineSecret(child, `${path}.${key}`);
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function taskEventName(taskId: string): string {
  return `agent-task:${taskId}`;
}
