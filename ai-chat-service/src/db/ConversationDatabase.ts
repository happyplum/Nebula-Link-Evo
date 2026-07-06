import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { SessionEventsCleanup } from './SessionEventsCleanup.js';
import { SessionEventsDAO } from './SessionEventsDAO.js';
import { SessionStateDAO } from './SessionStateDAO.js';
import type {
  CreateMessageParams,
  CreateSessionParams,
  Message,
  MessageMetadata,
  MessageRole,
  Session,
  SessionStatus,
  UpdateSessionParams,
} from './types.js';

const DEFAULT_DB_PATH = join(process.cwd(), 'data', 'ai-chat-service', 'conversations.sqlite');

// allow: SIZE_OK — T6 mirrors the existing proxy DatabaseManager API surface so T7 can move call sites without rewriting behavior.

export class ConversationDatabase {
  private static instance: ConversationDatabase | null = null;
  private db: DatabaseSync | null = null;
  private isInitialized = false;
  private sessionStateDAO: SessionStateDAO | null = null;
  private sessionEventsDAO: SessionEventsDAO | null = null;
  private sessionEventsCleanup: SessionEventsCleanup | null = null;

  private constructor() {}

  static getInstance(): ConversationDatabase {
    if (!ConversationDatabase.instance) {
      ConversationDatabase.instance = new ConversationDatabase();
    }
    return ConversationDatabase.instance;
  }

  static resetInstance(): void {
    if (!ConversationDatabase.instance) {
      return;
    }
    try {
      ConversationDatabase.instance.closeSync();
    } finally {
      ConversationDatabase.instance = null;
    }
  }

