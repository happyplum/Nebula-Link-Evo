import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SessionStateDAO } from './session-state-dao.js';
import { SessionEventsDAO } from './session-events-dao.js';
import { SessionEventsCleanup } from '../services/session-events-cleanup.js';
import { up as migrate004 } from './migrations/004-sessions-state.js';
import { up as migrate005 } from './migrations/005-migrate-existing-sessions.js';
import { up as migrate006 } from './migrations/006-session-events.js';
import { up as migrate007 } from './migrations/007-add-vision-model-columns.js';
import type {
  Session,
  SessionStatus,
  Message,
  CreateSessionParams,
  CreateMessageParams,
  UpdateSessionParams,
  MessageMetadata,
  MessageRole,
  Interaction,
  CreateInteractionParams,
  QueryInteractionsOptions,
  InteractionStats,
  TracedOperation,
  CreateOperationParams,
  UpdateOperationParams,
  ControlCommandType,
  OperationStatus,
} from './types.js';

class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: DatabaseSync | null = null;
  private isInitialized = false;
  private sessionStateDAO: SessionStateDAO | null = null;
  private sessionEventsDAO: SessionEventsDAO | null = null;
  private sessionEventsCleanup: SessionEventsCleanup | null = null;

  private constructor() {}

  /**
   * Type guard for SQLite errors with code property
   */
  private static isSQLiteError(error: unknown): error is Error & { code: string } {
    return error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string';
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  /**
   * Reset singleton instance - for testing only
   * Note: Does not wait for async close operations
   */
  static resetInstance(): void {
    if (DatabaseManager.instance) {
      // Sync close - best effort
      try {
        if (DatabaseManager.instance.db) {
          // Stop cleanup scheduler
          if (DatabaseManager.instance.sessionEventsCleanup) {
            DatabaseManager.instance.sessionEventsCleanup.stop();
          }
          if (DatabaseManager.instance.sessionEventsDAO) {
            DatabaseManager.instance.sessionEventsDAO.dispose();
          }
          DatabaseManager.instance.db.close();
        }
      } catch {
        // Ignore errors during reset
      }
      DatabaseManager.instance = null;
    }
  }

  initialize(dbPath: string = ':memory:'): void {
    if (this.isInitialized && this.db) {
      return;
    }
    this.db = new DatabaseSync(dbPath);
    this.enableWalMode();
    this.createSchema();
    this.runMigrations();
    this.sessionStateDAO = new SessionStateDAO(this.db);
    this.sessionEventsDAO = new SessionEventsDAO(this.db);
    this.sessionEventsCleanup = new SessionEventsCleanup(
      this.db,
      this.sessionEventsDAO,
      process.env.NODE_ENV !== 'test'
    );
    if (process.env.NODE_ENV !== 'test') {
      this.sessionEventsCleanup.start();
    }
    this.isInitialized = true;
  }

  private enableWalMode(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
  }

  private runMigrations(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    migrate004(this.db);
    migrate005(this.db);
    migrate006(this.db);
    migrate007(this.db);
  }

  private sleep(ms: number): void {
    // Busy wait for synchronous context
    const start = Date.now();
    while (Date.now() - start < ms) {
      // Busy wait
    }
  }

  /**
   * Execute database write with retry logic for SQLITE_BUSY
   */
  private executeWithRetry<T>(operation: () => T, maxRetries = 3): T {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return operation();
      } catch (err: unknown) {
        if (DatabaseManager.isSQLiteError(err) && err.code === 'SQLITE_BUSY' && i < maxRetries - 1) {
          const delay = 100 * (i + 1); // Exponential backoff: 100ms, 200ms, 300ms
          this.sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Max retries exceeded');
  }

  private createSchema(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        summary TEXT,
        message_count INTEGER DEFAULT 0,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'paused', 'blocked', 'interrupted', 'cancelled', 'completed'))
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata TEXT,
        idempotency_key TEXT UNIQUE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)
    `);

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency_key ON messages(idempotency_key)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at ASC)
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        snapshot_id TEXT,
        nebula_id INTEGER,
        action_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        locator_strategy TEXT,
        success INTEGER NOT NULL,
        attempts INTEGER,
        latency_ms INTEGER,
        error_code TEXT,
        error_message TEXT,
        failure_sample_path TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON interactions(timestamp)
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operation_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed')),
        error TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_operation_logs_session_id ON operation_logs(session_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_operation_logs_start_time ON operation_logs(start_time DESC)
    `);
  }

  async close(): Promise<void> {
    if (this.db) {
      // Stop cleanup scheduler
      if (this.sessionEventsCleanup) {
        this.sessionEventsCleanup.stop();
      }
      // Dispose SessionEventsDAO to clear flush timer and flush any pending events
      if (this.sessionEventsDAO) {
        this.sessionEventsDAO.dispose();
        await this.sessionEventsDAO.flush();
      }
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      this.sessionStateDAO = null;
      this.sessionEventsDAO = null;
      this.sessionEventsCleanup = null;
    }
  }

  getSessionStateDAO(): SessionStateDAO {
    if (!this.sessionStateDAO) {
      throw new Error('Database not initialized');
    }
    return this.sessionStateDAO;
  }

  getSessionEventsDAO(): SessionEventsDAO {
    if (!this.sessionEventsDAO) {
      throw new Error('Database not initialized');
    }
    return this.sessionEventsDAO;
  }

  createSession(params: CreateSessionParams): Session {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const id = params.id || randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(
      `INSERT INTO sessions (id, title, created_at, updated_at, summary, message_count, provider, model, vision_provider, vision_model)
       VALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?, ?)`
    );
    stmt.run(id, params.title, now, now, params.provider, params.model, params.vision_provider ?? null, params.vision_model ?? null);

    return this.getSession(id) as Session;
  }

  getSession(id: string): Session | null {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as SessionRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      created_at: row.created_at,
      updated_at: row.updated_at,
      summary: row.summary,
      message_count: row.message_count,
      provider: row.provider,
      model: row.model,
      vision_provider: row.vision_provider,
      vision_model: row.vision_model,
      status: row.status as SessionStatus | undefined,
    };
  }

  updateSession(id: string, params: UpdateSessionParams): Session | null {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.title !== undefined) {
      updates.push('title = ?');
      values.push(params.title);
    }
    if (params.summary !== undefined) {
      updates.push('summary = ?');
      values.push(params.summary);
    }
    if (params.provider !== undefined) {
      updates.push('provider = ?');
      values.push(params.provider);
    }
    if (params.model !== undefined) {
      updates.push('model = ?');
      values.push(params.model);
    }
    if (params.vision_provider !== undefined) {
      updates.push('vision_provider = ?');
      values.push(params.vision_provider);
    }
    if (params.vision_model !== undefined) {
      updates.push('vision_model = ?');
      values.push(params.vision_model);
    }

    if (updates.length === 0) {
      return this.getSession(id);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    // Build SQL with placeholders - safe from SQL injection as values are passed separately
    const sql = `UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    stmt.run(...values);

    return this.getSession(id);
  }

  deleteSession(id: string): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(id);
  }

  listSessions(): Session[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Use rowid as a stable tie-breaker when timestamps are equal (common in fast unit tests).
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC, rowid DESC');
    const rows = stmt.all() as SessionRow[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      created_at: row.created_at,
      updated_at: row.updated_at,
      summary: row.summary,
      message_count: row.message_count,
      provider: row.provider,
      model: row.model,
      vision_provider: row.vision_provider,
      vision_model: row.vision_model,
      status: row.status as SessionStatus | undefined,
    }));
  }

  createMessage(params: CreateMessageParams): Message {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Message persistence is synchronous via DatabaseSync (no buffering/batching in this path).

    const id = params.id || randomUUID();
    const now = new Date().toISOString();
    const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

    const stmt = this.db.prepare(
      `INSERT INTO messages (id, session_id, role, content, created_at, metadata, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(id, params.session_id, params.role, params.content, now, metadata, params.idempotency_key ?? null);

    const updateStmt = this.db.prepare(
      'UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE id = ?'
    );
    updateStmt.run(now, params.session_id);

    return this.getMessage(id) as Message;
  }

  getMessage(id: string): Message | null {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare('SELECT * FROM messages WHERE id = ?');
    const row = stmt.get(id) as MessageRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      session_id: row.session_id,
      role: row.role as MessageRole,
      content: row.content,
      created_at: row.created_at,
      metadata: row.metadata ? (JSON.parse(row.metadata) as MessageMetadata) : null,
      idempotency_key: row.idempotency_key ?? undefined,
    };
  }

  getMessagesBySession(sessionId: string): Message[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC'
    );
    const rows = stmt.all(sessionId) as MessageRow[];

    return rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      role: row.role as MessageRole,
      content: row.content,
      created_at: row.created_at,
      metadata: row.metadata ? (JSON.parse(row.metadata) as MessageMetadata) : null,
      idempotency_key: row.idempotency_key ?? undefined,
    }));
  }

  getMessagesPaginated(sessionId: string, limit: number, offset: number): {
    messages: Message[];
    hasMore: boolean;
    total: number;
  } {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
    );
    const rows = stmt.all(sessionId, limit, offset) as MessageRow[];

    const countStmt = this.db.prepare(
      'SELECT COUNT(*) as total FROM messages WHERE session_id = ?'
    );
    const result = countStmt.get(sessionId) as { total: number };
    const total = result.total;

    const messages = rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      role: row.role as MessageRole,
      content: row.content,
      created_at: row.created_at,
      metadata: row.metadata ? (JSON.parse(row.metadata) as MessageMetadata) : null,
      idempotency_key: row.idempotency_key ?? undefined,
    }));

    const hasMore = offset + messages.length < total;

    return { messages, hasMore, total };
  }

  deleteMessage(id: string): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const message = this.getMessage(id);
    if (message) {
      const stmt = this.db.prepare('DELETE FROM messages WHERE id = ?');
      stmt.run(id);

      const updateStmt = this.db.prepare(
        'UPDATE sessions SET message_count = message_count - 1, updated_at = ? WHERE id = ?'
      );
      updateStmt.run(new Date().toISOString(), message.session_id);
    }
  }

  getMessageByIdempotencyKey(key: string): Message | null {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare('SELECT * FROM messages WHERE idempotency_key = ?');
    const row = stmt.get(key) as MessageRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      session_id: row.session_id,
      role: row.role as MessageRole,
      content: row.content,
      created_at: row.created_at,
      metadata: row.metadata ? (JSON.parse(row.metadata) as MessageMetadata) : null,
      idempotency_key: row.idempotency_key ?? undefined,
    };
  }

  executeSql(sql: string, params: unknown[] = []): unknown[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  insertInteraction(params: CreateInteractionParams): Interaction {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const timestamp = params.timestamp ?? Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO interactions (
        timestamp, snapshot_id, nebula_id, action_type, target_type,
        locator_strategy, success, attempts, latency_ms, error_code, error_message,
        failure_sample_path
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      timestamp,
      params.snapshot_id ?? null,
      params.nebula_id ?? null,
      params.action_type,
      params.target_type,
      params.locator_strategy ?? null,
      params.success ? 1 : 0,
      params.attempts ?? null,
      params.latency_ms ?? null,
      params.error_code ?? null,
      params.error_message ?? null,
      params.failure_sample_path ?? null
    );

    const insertStmt = this.db.prepare('SELECT * FROM interactions WHERE id = ?');
    const row = insertStmt.get(result.lastInsertRowid) as InteractionRow;

    return this.mapRowToInteraction(row);
  }

  queryInteractions(options: QueryInteractionsOptions = {}): Interaction[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (options.action_type) {
      conditions.push('action_type = ?');
      values.push(options.action_type);
    }
    if (options.target_type) {
      conditions.push('target_type = ?');
      values.push(options.target_type);
    }
    if (options.success !== undefined) {
      conditions.push('success = ?');
      values.push(options.success ? 1 : 0);
    }
    if (options.snapshot_id) {
      conditions.push('snapshot_id = ?');
      values.push(options.snapshot_id);
    }
    if (options.nebula_id !== undefined) {
      conditions.push('nebula_id = ?');
      values.push(options.nebula_id);
    }
    if (options.start_time) {
      conditions.push('timestamp >= ?');
      values.push(options.start_time);
    }
    if (options.end_time) {
      conditions.push('timestamp <= ?');
      values.push(options.end_time);
    }
    if (options.locator_strategy) {
      conditions.push('locator_strategy = ?');
      values.push(options.locator_strategy);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const params: unknown[] = [...values];
    let sql = `SELECT * FROM interactions ${whereClause} ORDER BY timestamp DESC`;

    if (options.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as InteractionRow[];

    return rows.map((row) => this.mapRowToInteraction(row));
  }

  getStats(): InteractionStats {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM interactions');
    const total = (totalStmt.get() as { count: number }).count;

    const successStmt = this.db.prepare('SELECT COUNT(*) as count FROM interactions WHERE success = 1');
    const success_count = (successStmt.get() as { count: number }).count;

    const failure_count = total - success_count;
    const success_rate = total > 0 ? (success_count / total) * 100 : 0;

    const latencyStmt = this.db.prepare('SELECT AVG(latency_ms) as avg FROM interactions WHERE latency_ms IS NOT NULL');
    const latencyResult = latencyStmt.get() as { avg: number | null };
    const avg_latency_ms = latencyResult.avg;

    const attemptsStmt = this.db.prepare('SELECT AVG(attempts) as avg FROM interactions WHERE attempts IS NOT NULL');
    const attemptsResult = attemptsStmt.get() as { avg: number | null };
    const avg_attempts = attemptsResult.avg;

    const actionTypeStmt = this.db.prepare('SELECT action_type, COUNT(*) as count FROM interactions GROUP BY action_type');
    const by_action_type_result = actionTypeStmt.all() as { action_type: string; count: number }[];
    const by_action_type: Record<string, number> = {};
    for (const row of by_action_type_result) {
      by_action_type[row.action_type] = row.count;
    }

    const targetTypeStmt = this.db.prepare('SELECT target_type, COUNT(*) as count FROM interactions GROUP BY target_type');
    const by_target_type_result = targetTypeStmt.all() as { target_type: string; count: number }[];
    const by_target_type: Record<string, number> = {};
    for (const row of by_target_type_result) {
      by_target_type[row.target_type] = row.count;
    }

    return {
      total,
      success_count,
      failure_count,
      success_rate,
      avg_latency_ms,
      avg_attempts,
      by_action_type,
      by_target_type,
    };
  }

  private mapRowToInteraction(row: InteractionRow): Interaction {
    return {
      id: row.id,
      timestamp: row.timestamp,
      snapshot_id: row.snapshot_id,
      nebula_id: row.nebula_id,
      action_type: row.action_type,
      target_type: row.target_type,
      locator_strategy: row.locator_strategy,
      success: row.success === 1,
      attempts: row.attempts,
      latency_ms: row.latency_ms,
      error_code: row.error_code,
      error_message: row.error_message,
      failure_sample_path: row.failure_sample_path,
    };
  }

  createOperation(params: CreateOperationParams): TracedOperation {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const traceId = randomUUID();
    const startTime = Date.now();
    const status = params.status ?? 'pending';

    const stmt = this.db.prepare(
      `INSERT INTO operation_logs (id, session_id, operation, start_time, end_time, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(traceId, params.sessionId, params.operation, startTime, null, status, params.error ?? null);

    return this.getOperation(traceId) as TracedOperation;
  }

  getOperation(traceId: string): TracedOperation | null {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare('SELECT * FROM operation_logs WHERE id = ?');
    const row = stmt.get(traceId) as OperationLogRow | undefined;

    if (!row) {
      return null;
    }

    return {
      traceId: row.id,
      sessionId: row.session_id,
      operation: row.operation as ControlCommandType,
      startTime: row.start_time,
      endTime: row.end_time ?? undefined,
      status: row.status as OperationStatus,
      error: row.error ?? undefined,
    };
  }

  updateOperation(traceId: string, params: UpdateOperationParams): TracedOperation | null {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.endTime !== undefined) {
      updates.push('end_time = ?');
      values.push(params.endTime);
    }
    if (params.status !== undefined) {
      updates.push('status = ?');
      values.push(params.status);
    }
    if (params.error !== undefined) {
      updates.push('error = ?');
      values.push(params.error);
    }

    if (updates.length === 0) {
      return this.getOperation(traceId);
    }

    values.push(traceId);

    const sql = `UPDATE operation_logs SET ${updates.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    stmt.run(...values);

    return this.getOperation(traceId);
  }

  getOperationsBySession(sessionId: string): TracedOperation[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(
      'SELECT * FROM operation_logs WHERE session_id = ? ORDER BY start_time DESC'
    );
    const rows = stmt.all(sessionId) as OperationLogRow[];

    return rows.map((row) => ({
      traceId: row.id,
      sessionId: row.session_id,
      operation: row.operation as ControlCommandType,
      startTime: row.start_time,
      endTime: row.end_time ?? undefined,
      status: row.status as OperationStatus,
      error: row.error ?? undefined,
    }));
  }

  /**
   * Update session status
   */
  updateSessionStatus(sessionId: string, status: SessionStatus): Session | null {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this.executeWithRetry(() => {
      const stmt = this.db!.prepare(
        'UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?'
      );
      stmt.run(status, new Date().toISOString(), sessionId);
    });

    return this.getSession(sessionId);
  }

  /**
   * Activate session: change status from idle to running
   */
  activateSession(sessionId: string): Session | null {
    return this.updateSessionStatus(sessionId, 'running');
  }

  /**
   * Recover running sessions on startup
   * Returns sessions that were marked as 'running' and should be changed to 'blocked'
   */
  recoverRunningSessions(): Array<{ id: string; status: string }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare('SELECT id, status FROM sessions WHERE status = ?');
    const rows = stmt.all('running') as Array<{ id: string; status: string }>;

    const recoveredSessions: Array<{ id: string; status: string }> = [];

    for (const row of rows) {
      this.executeWithRetry(() => {
        const stmtUpdate = this.db!.prepare(
          'UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?'
        );
        stmtUpdate.run('blocked', new Date().toISOString(), row.id);
      });

      recoveredSessions.push({
        id: row.id,
        status: 'blocked',
      });
    }

    return recoveredSessions;
  }
}

interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  summary: string | null;
  message_count: number;
  provider: string;
  model: string;
  vision_provider: string | null;
  vision_model: string | null;
  status: string | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  metadata: string | null;
  idempotency_key: string | null;
}

interface InteractionRow {
  id: number;
  timestamp: number;
  snapshot_id: string | null;
  nebula_id: number | null;
  action_type: string;
  target_type: string;
  locator_strategy: string | null;
  success: number;
  attempts: number | null;
  latency_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  failure_sample_path: string | null;
}

interface OperationLogRow {
  id: string;
  session_id: string;
  operation: string;
  start_time: number;
  end_time: number | null;
  status: string;
  error: string | null;
}

export { DatabaseManager };
