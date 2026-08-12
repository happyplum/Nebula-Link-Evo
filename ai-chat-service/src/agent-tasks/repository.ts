import { createHash } from 'node:crypto';
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
  PersistedAgentTaskRequest,
} from './types.js';

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

export interface CreateAgentTaskCommand {
  id: string;
  taskId: string;
  type: AgentTaskCommandRecord['type'];
  expectedStateVersion: number;
  requestHash: string;
  createdBy: string;
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
  }

  createOrGet(input: CreateStoredAgentTask): CreateStoredAgentTaskResult {
    const existing = input.idempotencyKey
      ? this.getByIdempotencyKey(input.idempotencyKey)
      : this.getByClientTaskId(input.request.clientTaskId);
    if (existing) {
      this.assertSameRequest(existing.taskId, input.requestHash);
      return { task: existing, created: false };
    }
    const sameClient = this.getByClientTaskId(input.request.clientTaskId);
    if (sameClient) {
      this.assertSameRequest(sameClient.taskId, input.requestHash);
      return { task: sameClient, created: false };
    }

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
      const rows = this.db
        .prepare("SELECT task_id, status FROM agent_tasks WHERE status IN ('created', 'running')")
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
        payload: { commandType: input.type },
        occurredAt: input.createdAt,
      });
      return this.getCommand(input.id)!;
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
        payload: { commandType: command.type },
        occurredAt: input.completedAt,
      });
      return this.getCommand(id)!;
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
      return this.getLatestCheckpoint(input.taskId)!;
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
    this.db.close();
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
    return mapTaskEvent(row);
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
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Preserve the original persistence failure.
      }
      throw error;
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
    return {
      schema: request.schema,
      taskId: row.task_id,
      clientTaskId: row.client_task_id,
      status: row.status,
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
  if (
    !Number.isSafeInteger(manifest.limits.maxToolCalls) ||
    manifest.limits.maxToolCalls < 0 ||
    !Number.isSafeInteger(manifest.limits.maxModelTurns) ||
    manifest.limits.maxModelTurns < 1 ||
    (manifest.limits.maxTokens !== undefined &&
      (!Number.isSafeInteger(manifest.limits.maxTokens) || manifest.limits.maxTokens < 1))
  ) {
    throw new AgentTaskError('validation_failed', 'Skill limits are invalid');
  }
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
    if (
      /(?:password|token|authorization|cookie|api[_-]?key|secret)/i.test(key) &&
      !/(?:ref|refs|hash)$/i.test(key) &&
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
