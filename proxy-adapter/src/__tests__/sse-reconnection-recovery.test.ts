import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import http from 'node:http';
import { ConversationManager } from '../conversation/manager.js';
import { ChatHandler } from '../conversation/chat-handler.js';
import { DatabaseManager } from '../conversation/db.js';
import { DebugWebSocketManager } from '../websocket-manager.js';
import { SessionEventHub } from '../services/session-event-hub.js';
import { SessionLock } from '../services/session-lock.js';
import type { DecisionClient } from '../clients/types.js';
type StreamCallbacks = {
  onToken: (text: string) => void;
  onThinking: (text: string) => void;
  onDone: () => Promise<void>;
};
import type { ResolvedConfig } from '../config/schema.js';
import apiChatRoutes from '../plugins/routes/api/chat/index.js';
import errorHandler from '../plugins/03-error-handler.plugin.js';
import swaggerPlugin from '../plugins/02-swagger.plugin.js';
import type { SessionEvent } from '../../../shared/types/sse-events.js';

/**
 * Test suite for SSE reconnection event recovery.
 *
 * These tests verify that `/api/chat/:id/stream` endpoint correctly recovers
 * missed events after reconnection using `lastEventId` query param or `Last-Event-ID` header.
 *
 * Key scenarios:
 * - Reconnecting after disconnect should replay only events with seq > lastEventId
 * - Fresh connection without lastEventId receives snapshot + running events
 * - Page refresh scenario preserves AI response events
 * - ChatHandler without explicit DAO/Hub injection still supports reconnection recovery
 */

interface ParsedSSEEvent {
  event: string;
  id?: string;
  data: string;
}

interface SSECollectResult {
  statusCode: number;
  headers: Record<string, string>;
  events: ParsedSSEEvent[];
}

const mockConfig: ResolvedConfig = {
  _resolved: {
    providers: {
      kimi: {
        apiKey: 'test-key',
        baseUrl: 'https://api.moonshot.cn/v1',
        models: {
          'moonshot-v1-vision-preview': {
            type: 'vision',
            capabilities: ['vision', 'decision'],
            temperature: 0.4,
            maxTokens: 2000,
          },
        },
      },
    },
  },
  version: '1.0',
  providers: {},
  mcp: { enabled: false, servers: {} },
  defaults: {
    vision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
    decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
  },
} as unknown as ResolvedConfig;

async function collectSSEEvents(
  url: string,
  options: {
    timeoutMs?: number;
    maxEvents?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<SSECollectResult> {
  const { timeoutMs = 3000, maxEvents = 1, headers: requestHeaders } = options;

  return new Promise((resolve, reject) => {
    const events: ParsedSSEEvent[] = [];
    const responseHeaders: Record<string, string> = {};
    let buffer = '';
    let currentEvent: ParsedSSEEvent | null = null;
    let statusCode = 0;
    let settled = false;
    let responseClosed = false;

    const finalize = (req: http.ClientRequest) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (!responseClosed) {
        req.destroy();
      }
      resolve({
        statusCode,
        headers: responseHeaders,
        events,
      });
    };

    const req = http.request(url, { method: 'GET', headers: requestHeaders }, (res) => {
      statusCode = res.statusCode ?? 0;

      for (const [key, value] of Object.entries(res.headers)) {
        if (typeof value === 'string') {
          responseHeaders[key] = value;
        } else if (Array.isArray(value)) {
          responseHeaders[key] = value.join(', ');
        }
      }

      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith(':')) {
            continue;
          }

          if (line.startsWith('event:')) {
            if (currentEvent) {
              events.push(currentEvent);
              currentEvent = null;
              if (events.length >= maxEvents) {
                finalize(req);
                return;
              }
            }
            currentEvent = { event: line.slice(6).trim(), data: '' };
            continue;
          }

          if (line.startsWith('id:')) {
            if (currentEvent) {
              currentEvent.id = line.slice(3).trim();
            }
            continue;
          }

          if (line.startsWith('data:')) {
            if (currentEvent) {
              currentEvent.data += line.slice(5).trim();
            }
            continue;
          }

          if (line.trim() === '' && currentEvent) {
            events.push(currentEvent);
            currentEvent = null;
            if (events.length >= maxEvents) {
              finalize(req);
              return;
            }
          }
        }
      });

      res.on('close', () => {
        responseClosed = true;
        if (currentEvent) {
          events.push(currentEvent);
        }
        finalize(req);
      });

      res.on('error', (error) => {
        responseClosed = true;
        if (!settled) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      if (!settled) {
        reject(error);
      }
    });

    const timer = setTimeout(() => finalize(req), timeoutMs);
    req.end();
  });
}

