import type { DatabaseSync } from 'node:sqlite';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence';
import type { HarnessRuntime } from './types.js';

const RESOURCE_TYPE = 'chat_session';

type DeletionPhase = 'tombstoned' | 'stopped' | 'flushed' | 'purged' | 'completed';

interface DeletionJobRow {
  resource_id: string;
  phase: DeletionPhase;
  expected_revision: string | null;
}

export interface DeletionChatRuntime {
  cancelAndDrain(sessionId: string): Promise<void>;
  catchUpDurable(
    sessionId: string,
    options?: { allowDeleted?: boolean; publish?: boolean }
  ): Promise<string | undefined>;
}

export type DeleteSessionResult = 'deleted' | 'not_found';

/** Restart-safe deletion saga for the SQLite projection and the durable DSH session. */
export class HarnessDeletionService {
  private readonly running = new Map<string, Promise<DeleteSessionResult>>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly chat: DeletionChatRuntime,
    private readonly harness: HarnessRuntime
  ) {}

  deleteSession(sessionId: string): Promise<DeleteSessionResult> {
    const current = this.running.get(sessionId);
    if (current) return current;
    const run = this.run(sessionId).finally(() => {
      this.running.delete(sessionId);
    });
    this.running.set(sessionId, run);
    return run;
  }

  async resumePending(): Promise<number> {
    const rows = this.db
      .prepare(
        `SELECT resource_id, phase, expected_revision
         FROM deletion_jobs
         WHERE resource_type = ? AND phase <> 'completed'
         ORDER BY created_at ASC`
      )
      .all(RESOURCE_TYPE) as unknown as DeletionJobRow[];
    await Promise.all(rows.map((row) => this.deleteSession(row.resource_id)));
    return rows.length;
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.running.values());
  }

  private async run(sessionId: string): Promise<DeleteSessionResult> {
    const started = this.begin(sessionId);
    if (started === 'not_found' || started === 'deleted') {
      return started === 'deleted' ? 'deleted' : 'not_found';
    }
    try {
      let job = this.requireJob(sessionId);
      if (job.phase === 'tombstoned') {
        await this.chat.cancelAndDrain(sessionId);
        this.advance(sessionId, 'stopped');
        job = this.requireJob(sessionId);
      }
      if (job.phase === 'stopped') {
        const revision = await this.chat.catchUpDurable(sessionId, {
          allowDeleted: true,
          publish: false,
        });
        this.advance(sessionId, 'flushed', revision);
        job = this.requireJob(sessionId);
      }
      if (job.phase === 'flushed') {
        if (job.expected_revision) {
          await this.harness.purge(
            SessionId(sessionId),
            job.expected_revision as SessionPersistenceRevision
          );
        }
        this.advance(sessionId, 'purged', job.expected_revision ?? undefined);
        job = this.requireJob(sessionId);
      }
      if (job.phase === 'purged') this.finish(sessionId);
      return 'deleted';
    } catch (error) {
      this.recordError(sessionId, error);
      throw error;
    }
  }

  private begin(sessionId: string): 'started' | 'deleted' | 'not_found' {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const deleted = this.db
        .prepare('SELECT 1 FROM deleted_resources WHERE resource_type = ? AND resource_id = ?')
        .get(RESOURCE_TYPE, sessionId);
      if (deleted) {
        this.db.exec('COMMIT');
        return 'deleted';
      }
      const existing = this.getJob(sessionId);
      if (existing) {
        this.db.exec('COMMIT');
        return 'started';
      }
      const session = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
      if (!session) {
        this.db.exec('COMMIT');
        return 'not_found';
      }
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT OR IGNORE INTO harness_session_projection(
             session_id, projected_dsh_seq, durable_dsh_seq, deleted_at
           ) VALUES (?, 0, 0, ?)`
        )
        .run(sessionId, now);
      this.db
        .prepare('UPDATE harness_session_projection SET deleted_at = ? WHERE session_id = ?')
        .run(now, sessionId);
      this.db
        .prepare(
          `INSERT INTO deletion_jobs(
             resource_type, resource_id, phase, created_at, updated_at
           ) VALUES (?, ?, 'tombstoned', ?, ?)`
        )
        .run(RESOURCE_TYPE, sessionId, now, now);
      this.db.exec('COMMIT');
      return 'started';
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private finish(sessionId: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      const refs = this.db
        .prepare(
          `SELECT content_hash FROM harness_attachment_refs
           WHERE session_id = ? AND released_at IS NULL`
        )
        .all(sessionId) as unknown as Array<{ content_hash: string }>;
      for (const ref of refs) {
        this.db
          .prepare(
            `UPDATE harness_attachments SET ref_count = MAX(ref_count - 1, 0)
             WHERE content_hash = ?`
          )
          .run(ref.content_hash);
      }
      this.db
        .prepare(
          `UPDATE harness_attachment_refs
           SET ref_count = 0, released_at = COALESCE(released_at, ?)
           WHERE session_id = ? AND released_at IS NULL`
        )
        .run(now, sessionId);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      this.db
        .prepare(
          `INSERT OR REPLACE INTO deleted_resources(resource_type, resource_id, deleted_at)
           VALUES (?, ?, ?)`
        )
        .run(RESOURCE_TYPE, sessionId, now);
      this.db
        .prepare(
          `UPDATE deletion_jobs
           SET phase = 'completed', last_error = NULL, updated_at = ?, completed_at = ?
           WHERE resource_type = ? AND resource_id = ?`
        )
        .run(now, now, RESOURCE_TYPE, sessionId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private advance(sessionId: string, phase: DeletionPhase, revision?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE deletion_jobs
         SET phase = ?, expected_revision = COALESCE(?, expected_revision),
             last_error = NULL, updated_at = ?
         WHERE resource_type = ? AND resource_id = ?`
      )
      .run(phase, revision ?? null, now, RESOURCE_TYPE, sessionId);
  }

  private recordError(sessionId: string, error: unknown): void {
    this.db
      .prepare(
        `UPDATE deletion_jobs SET last_error = ?, updated_at = ?
         WHERE resource_type = ? AND resource_id = ?`
      )
      .run(
        error instanceof Error ? error.message : String(error),
        new Date().toISOString(),
        RESOURCE_TYPE,
        sessionId
      );
  }

  private getJob(sessionId: string): DeletionJobRow | undefined {
    return this.db
      .prepare(
        `SELECT resource_id, phase, expected_revision
         FROM deletion_jobs WHERE resource_type = ? AND resource_id = ?`
      )
      .get(RESOURCE_TYPE, sessionId) as DeletionJobRow | undefined;
  }

  private requireJob(sessionId: string): DeletionJobRow {
    const job = this.getJob(sessionId);
    if (!job) throw new Error(`Deletion job disappeared for ${sessionId}`);
    return job;
  }
}
