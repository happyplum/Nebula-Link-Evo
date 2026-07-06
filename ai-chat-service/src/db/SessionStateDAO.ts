import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  CreateSessionStateParams,
  SessionState,
  SessionStatus,
  UpdateSessionStateParams,
} from './types.js';

export class OptimisticLockError extends Error {
  constructor(message: string = 'Optimistic lock violation: version mismatch') {
    super(message);
    this.name = 'OptimisticLockError';
  }
}

interface SessionStateRow {
  readonly session_id: string;
  readonly status: string;
  readonly last_active_at: string;
  readonly agent_state: string | null;
  readonly job_id: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export class SessionStateDAO {
  private db: DatabaseSync | null = null;
  private initialized = false;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.initialized = true;
  }

  async create(params: CreateSessionStateParams): Promise<void> {
    this.assertInitialized();

    const now = new Date().toISOString();
    const agentStateJson = params.agentState ? JSON.stringify(params.agentState) : null;

    const db = this.getDb();
    const stmt = db.prepare(
      `INSERT INTO sessions_state (
        session_id, status, last_active_at, agent_state, job_id,
        version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    );

    stmt.run(
      params.sessionId,
      params.status || 'idle',
      now,
      agentStateJson,
      params.jobId || null,
      now,
      now
    );
  }

  async update(
    sessionId: string,
    params: UpdateSessionStateParams,
    expectedVersion?: number
  ): Promise<void> {
    this.assertInitialized();

    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.status !== undefined) {
      updates.push('status = ?');
      values.push(params.status);
    }
    if (params.agentState !== undefined) {
      updates.push('agent_state = ?');
      values.push(params.agentState ? JSON.stringify(params.agentState) : null);
    }
    if (params.jobId !== undefined) {
      updates.push('job_id = ?');
      values.push(params.jobId || null);
    }
    if (params.lastActiveAt !== undefined) {
      updates.push('last_active_at = ?');
      values.push(params.lastActiveAt);
    }

    if (updates.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    updates.push('version = version + 1');
    updates.push('updated_at = ?');
    values.push(now);

    if (expectedVersion !== undefined) {
      const current = await this.get(sessionId);
      if (!current) {
        throw new Error(`Session ${sessionId} not found`);
      }
      if (current.version !== expectedVersion) {
        throw new OptimisticLockError(
          `Version mismatch: expected ${expectedVersion}, actual ${current.version}`
        );
      }

      values.push(sessionId, expectedVersion);
      const sql = `UPDATE sessions_state SET ${updates.join(', ')} WHERE session_id = ? AND version = ?`;
      const stmt = this.getDb().prepare(sql);
      const result = stmt.run(...(values as SQLInputValue[]));

      if (result.changes === 0) {
        throw new OptimisticLockError(
          `Version mismatch: expected ${expectedVersion}, but no rows updated`
        );
      }
      return;
    }

    values.push(sessionId);
    const sql = `UPDATE sessions_state SET ${updates.join(', ')} WHERE session_id = ?`;
    const stmt = this.getDb().prepare(sql);
    stmt.run(...(values as SQLInputValue[]));
  }

  async get(sessionId: string): Promise<SessionState | null> {
    this.assertInitialized();

    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM sessions_state WHERE session_id = ?');
    const row = stmt.get(sessionId) as SessionStateRow | undefined;

    if (!row) {
      await this.create({ sessionId, status: 'idle' });
      return this.get(sessionId);
    }

    return this.rowToState(row);
  }

  async getStatus(sessionId: string): Promise<string | null> {
    this.assertInitialized();

    const db = this.getDb();
    const stmt = db.prepare('SELECT status FROM sessions_state WHERE session_id = ?');
    const row = stmt.get(sessionId) as { readonly status: string } | undefined;

    return row?.status || null;
  }

  async updateStatus(
    sessionId: string,
    status: SessionStatus,
    agentState?: SessionState['agentState']
  ): Promise<void> {
    this.assertInitialized();

    const now = new Date().toISOString();
    const agentStateJson = agentState ? JSON.stringify(agentState) : null;

    const db = this.getDb();
    const stmt = db.prepare(
      `UPDATE sessions_state
       SET status = ?, agent_state = ?, last_active_at = ?, version = version + 1, updated_at = ?
       WHERE session_id = ?`
    );

    stmt.run(status, agentStateJson, now, now, sessionId);
  }

  async getActiveSessions(): Promise<SessionState[]> {
    this.assertInitialized();

    const db = this.getDb();
    const stmt = db.prepare(
      `SELECT * FROM sessions_state
       WHERE status IN ('running', 'paused', 'blocked')
       ORDER BY last_active_at DESC`
    );
    const rows = stmt.all() as unknown as SessionStateRow[];

    return rows.map((row) => this.rowToState(row));
  }

  async getSessionsByStatus(status: SessionStatus): Promise<SessionState[]> {
    this.assertInitialized();

    const db = this.getDb();
    const stmt = db.prepare(
      `SELECT * FROM sessions_state WHERE status = ? ORDER BY last_active_at DESC`
    );
    const rows = stmt.all(status) as unknown as SessionStateRow[];

    return rows.map((row) => this.rowToState(row));
  }

  async delete(sessionId: string): Promise<void> {
    this.assertInitialized();

    const db = this.getDb();
    const stmt = db.prepare('DELETE FROM sessions_state WHERE session_id = ?');
    stmt.run(sessionId);
  }

  private assertInitialized(): void {
    if (!this.db || !this.initialized) {
      throw new Error('SessionStateDAO not initialized');
    }
  }

  private getDb(): DatabaseSync {
    const db = this.db;
    if (!db || !this.initialized) {
      throw new Error('SessionStateDAO not initialized');
    }
    return db;
  }

  private rowToState(row: SessionStateRow): SessionState {
    return {
      sessionId: row.session_id,
      status: row.status as SessionStatus,
      lastActiveAt: row.last_active_at,
      agentState: row.agent_state ? (JSON.parse(row.agent_state) as SessionState['agentState']) : undefined,
      jobId: row.job_id || undefined,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
