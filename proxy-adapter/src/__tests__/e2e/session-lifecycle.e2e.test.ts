/**
 * Session Lifecycle E2E Tests (Chat Session Independence)
 *
 * Covers:
 * 1) Session state transitions (idle -> running -> idle/completed)
 * 2) WebSocket channel separation (/ws/chat vs /ws/debug)
 * 3) Lazy loading API pagination (/api/chat/sessions/:id/messages)
 * 4) Session activation logic (manual activation + optimistic lock conflicts)
 * 5) Job queue integration (session-job association)
 * 6) Auto-activation on message send
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { DebugWebSocketManager, cleanupPersistence as cleanupDebugWsPersistence } from '../../websocket-manager.js';
import {
  ChatWebSocketManager,
  cleanupPersistence as cleanupChatWsPersistence,
} from '../../chat-websocket-manager.js';
import { ConversationManager } from '../../conversation/manager.js';
import { ChatHandler } from '../../conversation/chat-handler.js';
import { ChatSessionController } from '../../services/chat-session-controller.js';
import { DatabaseManager } from '../../conversation/db.js';
import { OptimisticLockError } from '../../conversation/session-state-dao.js';
import { SessionEventHub } from '../../services/session-event-hub.js';
import chatRoutes from '../../plugins/routes/chat/index.js';
import apiChatRoutes from '../../plugins/routes/api/chat/index.js';
import swaggerPlugin from '../../plugins/02-swagger.plugin.js';
import errorHandler from '../../plugins/03-error-handler.plugin.js';
import type { StreamCallbacks } from '../../clients/decision/stream.js';

// Mock decision client factory (no real AI)
vi.mock('../../clients/decision/index.js', () => ({
  createDecisionClientFactory: () => ({
    create: () => ({
      decideStream: async (_context: unknown, callbacks: StreamCallbacks, signal?: AbortSignal) => {
        if (signal?.aborted) {
          throw new Error('Aborted');
        }

        callbacks.onThinking?.('Processing your request...');

        const tokens = ['Hello', ' ', 'world', '!'];
        for (const token of tokens) {
          if (signal?.aborted) {
            throw new Error('Aborted');
          }
          callbacks.onToken(token);
          await new Promise((resolve) => setTimeout(resolve, 30));
        }

        callbacks.onUsage?.({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
        callbacks.onDone();
      },
    }),
  }),
}));

// Mock browser client (debug WS service status)
vi.mock('../../browser-client.js', () => ({
  browserClient: {
    getStatus: vi.fn().mockResolvedValue({
      isOpen: false,
      status: 'healthy',
    }),
  },
}));

// Mock TaskService for validateProviderModel in create-session route
const { mockGetConfig } = vi.hoisted(() => {
  const mockGetConfig = vi.fn().mockReturnValue({
    providers: {
      'test-provider': {
        name: 'Test Provider',
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://test.example.com',
        mcp: [],
        models: {
          'test-model': {
            type: 'multimodal' as const,
            capabilities: ['vision', 'decision'] as ('vision' | 'decision')[],
          },
        },
      },
    },
  });
  return { mockGetConfig };
});

vi.mock('../../services/index.js', () => ({
  TaskService: {
    getInstance: () => ({
      getConfig: mockGetConfig,
    }),
  },
}));

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const intervalMs = options.intervalMs ?? 50;
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await fn();
    if (predicate(value)) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await delay(intervalMs);
  }
}

function createWsClientWithMessageCapture(url: string): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve, reject) => {
    const messages: any[] = [];
    const ws = new WebSocket(url);
    
    // Start capturing messages immediately
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        // ignore
      }
    });
    
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function collectJsonMessages(ws: WebSocket, durationMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = [];
    const handler = (data: WebSocket.RawData) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        // ignore
      }
    };

    ws.on('message', handler);
    setTimeout(() => {
      ws.off('message', handler);
      resolve(messages);
    }, durationMs);
  });
}

/**
 * Helper to collect SSE events from streaming endpoint
 */
async function collectSSEEvents(
  url: string,
  duration: number,
  abortSignal?: AbortSignal
): Promise<EventSourceMessage[]> {
  const events: EventSourceMessage[] = [];
  const controller = new AbortController();
  const signal = abortSignal ?? controller.signal;
  const timeout = setTimeout(() => controller.abort(), duration);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const cancelReader = () => {
    if (reader) {
      void reader.cancel().catch(() => {});
    }
  };

  try {
    signal.addEventListener('abort', cancelReader, { once: true });

    const response = await fetch(url, {
      signal,
    });

    const parser = createParser({
      onEvent: (event) => {
        events.push(event);
      },
    });

    reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }

    parser.feed(decoder.decode());
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'AbortError') {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancelReader);
    if (reader) {
      await reader.cancel().catch(() => {});
    }
  }

  return events;
}

