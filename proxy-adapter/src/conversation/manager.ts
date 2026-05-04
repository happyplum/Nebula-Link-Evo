import { DatabaseManager } from './db.js';
import { SessionCompressor } from './compressor.js';
import { createWorkerLogger } from '../services/logger.js';
import type {
  Session,
  Message,
  CreateSessionParams,
  MessageRole,
  SessionState,
  CreateSessionStateParams,
  UpdateSessionStateParams,
} from './types.js';
import type { AIClient as CompressorAIClient } from './compressor.js';
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

interface ContextWindow {
  summary: string | null;
  messages: Message[];
}

interface ActivationOptions {
  maxMessages?: number;
  compactIfOver?: number;
}

class ConversationManager {
  private db: DatabaseManager;
  private initialized = false;
  private compressor: SessionCompressor;
  private aiClient: CompressorAIClient | null = null;
  private logger = createWorkerLogger('conversation-manager');
  private activeToolCalls = new Map<string, ToolCall[]>();

  constructor(dbPath: string = ':memory:') {
    this.db = DatabaseManager.getInstance();
    this.initialize(dbPath);
    this.compressor = new SessionCompressor(this.db);
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
      vision_provider: params.vision_provider,
      vision_model: params.vision_model,
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

    this.triggerCompressionIfNeeded(sessionId).catch(() => {});

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

  getMessagesPaginated(sessionId: string, limit: number, offset: number): {
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

  getContextWindow(sessionId: string): ContextWindow {
    const session = this.getSession(sessionId);
    if (!session) {
      return { summary: null, messages: [] };
    }

    const context = this.resolveContextWindow(sessionId);
    return {
      summary: context.summary,
      messages: context.messages,
    };
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
      vision_provider: originalSession.vision_provider ?? undefined,
      vision_model: originalSession.vision_model ?? undefined,
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

  updateSession(id: string, params: import('./types.js').UpdateSessionParams): Session | null {
    return this.db.updateSession(id, params);
  }

  setAiClient(client: CompressorAIClient): void {
    this.aiClient = client;
  }

  async activateSession(sessionId: string, options: ActivationOptions = {}): Promise<ContextWindow> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const resolved = {
      maxMessages: options.maxMessages ?? 500,
      compactIfOver: options.compactIfOver ?? 1000,
    };

    // Ensure sessions_state row exists (lazy init)
    const sessionState = await this.getSessionState(sessionId);
    const currentStatus = sessionState?.status ?? 'idle';

    if (currentStatus === 'idle' || currentStatus === 'completed') {
      await this.updateSessionStatus(sessionId, 'running', sessionState?.agentState);
      // Keep legacy sessions.status in sync
      this.db.activateSession(sessionId);
    } else if (currentStatus !== 'running') {
      throw new Error(`Cannot activate session with status: ${currentStatus}`);
    }

    let messages = this.db.getMessagesBySession(sessionId);

    if (messages.length > resolved.compactIfOver && this.aiClient) {
      await this.compressor.compress(sessionId, this.aiClient);
      messages = this.db.getMessagesBySession(sessionId);
    }

    let context = this.resolveContextWindow(sessionId);

    if (resolved.maxMessages > 0 && context.messages.length > resolved.maxMessages) {
      context = {
        ...context,
        messages: context.messages.slice(-resolved.maxMessages),
      };
    }

    return context;
  }

  async deactivateSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const sessionState = await this.getSessionState(sessionId);
    const currentStatus = sessionState?.status ?? 'idle';

    if (currentStatus === 'running') {
      await this.updateSessionStatus(sessionId, 'idle', sessionState?.agentState);
      // Keep legacy sessions.status in sync
      this.db.updateSessionStatus(sessionId, 'idle');
      return;
    }

    if (currentStatus === 'idle') {
      return;
    }

    throw new Error(`Cannot deactivate session with status: ${currentStatus}`);
  }

  async isSessionActive(sessionId: string): Promise<boolean> {
    const sessionState = await this.getSessionState(sessionId);
    return sessionState?.status === 'running';
  }

  private async triggerCompressionIfNeeded(sessionId: string): Promise<void> {
    if (!this.aiClient) {
      return;
    }
    if (this.compressor.shouldCompress(sessionId)) {
      try {
        await this.compressor.compress(sessionId, this.aiClient);
      } catch (error) {
        this.logger.error({ err: error, sessionId }, 'Compression failed');
      }
    }
  }

  private resolveContextWindow(sessionId: string): ContextWindow {
    const compressedContext = this.compressor.getCompressedContext(sessionId);
    if (compressedContext.summary !== null) {
      return compressedContext;
    }

    return {
      summary: null,
      messages: this.db.getMessagesBySession(sessionId),
    };
  }
}

export { ConversationManager };
export type { ListOptions, CreateSessionWithPrompt, AddMessageParams, ContextWindow, ActivationOptions };
