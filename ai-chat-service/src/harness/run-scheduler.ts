import type { DatabaseSync } from 'node:sqlite';
import { ServiceUnavailableError } from '../errors/http-errors.js';

export interface HarnessRunRequest {
  runId: string;
  ownerType: 'chat' | 'agent_task';
  ownerId: string;
  messageId: string;
  idempotencyKey?: string;
}

type RunStatus = 'queued' | 'active' | 'completed' | 'cancelled';

interface RunRow {
  run_id: string;
  owner_type: HarnessRunRequest['ownerType'];
  owner_id: string;
  message_id: string;
  idempotency_key: string | null;
  status: RunStatus;
  queue_seq: number;
}

/** Persistent FIFO permit scheduler shared by Chat and Agent Task. */
export class HarnessRunScheduler {
  private readonly waiters = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  private closed = false;

  constructor(
    private readonly db: DatabaseSync,
    private readonly maxActive = 4,
    private readonly maxQueued = 1_000
  ) {
    this.db
      .prepare(
        "UPDATE harness_model_runs SET status = 'cancelled', updated_at = ? WHERE status IN ('active', 'queued')"
      )
      .run(new Date().toISOString());
  }

  enqueue(request: HarnessRunRequest): 'active' | 'queued' {
    if (this.closed) throw new ServiceUnavailableError('Model run scheduler is shutting down');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.get(request.runId);
      if (existing) {
        this.assertIdentity(existing, request);
        if (existing.status === 'active' || existing.status === 'queued') {
          this.db.exec('COMMIT');
          return existing.status;
        }
      }
      const counts = this.db
        .prepare(
          `SELECT
             SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
             SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued
           FROM harness_model_runs`
        )
        .get() as { active: number | null; queued: number | null };
      const active = counts.active ?? 0;
      const queued = counts.queued ?? 0;
      const status: 'active' | 'queued' = active < this.maxActive ? 'active' : 'queued';
      if (status === 'queued' && queued >= this.maxQueued) {
        throw new ServiceUnavailableError('Model run queue is full');
      }
      const queueSeq = this.nextQueueSeq();
      const now = new Date().toISOString();
      if (existing) {
        this.db
          .prepare(
            `UPDATE harness_model_runs SET status = ?, queue_seq = ?, updated_at = ? WHERE run_id = ?`
          )
          .run(status, queueSeq, now, request.runId);
      } else {
        this.db
          .prepare(
            `INSERT INTO harness_model_runs(
               run_id, owner_type, owner_id, message_id, idempotency_key,
               status, queue_seq, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            request.runId,
            request.ownerType,
            request.ownerId,
            request.messageId,
            request.idempotencyKey ?? null,
            status,
            queueSeq,
            now,
            now
          );
      }
      this.db.exec('COMMIT');
      return status;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async wait(runId: string, signal?: AbortSignal): Promise<void> {
    const row = this.get(runId);
    if (!row) throw new Error(`Model run ${runId} is not scheduled`);
    if (row.status === 'active') return;
    if (row.status !== 'queued') throw new Error(`Model run ${runId} is ${row.status}`);
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => {
        this.cancel(runId);
        reject(
          signal?.reason instanceof Error ? signal.reason : new Error('Model run wait aborted')
        );
      };
      if (signal?.aborted) return abort();
      const settle = {
        resolve: () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        },
        reject: (error: Error) => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        },
      };
      this.waiters.set(runId, settle);
      signal?.addEventListener('abort', abort, { once: true });
      if (this.get(runId)?.status === 'active') {
        this.waiters.delete(runId);
        settle.resolve();
      }
    });
  }

  complete(runId: string): void {
    this.finish(runId, 'completed');
  }

  cancel(runId: string): void {
    this.finish(runId, 'cancelled');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          "UPDATE harness_model_runs SET status = 'cancelled', updated_at = ? WHERE status IN ('active', 'queued')"
        )
        .run(new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    for (const waiter of this.waiters.values())
      waiter.reject(new Error('Model run scheduler closed'));
    this.waiters.clear();
  }

  private finish(runId: string, status: Extract<RunStatus, 'completed' | 'cancelled'>): void {
    this.db.exec('BEGIN IMMEDIATE');
    let promoted: string | undefined;
    try {
      const row = this.get(runId);
      if (!row || row.status === 'completed' || row.status === 'cancelled') {
        this.db.exec('COMMIT');
        return;
      }
      this.db
        .prepare('UPDATE harness_model_runs SET status = ?, updated_at = ? WHERE run_id = ?')
        .run(status, new Date().toISOString(), runId);
      if (row.status === 'active') {
        const next = this.db
          .prepare(
            "SELECT run_id FROM harness_model_runs WHERE status = 'queued' ORDER BY queue_seq ASC LIMIT 1"
          )
          .get() as { run_id: string } | undefined;
        if (next) {
          this.db
            .prepare(
              "UPDATE harness_model_runs SET status = 'active', updated_at = ? WHERE run_id = ?"
            )
            .run(new Date().toISOString(), next.run_id);
          promoted = next.run_id;
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const ownWaiter = this.waiters.get(runId);
    if (ownWaiter && status === 'cancelled') {
      this.waiters.delete(runId);
      ownWaiter.reject(new Error('Model run cancelled'));
    }
    if (promoted) {
      const waiter = this.waiters.get(promoted);
      if (waiter) {
        this.waiters.delete(promoted);
        waiter.resolve();
      }
    }
  }

  private nextQueueSeq(): number {
    const row = this.db
      .prepare(
        `UPDATE harness_run_scheduler_state SET next_queue_seq = next_queue_seq + 1
         WHERE singleton = 1 RETURNING next_queue_seq - 1 AS seq`
      )
      .get() as { seq: number } | undefined;
    if (!row) throw new Error('Harness scheduler state is missing');
    return row.seq;
  }

  private get(runId: string): RunRow | undefined {
    return this.db.prepare('SELECT * FROM harness_model_runs WHERE run_id = ?').get(runId) as
      | RunRow
      | undefined;
  }

  private assertIdentity(row: RunRow, request: HarnessRunRequest): void {
    if (
      row.owner_type !== request.ownerType ||
      row.owner_id !== request.ownerId ||
      row.message_id !== request.messageId ||
      row.idempotency_key !== (request.idempotencyKey ?? null)
    ) {
      throw new Error(`Model run ${request.runId} identity is immutable`);
    }
  }
}