function parseEventData(event: ParsedSSEEvent): Record<string, unknown> {
  return JSON.parse(event.data) as Record<string, unknown>;
}

async function postMessage(baseUrl: string, sessionId: string, content: string): Promise<Response> {
  return fetch(`${baseUrl}/api/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
}

async function waitForEventPersistence(sessionId: string, minEvents: number): Promise<void> {
  const db = DatabaseManager.getInstance();
  const dao = db.getSessionEventsDAO();
  const deadline = Date.now() + 3000;

  while (Date.now() < deadline) {
    await dao.flush();
    const events = await dao.getEventsAfter(sessionId, 0, 100);
    if (events.length >= minEvents) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  throw new Error(`Timed out waiting for ${minEvents} persisted events for session ${sessionId}`);
}

describe('SSE Reconnection Event Recovery', () => {
  let app: ReturnType<typeof Fastify>;
  let server: http.Server;
  let baseUrl: string;
  let manager: ConversationManager;
  let chatHandler: ChatHandler;
  let mockDecisionClient: DecisionClient;
  let sessionEventHub: SessionEventHub;
  let sessionEventsDAO: ReturnType<DatabaseManager['getSessionEventsDAO']>;

  beforeEach(async () => {
    DatabaseManager.resetInstance();
    SessionEventHub.resetInstance();
    SessionLock.getInstance().clear();

    manager = new ConversationManager(':memory:');
    sessionEventHub = SessionEventHub.getInstance();

    mockDecisionClient = {
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
      decide: vi.fn(),
      decideStream: vi.fn().mockImplementation(async (_context, callbacks: StreamCallbacks) => {
        callbacks.onThinking('thinking...');
        callbacks.onToken('Test response');
        await callbacks.onDone();
      }),
    } as unknown as DecisionClient;

    const db = DatabaseManager.getInstance();
    sessionEventsDAO = db.getSessionEventsDAO();
    const wsManager = DebugWebSocketManager.getInstance();

    chatHandler = new ChatHandler(
      manager,
      mockConfig,
      wsManager,
      undefined,
      sessionEventsDAO,
      sessionEventHub
    );

    vi.spyOn(chatHandler as unknown as { resolveDecisionModel: () => DecisionClient }, 'resolveDecisionModel')
      .mockReturnValue(mockDecisionClient);

    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    app.register(swaggerPlugin);
    app.register(errorHandler);
    app.decorate('conversationManager', manager);
    app.decorate('chatHandler', chatHandler);
    app.register(apiChatRoutes, { prefix: '/api/chat' });
    await app.ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    server = app.server;

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve server address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    try {
      const dao = DatabaseManager.getInstance().getSessionEventsDAO();
      await dao.flush();
      dao.dispose();
    } catch {
      // no-op
    }

    await app.close();
    await manager.close();
    SessionLock.getInstance().clear();
    SessionEventHub.resetInstance();
    DatabaseManager.resetInstance();
    vi.restoreAllMocks();
  });

  it('Test 1: SSE reconnection recovers missed events', async () => {
    const session = manager.createSession({
      title: 'Recovery Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    // Start SSE connection first, then send message
    const ssePromise = collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
      maxEvents: 6,
      timeoutMs: 2500,
    });

    // Send message which triggers AI response
    const response = await postMessage(baseUrl, session.id, 'test message for recovery');
    expect(response.status).toBe(202);

    // Wait for all events to be received
    const firstStream = await ssePromise;

    expect(firstStream.statusCode).toBe(200);

    const eventTypes = firstStream.events.map((event) => event.event);
    expect(eventTypes[0]).toBe('session.snapshot');
    expect(eventTypes).toContain('message.created');
    expect(eventTypes).toContain('assistant.started');
    expect(eventTypes).toContain('assistant.completed');

    // Find the seq of assistant.completed event
    const completedEvents = firstStream.events.filter((event) => event.event === 'assistant.completed');
    expect(completedEvents.length).toBeGreaterThan(0);

    const lastEventId = completedEvents[0]?.id;
    expect(lastEventId).toBeDefined();

    // Verify persistence: check that we can replay from earlier seq
    const eventsFromDb = await sessionEventsDAO.getEventsAfter(session.id, 0, 100);
    const assistantStartedEvents = eventsFromDb.filter((e) => e.type === 'assistant.started');
    expect(assistantStartedEvents.length).toBeGreaterThan(0);

    const startedSeq = assistantStartedEvents[0]?.seq;
    expect(startedSeq).toBeDefined();

    // Now reconnect from before assistant.started to verify we can recover events
    const earlyReplayStream = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream?lastEventId=${startedSeq! - 1}`,
      {
        maxEvents: 4,
        timeoutMs: 2000,
      }
    );

    expect(earlyReplayStream.statusCode).toBe(200);
    const earlyReplayTypes = earlyReplayStream.events.map((event) => event.event);
    expect(earlyReplayTypes).toContain('assistant.started');
    expect(earlyReplayTypes).toContain('assistant.completed');
    expect(earlyReplayTypes).not.toContain('session.snapshot');
  });

  it('Test 2: Fresh connection receives snapshot', async () => {
    const session = manager.createSession({
      title: 'Snapshot Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    // Add some existing messages
    manager.addMessage(session.id, { role: 'user', content: 'First message' });
    manager.addMessage(session.id, { role: 'assistant', content: 'First response' });

    // Connect without lastEventId
    const freshStream = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream`,
      {
        maxEvents: 1,
        timeoutMs: 2000,
      }
    );

    expect(freshStream.statusCode).toBe(200);

    // First event should be session.snapshot
    expect(freshStream.events[0]?.event).toBe('session.snapshot');
    expect(freshStream.events[0]?.id).toBe('0');

    const snapshotPayload = parseEventData(freshStream.events[0]!);
    expect(snapshotPayload.sessionId).toBe(session.id);
    expect(snapshotPayload.messages).toBeDefined();
    expect(Array.isArray(snapshotPayload.messages)).toBe(true);
    expect((snapshotPayload.messages as unknown[]).length).toBe(2);

    // Now test with a running session that has persisted events
    const runningSession = manager.createSession({
      title: 'Running Session Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    await manager.createSessionState({
      sessionId: runningSession.id,
      status: 'running',
    });

    // Persist some events
    await sessionEventsDAO.appendEvent(runningSession.id, 'assistant.started', {
      messageId: 'msg-assistant-1',
    });
    await sessionEventsDAO.appendEvent(runningSession.id, 'assistant.delta', {
      messageId: 'msg-assistant-1',
      text: 'Working...',
    });
    await sessionEventsDAO.flush();

    // Fresh connection should get snapshot + persisted events
    const freshStreamWithRunning = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${runningSession.id}/stream`,
      {
        maxEvents: 4,
        timeoutMs: 4000,
      }
    );

    expect(freshStreamWithRunning.statusCode).toBe(200);
    const eventTypes = freshStreamWithRunning.events.map((event) => event.event);
    expect(eventTypes[0]).toBe('session.snapshot');
    expect(eventTypes).toContain('assistant.started');
    expect(eventTypes).toContain('assistant.delta');
  });

  it('Test 3: Reconnection after page refresh scenario', async () => {
    const session = manager.createSession({
      title: 'Page Refresh Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    // User sends message
    const userResponse = await postMessage(baseUrl, session.id, 'Navigate to example.com');
    expect(userResponse.status).toBe(202);

    // Wait for message.created event and AI response events
    await waitForEventPersistence(session.id, 4);

    // Simulate user sees message.created event (seq 1) then page refreshes
    const firstStream = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream`,
      {
        maxEvents: 2,
        timeoutMs: 4000,
      }
    );

    expect(firstStream.statusCode).toBe(200);
    expect(firstStream.events[0]?.event).toBe('session.snapshot');
    expect(firstStream.events[1]?.event).toBe('message.created');

    const lastSeenEventId = firstStream.events[1]?.id;
    expect(lastSeenEventId).toBeDefined();

    // Page refresh: reconnect with lastEventId
    // Should recover all AI response events that happened during refresh
    const refreshStream = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream?lastEventId=${lastSeenEventId}`,
      {
        maxEvents: 4,
        timeoutMs: 2500,
      }
    );

    expect(refreshStream.statusCode).toBe(200);

    const refreshTypes = refreshStream.events.map((event) => event.event);

    // Should recover AI events
    expect(refreshTypes).toContain('assistant.started');
    expect(refreshTypes).toContain('assistant.delta');
    expect(refreshTypes).toContain('assistant.completed');

    // Should NOT receive session.snapshot on reconnect
    expect(refreshTypes).not.toContain('session.snapshot');

    // Verify messages array in snapshot includes user message
    // Get fresh snapshot by connecting without lastEventId
    const freshSnapshotStream = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream`,
      {
        maxEvents: 1,
        timeoutMs: 2000,
      }
    );

    const snapshotPayload = parseEventData(freshSnapshotStream.events[0]!);
    const messages = snapshotPayload.messages as unknown[];
    expect(messages.length).toBeGreaterThanOrEqual(1);

    // Find user message
    const userMessage = messages.find(
      (msg) => typeof msg === 'object' && msg !== null && (msg as Record<string, unknown>).role === 'user'
    );
    expect(userMessage).toBeDefined();
    expect((userMessage as Record<string, unknown>).content).toBe('Navigate to example.com');

    // Verify AI response events exist in persisted storage
    const allEvents = await sessionEventsDAO.getEventsAfter(session.id, 0, 100);
    const aiEvents = allEvents.filter((e) =>
      e.type.startsWith('assistant.')
    );
    expect(aiEvents.length).toBeGreaterThanOrEqual(3);
    expect(aiEvents.some((e) => e.type === 'assistant.started')).toBe(true);
    expect(aiEvents.some((e) => e.type === 'assistant.delta')).toBe(true);
    expect(aiEvents.some((e) => e.type === 'assistant.completed')).toBe(true);
  });

  it('Test 4: Reconnect replays >100 persisted events without loss or duplicate seq', { timeout: 15000 }, async () => {
    const session = manager.createSession({
      title: 'Large Replay Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const pendingWrites: Array<Promise<number>> = [];
    pendingWrites.push(sessionEventsDAO.appendEvent(session.id, 'assistant.started', {
      messageId: 'msg-assistant-large',
    }));

    const replayDeltaCount = 150;
    for (let i = 0; i < replayDeltaCount; i++) {
      pendingWrites.push(sessionEventsDAO.appendEvent(session.id, 'assistant.delta', {
        messageId: 'msg-assistant-large',
        text: `chunk-${i}`,
      }));
    }

    pendingWrites.push(sessionEventsDAO.appendEvent(session.id, 'assistant.completed', {
      messageId: 'msg-assistant-large',
    }));
    await Promise.all(pendingWrites);
    await sessionEventsDAO.flush();

    const replayStream = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream?lastEventId=1`,
      {
        maxEvents: replayDeltaCount + 1,
        timeoutMs: 5000,
      }
    );

    expect(replayStream.statusCode).toBe(200);
    expect(replayStream.events.some((event) => event.event === 'session.snapshot')).toBe(false);
    expect(replayStream.events.length).toBe(replayDeltaCount + 1);

    const replaySeqs = replayStream.events
      .map((event) => Number.parseInt(event.id ?? '', 10))
      .filter((seq) => Number.isFinite(seq));

    expect(replaySeqs.length).toBe(replayDeltaCount + 1);
    expect(new Set(replaySeqs).size).toBe(replaySeqs.length);
    expect(replaySeqs[0]).toBe(2);
    expect(replaySeqs.at(-1)).toBe(replayDeltaCount + 2);

    for (let index = 0; index < replaySeqs.length; index++) {
      expect(replaySeqs[index]).toBe(index + 2);
    }
  });

  it('Test 5: ChatHandler without显式DAO注入仍可回放重连事件', { timeout: 10000 }, async () => {
    const buggyChatHandler = new ChatHandler(
      manager,
      mockConfig,
      DebugWebSocketManager.getInstance(),
      undefined,
      undefined,
      sessionEventHub
    );

    vi.spyOn(
      buggyChatHandler as unknown as { resolveDecisionModel: () => DecisionClient },
      'resolveDecisionModel'
    ).mockReturnValue(mockDecisionClient);

    // Register a new route with buggy handler
    const buggyApp = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    buggyApp.register(swaggerPlugin);
    buggyApp.register(errorHandler);
    buggyApp.decorate('conversationManager', manager);
    buggyApp.decorate('chatHandler', buggyChatHandler);
    buggyApp.register(apiChatRoutes, { prefix: '/api/chat' });
    await buggyApp.ready();
    await buggyApp.listen({ port: 0, host: '127.0.0.1' });

    const buggyServer = buggyApp.server;
    const buggyAddress = buggyServer.address();
    if (!buggyAddress || typeof buggyAddress === 'string') {
      throw new Error('Failed to resolve buggy server address');
    }
    const buggyBaseUrl = `http://127.0.0.1:${buggyAddress.port}`;

    try {
      const session = manager.createSession({
        title: 'No Persistence Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      // Start SSE connection first
      const ssePromise = collectSSEEvents(
        `${buggyBaseUrl}/api/chat/sessions/${session.id}/stream`,
        {
          maxEvents: 2,
          timeoutMs: 8000,
        }
      );

      // Send message
      const response = await fetch(`${buggyBaseUrl}/api/chat/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'test without persistence' }),
      });
      expect(response.status).toBe(202);

      // First connection should work and get snapshot
      const firstStream = await ssePromise;

      expect(firstStream.statusCode).toBe(200);
      expect(firstStream.events[0]?.event).toBe('session.snapshot');

      // Wait a bit for message to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Reconnect with lastEventId=0
      const replayStream = await collectSSEEvents(
        `${buggyBaseUrl}/api/chat/sessions/${session.id}/stream?lastEventId=0`,
        {
          maxEvents: 4,
          timeoutMs: 3000,
        }
      );

      expect(replayStream.statusCode).toBe(200);

      const replayTypes = replayStream.events.map((event) => event.event);
      const hasAssistantEvents = replayTypes.some(type => type.startsWith('assistant.'));
      expect(hasAssistantEvents).toBe(true);

      const allEvents = await sessionEventsDAO.getEventsAfter(session.id, 0, 100);
      expect(allEvents.some((event) => event.type === 'assistant.completed')).toBe(true);
    } finally {
      await buggyApp.close();
    }
  });
});
