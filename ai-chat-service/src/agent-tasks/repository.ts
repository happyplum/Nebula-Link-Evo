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

export class AgentTaskRepository {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = FULL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(`
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
    `);
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
    return { task: this.requireTask(input.taskId), created: true };
  }

  get(taskId: string): AgentTaskView | null {
    const row = this.db.prepare('SELECT * FROM agent_tasks WHERE task_id = ?').get(taskId) as
      | TaskRow
      | undefined;
    return row ? this.toView(row) : null;
  }

  markRunning(taskId: string): AgentTaskView {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
      UPDATE agent_tasks
      SET status = 'running', updated_at = ?, started_at = COALESCE(started_at, ?)
      WHERE task_id = ? AND status = 'created'
    `
      )
      .run(now, now, taskId);
    return this.requireTask(taskId);
  }

  complete(taskId: string, result: AgentTaskExecutionResult): AgentTaskView {
    const now = new Date().toISOString();
    this.db
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
    return this.requireTask(taskId);
  }

  fail(
    taskId: string,
    status: Extract<AgentTaskStatus, 'failed' | 'interrupted' | 'blocked' | 'cancelled'>,
    error: AgentTaskProblem,
    toolCalls: AgentTaskToolCallSummary[] = [],
    usage?: AgentTaskUsage
  ): AgentTaskView {
    const now = new Date().toISOString();
    this.db
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
    return this.requireTask(taskId);
  }

  recoverUnfinished(): number {
    const now = new Date().toISOString();
    const problem: AgentTaskProblem = {
      code: 'service_restarted',
      message: 'Agent task was interrupted because ai-chat-service restarted',
      retryable: true,
    };
    const result = this.db
      .prepare(
        `
      UPDATE agent_tasks SET status = 'interrupted', error_json = ?, termination_reason = 'service_restarted',
        updated_at = ?, completed_at = ?
      WHERE status IN ('created', 'running')
    `
      )
      .run(JSON.stringify(problem), now, now);
    return Number(result.changes);
  }

  close(): void {
    this.db.close();
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