describe('Session Lifecycle E2E (Chat Session Independence)', () => {
  let app: ReturnType<typeof Fastify>;
  let conversationManager: ConversationManager;
  let sessionController: ChatSessionController;

  let chatWsManager: ChatWebSocketManager;
  let debugWsManager: DebugWebSocketManager;

  let chatWsServer: WebSocketServer;
  let debugWsServer: WebSocketServer;
  let chatWsPort: number;
  let debugWsPort: number;
  let appBaseUrl: string;

  const wsClients: WebSocket[] = [];

  beforeAll(async () => {
    // Reset singleton instances
    SessionEventHub.resetInstance();

    // In-memory DB
    const db = DatabaseManager.getInstance();
    db.initialize(':memory:');

    conversationManager = new ConversationManager();
    sessionController = ChatSessionController.getInstance();
    chatWsManager = ChatWebSocketManager.getInstance();
    debugWsManager = DebugWebSocketManager.getInstance();

    // Fastify app for HTTP endpoints
    app = Fastify({ logger: { level: 'error' } });
    await app.register(cors, { origin: true, credentials: true });
    await app.register(websocket);
    await app.register(swaggerPlugin);
    await app.register(errorHandler);

    app.decorate('conversationManager', conversationManager);

    // Chat handler bound to CHAT websocket manager for independence
    const config = {
      _resolved: {
        providers: {
          'test-provider': {
            apiKey: 'test-key',
            baseUrl: 'https://test.example.com',
            models: ['test-model'],
            enabled: true,
            name: 'Test Provider',
          },
        },
      },
    } as any;

    const chatHandler = new ChatHandler(
      conversationManager,
      config,
      chatWsManager as unknown as DebugWebSocketManager
    );
    chatWsManager.setChatHandler(chatHandler);
    app.decorate('chatHandler', chatHandler);

    // Register HTTP routes
    await app.register(apiChatRoutes, { prefix: '/api/chat' });

    await app.ready();

    // Start app on a port for SSE testing
    await app.listen({ port: 0, host: '127.0.0.1' });
    const appPort = (app.server.address() as { port: number }).port;
    appBaseUrl = `http://127.0.0.1:${appPort}`;

    // Standalone WS servers (simulate /ws/chat and /ws/debug)
    chatWsServer = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => chatWsServer.once('listening', () => resolve()));
    chatWsPort = (chatWsServer.address() as any).port;
    chatWsServer.on('connection', (ws) => {
      const clientId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      (ws as any).clientId = clientId;
      chatWsManager.handleConnection(ws, clientId);
    });

    debugWsServer = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => debugWsServer.once('listening', () => resolve()));
    debugWsPort = (debugWsServer.address() as any).port;
    debugWsServer.on('connection', (ws) => {
      const clientId = `debug-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      (ws as any).clientId = clientId;
      debugWsManager.handleConnection(ws, clientId);
    });
  });

  afterAll(async () => {
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }

    if (chatWsServer) {
      await new Promise<void>((resolve) => chatWsServer.close(() => resolve()));
    }
    if (debugWsServer) {
      await new Promise<void>((resolve) => debugWsServer.close(() => resolve()));
    }

    await app.close();

    cleanupChatWsPersistence();
    cleanupDebugWsPersistence();

    const db = DatabaseManager.getInstance();
    db.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1) should transition session states (idle -> running -> idle/completed)', async () => {
    const session = conversationManager.createSession({
      title: 'Lifecycle State Test',
      provider: 'test-provider',
      model: 'test-model',
    });

    const dao = conversationManager.getSessionStateDAO();
    const initial = await dao.get(session.id);
    expect(initial?.status).toBe('idle');

    // Auto-activation on message send (via job queue route)
    const sendResponse = await app.inject({
      method: 'POST',
      url: '/api/chat/message',
      payload: { sessionId: session.id, message: 'Hello' },
    });

    expect(sendResponse.statusCode).toBe(200);
    const sendBody = JSON.parse(sendResponse.payload);
    expect(sendBody.jobId).toBeDefined();
    expect(sendBody.status).toBe('queued');

    // Job queue drives sessions_state: running -> completed
    await waitFor(
      async () => dao.get(session.id),
      (state) => state?.status === 'running',
      { timeoutMs: 4000 }
    );

    const completed = await waitFor(
      async () => dao.get(session.id),
      (state) => state?.status === 'completed',
      { timeoutMs: 4000 }
    );
    expect(completed?.jobId).toBe(sendBody.jobId);

    // Manual deactivate brings it back to idle (manager-level)
    await conversationManager.activateSession(session.id);
    expect(await conversationManager.getSessionStatus(session.id)).toBe('running');
    await conversationManager.deactivateSession(session.id);
    expect(await conversationManager.getSessionStatus(session.id)).toBe('idle');
  });

  it('1b) should resume a blocked session by producing new assistant events instead of only flipping status', async () => {
    const session = conversationManager.createSession({
      title: 'Blocked Resume',
      provider: 'test-provider',
      model: 'test-model',
    });

    await conversationManager.createSessionState({
      sessionId: session.id,
      status: 'blocked',
      agentState: {
        schema_version: 1,
        blockReason: 'api_error',
        waitingFor: 'api_retry',
      },
    });
    conversationManager.addMessage(session.id, {
      role: 'user',
      content: 'Resume after recovery.',
    });

    const sseUrl = `${appBaseUrl}/api/chat/sessions/${session.id}/stream`;
    const eventsPromise = collectSSEEvents(sseUrl, 1500);
    await delay(100);

    const resumeResponse = await fetch(`${appBaseUrl}/api/chat/sessions/${session.id}/resume`, {
      method: 'POST',
    });

    expect(resumeResponse.status).toBe(200);
    expect(await resumeResponse.json()).toEqual({ success: true });

    const events = await eventsPromise;
    expect(events.some((event) => event.event === 'assistant.started')).toBe(true);
    expect(events.some((event) => event.event === 'assistant.completed')).toBe(true);
    expect(sessionController.getStatus(session.id).status).not.toBe('blocked');
  });

  it('1c) should expose runtime recovery state on the status endpoint', async () => {
    const session = conversationManager.createSession({
      title: 'Status Runtime State',
      provider: 'test-provider',
      model: 'test-model',
    });

    await conversationManager.createSessionState({
      sessionId: session.id,
      status: 'blocked',
      jobId: 'job-status-123',
      agentState: {
        schema_version: 1,
        blockReason: 'api_error',
        waitingFor: 'api_retry',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/chat/sessions/${session.id}/status`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('blocked');
    expect(body.jobId).toBe('job-status-123');
    expect(body.agentState).toMatchObject({
      blockReason: 'api_error',
      waitingFor: 'api_retry',
    });
  });

  it('2) should keep SSE streaming separate from debug WebSocket', async () => {
    const session = conversationManager.createSession({
      title: 'WS Separation',
      provider: 'test-provider',
      model: 'test-model',
    });

    // Create debug WebSocket client
    const debugClient = await createWsClientWithMessageCapture(`ws://localhost:${debugWsPort}`);
    wsClients.push(debugClient.ws);

    // Debug WS should receive service_status
    await waitFor(
      () => debugClient.messages,
      (msgs) => msgs.some((m) => m.type === 'service_status'),
      { timeoutMs: 1500, intervalMs: 50 }
    );

    // Start SSE connection for chat streaming
    const sseUrl = `${appBaseUrl}/api/chat/sessions/${session.id}/stream`;
    const eventsPromise = collectSSEEvents(sseUrl, 3000);

    await delay(100);

    // Send message via POST endpoint
    await fetch(`${appBaseUrl}/api/chat/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'SSE hello' }),
    });

    // Wait for SSE events
    const sseEvents = await eventsPromise;

    // SSE should receive assistant events
    expect(sseEvents.some((e) => e.event === 'assistant.delta' || e.event === 'assistant.completed')).toBe(true);

    // Debug WebSocket should not receive chat stream events (they go through SSE)
    const debugMsgs = debugClient.messages;
    expect(debugMsgs.some((m) => String(m.type).startsWith('chat_stream_'))).toBe(false);
  });

  it('3) should lazy-load messages with pagination (cursor-like offset + limit)', async () => {
    const session = conversationManager.createSession({
      title: 'Pagination',
      provider: 'test-provider',
      model: 'test-model',
    });

    for (let i = 0; i < 120; i++) {
      conversationManager.addMessage(session.id, {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `msg-${i}`,
      });
    }

    const page1 = await app.inject({
      method: 'GET',
      url: `/api/chat/sessions/${session.id}/messages?limit=20&offset=0`,
    });
    expect(page1.statusCode).toBe(200);
    const body1 = JSON.parse(page1.payload);
    expect(body1).toHaveLength(20);

    const page2 = await app.inject({
      method: 'GET',
      url: `/api/chat/sessions/${session.id}/messages?limit=20&offset=20`,
    });
    expect(page2.statusCode).toBe(200);
    const body2 = JSON.parse(page2.payload);
    expect(body2).toHaveLength(20);

    const ids1 = new Set(body1.map((m: any) => m.id));
    const overlap = body2.some((m: any) => ids1.has(m.id));
    expect(overlap).toBe(false);
  });

  it('4) should support manual activation and reject optimistic-lock version conflicts', async () => {
    const session = conversationManager.createSession({
      title: 'Activation',
      provider: 'test-provider',
      model: 'test-model',
    });
    conversationManager.addMessage(session.id, { role: 'user', content: 'seed' });

    const dao = conversationManager.getSessionStateDAO();
    const before = await dao.get(session.id);
    expect(before?.status).toBe('idle');

    const context = await conversationManager.activateSession(session.id);
    expect(await conversationManager.getSessionStatus(session.id)).toBe('running');
    expect(context.messages.length).toBeGreaterThan(0);

    const stateAfterActivate = await dao.get(session.id);
    await expect(
      dao.update(session.id, { status: 'running' }, (stateAfterActivate?.version || 1) + 123)
    ).rejects.toThrow(OptimisticLockError);
  });

  it('5) should associate enqueued jobId onto session state', async () => {
    const session = conversationManager.createSession({
      title: 'Job Association',
      provider: 'test-provider',
      model: 'test-model',
    });

    const dao = conversationManager.getSessionStateDAO();
    await dao.get(session.id);

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/message',
      payload: { sessionId: session.id, message: 'queue me' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(typeof body.jobId).toBe('string');

    const state = await waitFor(
      async () => dao.get(session.id),
      (s) => s?.jobId === body.jobId && (s?.status === 'running' || s?.status === 'completed'),
      { timeoutMs: 4000 }
    );

    expect(state?.jobId).toBe(body.jobId);
  });

  describe('POST /api/chat/sessions (E2E contract validation)', () => {
    it('should create session via HTTP and continue through message chain', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: { provider: 'test-provider', model: 'test-model' },
      });

      expect(createRes.statusCode).toBe(201);
      const createBody = JSON.parse(createRes.payload);
      expect(createBody.success).toBe(true);
      expect(createBody.session).toBeDefined();
      expect(createBody.session.id).toBeDefined();
      expect(createBody.session.provider).toBe('test-provider');
      expect(createBody.session.model).toBe('test-model');
      expect(createBody.session.status).toBe('idle');

      // Continue through message chain
      const msgRes = await app.inject({
        method: 'POST',
        url: '/api/chat/message',
        payload: { sessionId: createBody.session.id, message: 'Hello E2E contract' },
      });

      expect(msgRes.statusCode).toBe(200);
      const msgBody = JSON.parse(msgRes.payload);
      expect(msgBody.jobId).toBeDefined();
      expect(msgBody.status).toBe('queued');
    });

    it('should reject missing provider with 400 and not persist session', async () => {
      const beforeCount = conversationManager.listSessions().length;

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: { model: 'test-model' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(typeof body.error).toBe('string');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();

      expect(conversationManager.listSessions().length).toBe(beforeCount);
    });

    it('should reject missing model with 400 and not persist session', async () => {
      const beforeCount = conversationManager.listSessions().length;

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: { provider: 'test-provider' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(typeof body.error).toBe('string');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();

      expect(conversationManager.listSessions().length).toBe(beforeCount);
    });

    it('should reject unknown provider with 400 and not persist session', async () => {
      const beforeCount = conversationManager.listSessions().length;

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: { provider: 'no-such-provider', model: 'test-model' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toContain('not found');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();

      expect(conversationManager.listSessions().length).toBe(beforeCount);
    });

    it('should reject unknown model with 400 and not persist session', async () => {
      const beforeCount = conversationManager.listSessions().length;

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: { provider: 'test-provider', model: 'no-such-model' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toContain('not found');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();

      expect(conversationManager.listSessions().length).toBe(beforeCount);
    });
  });
});
