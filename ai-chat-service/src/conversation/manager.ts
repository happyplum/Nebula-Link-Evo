import { ConversationDatabase } from '../db/ConversationDatabase.js';
import type {
  Session,
  Message,
  CreateSessionParams,
  MessageRole,
  SessionState,
  CreateSessionStateParams,
  UpdateSessionStateParams,
  UpdateSessionParams,
} from '../db/types.js';
import type { ToolCall } from '@nebula-link-evo/shared';

interface ListOptions {
  limit?: number;
  offset?: number;
}

interface CreateSessionWithPrompt extends CreateSessionParams {
  systemPrompt?: string;
}

interface AddMessageParams {
  role: MessageRole;
  content: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

class ConversationManager {
  private db: ConversationDatabase;
  private initialized = false;
  private activeToolCalls = new Map<string, ToolCall[]>();

  constructor(
    dbPath: string = ':memory:',
    db: ConversationDatabase = ConversationDatabase.getInstance()
  ) {
    this.db = db;
    this.initialize(dbPath);
  }

  initialize(dbPath: string = ':memory:'): void {
    if (this.initialized) {
      return;
    }
    this.db.initialize(dbPath);
    this.initialized = true;
  }

  async close(): Promise<void> {
    await this.db.close();
    this.initialized = false;
  }

  createSession(params: CreateSessionWithPrompt): Session {
    const session = this.db.createSession({
      id: params.id,
      title: params.title,
      provider: params.provider,
      model: params.model,
    });

    if (params.systemPrompt) {
      this.addMessage(session.id, {
        role: 'system',
        content: params.systemPrompt,
      });
    }

    return session;
  }

  getSession(id: string): Session | null {
    return this.db.getSession(id);
  }

  listSessions(options: ListOptions = {}): Session[] {
    const sessions = this.db.listSessions();
    const { limit, offset = 0 } = options;
    let result = sessions;

    if (offset > 0) {
      result = result.slice(offset);
    }

    if (limit && limit > 0) {
      result = result.slice(0, limit);
    }

    return result;
  }

  deleteSession(id: string): void {
    const session = this.getSession(id);
    if (!session) {
      return;
    }
    this.activeToolCalls.delete(id);
    this.db.deleteSession(id);
  }

  setActiveToolCalls(sessionId: string, calls: ToolCall[]): void {
    this.activeToolCalls.set(sessionId, calls);
  }

  getActiveToolCalls(sessionId: string): ToolCall[] {
    return this.activeToolCalls.get(sessionId) || [];
  }

  clearActiveToolCalls(sessionId: string): void {
    this.activeToolCalls.delete(sessionId);
  }

  addMessage(sessionId: string, message: AddMessageParams): Message {
    // Single-writer contract: this path must durably persist to SQLite before returning.
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const msg = this.db.createMessage({
      session_id: sessionId,
      role: message.role,
      content: message.content,
      metadata: message.metadata,
      idempotency_key: message.idempotencyKey,
    });

    return msg;
  }

  getMessages(sessionId: string, options: ListOptions = {}): Message[] {
    const session = this.getSession(sessionId);
    if (!session) {
      return [];
    }

    const messages = this.db.getMessagesBySession(sessionId);
    const { limit, offset = 0 } = options;
    let result = messages;

    if (offset > 0) {
      result = result.slice(offset);
    }

    if (limit && limit > 0) {
      result = result.slice(0, limit);
    }

    return result;
  }

  getMessagesPaginated(
    sessionId: string,
    limit: number,
    offset: number
  ): {
    messages: Message[];
    hasMore: boolean;
    total: number;
  } {
    const session = this.getSession(sessionId);
    if (!session) {
      return { messages: [], hasMore: false, total: 0 };
    }

    return this.db.getMessagesPaginated(sessionId, limit, offset);
  }

  getMessageByIdempotencyKey(key: string): Message | null {
    return this.db.getMessageByIdempotencyKey(key);
  }

  forkSession(sessionId: string, fromMessageId?: string): Session {
    const originalSession = this.getSession(sessionId);
    if (!originalSession) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const forkedSession = this.db.createSession({
      title: `${originalSession.title} (Fork)`,
      provider: originalSession.provider,
      model: originalSession.model,
    });

    let messagesToCopy = this.db.getMessagesBySession(sessionId);

    if (fromMessageId) {
      const fromMessage = messagesToCopy.find((m) => m.id === fromMessageId);
      if (!fromMessage) {
        throw new Error(`Message ${fromMessageId} not found in session`);
      }
      const fromIndex = messagesToCopy.findIndex((m) => m.id === fromMessageId);
      messagesToCopy = messagesToCopy.slice(fromIndex);
    }

    for (const message of messagesToCopy) {
      this.db.createMessage({
        session_id: forkedSession.id,
        role: message.role,
        content: message.content,
        metadata: message.metadata || undefined,
      });
    }

    return forkedSession;
  }

  getSessionStateDAO() {
    return this.db.getSessionStateDAO();
  }

  async createSessionState(params: CreateSessionStateParams): Promise<void> {
    return this.db.getSessionStateDAO().create(params);
  }

  async getSessionState(sessionId: string): Promise<SessionState | null> {
    return this.db.getSessionStateDAO().get(sessionId);
  }

  async updateSessionState(
    sessionId: string,
    params: UpdateSessionStateParams,
    expectedVersion?: number
  ): Promise<void> {
    return this.db.getSessionStateDAO().update(sessionId, params, expectedVersion);
  }

  async getSessionStatus(sessionId: string): Promise<string | null> {
    return this.db.getSessionStateDAO().getStatus(sessionId);
  }

  async updateSessionStatus(
    sessionId: string,
    status: SessionState['status'],
    agentState?: SessionState['agentState']
  ): Promise<void> {
    return this.db.getSessionStateDAO().updateStatus(sessionId, status, agentState);
  }

  async getActiveSessions(): Promise<SessionState[]> {
    return this.db.getSessionStateDAO().getActiveSessions();
  }

  async getSessionsByStatus(status: SessionState['status']): Promise<SessionState[]> {
    return this.db.getSessionStateDAO().getSessionsByStatus(status);
  }

  updateSessionTitle(id: string, title: string): Session | null {
    return this.db.updateSession(id, { title });
  }

  updateSession(id: string, params: UpdateSessionParams): Session | null {
    return this.db.updateSession(id, params);
  }
}

export { ConversationManager };
export type { ListOptions, CreateSessionWithPrompt, AddMessageParams };