  initialize(dbPath: string = DEFAULT_DB_PATH): void {
    if (this.isInitialized && this.db) {
      return;
    }

    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.enableWalMode();
    this.createSchema();

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

  async close(): Promise<void> {
    await this.closeInternal();
  }

  getSessionStateDAO(): SessionStateDAO {
    if (!this.sessionStateDAO) {
      throw new Error('Conversation database not initialized');
    }
    return this.sessionStateDAO;
  }

  getSessionEventsDAO(): SessionEventsDAO {
    if (!this.sessionEventsDAO) {
      throw new Error('Conversation database not initialized');
    }
    return this.sessionEventsDAO;
  }

  getSessionEventsCleanup(): SessionEventsCleanup {
    if (!this.sessionEventsCleanup) {
      throw new Error('Conversation database not initialized');
    }
    return this.sessionEventsCleanup;
  }

  createSession(params: CreateSessionParams): Session {
    const db = this.getDb();
    const id = params.id || randomUUID();
    const now = new Date().toISOString();

    const stmt = db.prepare(
      `INSERT INTO sessions (id, title, created_at, updated_at, summary, message_count, provider, model)
       VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`
    );
    stmt.run(id, params.title, now, now, params.provider, params.model);

    return this.getSession(id) as Session;
  }

  getSession(id: string): Session | null {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as SessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  updateSession(id: string, params: UpdateSessionParams): Session | null {
    const db = this.getDb();
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
    if (updates.length === 0) {
      return this.getSession(id);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString(), id);

    const stmt = db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...(values as SQLInputValue[]));
    return this.getSession(id);
  }

  deleteSession(id: string): void {
    const db = this.getDb();
    const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(id);
  }

  listSessions(): Session[] {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC, rowid DESC');
    const rows = stmt.all() as unknown as SessionRow[];
    return rows.map((row) => this.rowToSession(row));
  }

  createMessage(params: CreateMessageParams): Message {
    const db = this.getDb();
    const id = params.id || randomUUID();
    const now = new Date().toISOString();
    const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

    const stmt = db.prepare(
      `INSERT INTO messages (id, session_id, role, content, created_at, metadata, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(id, params.session_id, params.role, params.content, now, metadata, params.idempotency_key ?? null);

    const updateStmt = db.prepare(
      'UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE id = ?'
    );
    updateStmt.run(now, params.session_id);

    return this.getMessage(id) as Message;
  }

  getMessage(id: string): Message | null {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM messages WHERE id = ?');
    const row = stmt.get(id) as MessageRow | undefined;
    return row ? this.rowToMessage(row) : null;
  }

  getMessagesBySession(sessionId: string): Message[] {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
    const rows = stmt.all(sessionId) as unknown as MessageRow[];
    return rows.map((row) => this.rowToMessage(row));
  }

  getMessagesPaginated(sessionId: string, limit: number, offset: number): {
    readonly messages: Message[];
    readonly hasMore: boolean;
    readonly total: number;
  } {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?');
    const rows = stmt.all(sessionId, limit, offset) as unknown as MessageRow[];
    const countStmt = db.prepare('SELECT COUNT(*) as total FROM messages WHERE session_id = ?');
    const result = countStmt.get(sessionId) as { readonly total: number };
    const messages = rows.map((row) => this.rowToMessage(row));

    return { messages, hasMore: offset + messages.length < result.total, total: result.total };
  }

  deleteMessage(id: string): void {
    const db = this.getDb();
    const message = this.getMessage(id);
    if (!message) {
      return;
    }

    const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
    stmt.run(id);

    const updateStmt = db.prepare(
      'UPDATE sessions SET message_count = message_count - 1, updated_at = ? WHERE id = ?'
    );
    updateStmt.run(new Date().toISOString(), message.session_id);
  }

  getMessageByIdempotencyKey(key: string): Message | null {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM messages WHERE idempotency_key = ?');
    const row = stmt.get(key) as MessageRow | undefined;
    return row ? this.rowToMessage(row) : null;
  }

  updateSessionStatus(sessionId: string, status: SessionStatus): Session | null {
    const db = this.getDb();
    const stmt = db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?');
    stmt.run(status, new Date().toISOString(), sessionId);
    return this.getSession(sessionId);
  }

  activateSession(sessionId: string): Session | null {
    return this.updateSessionStatus(sessionId, 'running');
  }

  recoverRunningSessions(): Array<{ readonly id: string; readonly status: string }> {
    const db = this.getDb();
    const stmt = db.prepare('SELECT id, status FROM sessions WHERE status = ?');
    const rows = stmt.all('running') as Array<{ readonly id: string; readonly status: string }>;
    const recoveredSessions: Array<{ readonly id: string; readonly status: string }> = [];

    for (const row of rows) {
      const stmtUpdate = db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?');
      stmtUpdate.run('blocked', new Date().toISOString(), row.id);
      recoveredSessions.push({ id: row.id, status: 'blocked' });
    }

    return recoveredSessions;
  }

  private enableWalMode(): void {
    const db = this.getDb();
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA busy_timeout = 5000');
  }

  private createSchema(): void {
    const db = this.getDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        summary TEXT,
        message_count INTEGER DEFAULT 0,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'paused', 'blocked', 'interrupted', 'cancelled', 'completed')),
        vision_provider TEXT,
        vision_model TEXT
      )
    `);
    db.exec(`
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
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency_key ON messages(idempotency_key)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at ASC)');

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions_state (
        session_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('idle', 'running', 'paused', 'blocked', 'interrupted', 'cancelled', 'completed')),
        last_active_at TEXT NOT NULL,
        agent_state TEXT,
        job_id TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_state_status ON sessions_state(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_state_last_active ON sessions_state(last_active_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_state_job_id ON sessions_state(job_id)');

    db.exec(`
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ttl_expires_at TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, seq)
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_session_events_session_seq ON session_events(session_id, seq)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_session_events_ttl ON session_events(ttl_expires_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(event_type)');
  }

  private async closeInternal(): Promise<void> {
    if (!this.db) {
      return;
    }

    if (this.sessionEventsCleanup) {
      this.sessionEventsCleanup.stop();
    }
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

  private closeSync(): void {
    if (!this.db) {
      return;
    }
    if (this.sessionEventsCleanup) {
      this.sessionEventsCleanup.stop();
    }
    if (this.sessionEventsDAO) {
      this.sessionEventsDAO.dispose();
      this.sessionEventsDAO.flushSync();
    }
    this.db.close();
    this.db = null;
    this.isInitialized = false;
    this.sessionStateDAO = null;
    this.sessionEventsDAO = null;
    this.sessionEventsCleanup = null;
  }

  private getDb(): DatabaseSync {
    if (!this.db) {
      throw new Error('Conversation database not initialized');
    }
    return this.db;
  }

  private rowToSession(row: SessionRow): Session {
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

  private rowToMessage(row: MessageRow): Message {
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
}

interface SessionRow {
  readonly id: string;
  readonly title: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly summary: string | null;
  readonly message_count: number;
  readonly provider: string;
  readonly model: string;
  readonly vision_provider: string | null;
  readonly vision_model: string | null;
  readonly status: string | null;
}

interface MessageRow {
  readonly id: string;
  readonly session_id: string;
  readonly role: string;
  readonly content: string;
  readonly created_at: string;
  readonly metadata: string | null;
  readonly idempotency_key: string | null;
}

export const conversationDatabase = ConversationDatabase.getInstance();
