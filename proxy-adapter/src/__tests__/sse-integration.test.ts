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
import { mockAssistantDeltaEvent } from '../../../shared/test-utils/mocks/sse-event-mocks.js';

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

describe('SSE integration flow', () => {
  let app: ReturnType<typeof Fastify>;
  let server: http.Server;
  let baseUrl: string;
  let manager: ConversationManager;
  let chatHandler: ChatHandler;
  let mockDecisionClient: DecisionClient;
  let sessionEventHub: SessionEventHub;

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
        const delta = mockAssistantDeltaEvent({
          sessionId: 'placeholder',
          messageId: 'placeholder',
          text: 'Test delta text',
        });
        callbacks.onToken(delta.text);
        await callbacks.onDone();
      }),
    } as unknown as DecisionClient;

    const db = DatabaseManager.getInstance();
    const sessionEventsDAO = db.getSessionEventsDAO();
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

  it('full flow: POST message -> SSE receives events -> AI completes', async () => {
    const session = manager.createSession({
      title: 'Full flow',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const ssePromise = collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
      maxEvents: 6,
      timeoutMs: 4000,
    });

    const response = await postMessage(baseUrl, session.id, 'hello from integration');
    expect(response.status).toBe(202);

    const sse = await ssePromise;
    expect(sse.statusCode).toBe(200);

    const eventTypes = sse.events.map((event) => event.event);
    expect(eventTypes[0]).toBe('session.snapshot');
    expect(eventTypes).toContain('assistant.started');
    expect(eventTypes).toContain('assistant.delta');
    expect(eventTypes).toContain('assistant.completed');

    const startedIndex = eventTypes.indexOf('assistant.started');
    const deltaIndex = eventTypes.indexOf('assistant.delta');
    const completedIndex = eventTypes.indexOf('assistant.completed');
    expect(startedIndex).toBeGreaterThanOrEqual(0);
    expect(deltaIndex).toBeGreaterThan(startedIndex);
    expect(completedIndex).toBeGreaterThan(deltaIndex);
  });

  it('reconnection: disconnect and replay events with lastEventId', async () => {
    const session = manager.createSession({
      title: 'Reconnect flow',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const firstStream = await collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
      maxEvents: 1,
      timeoutMs: 4000,
    });
    expect(firstStream.events[0]?.event).toBe('session.snapshot');
    expect(firstStream.events[0]?.id).toBe('0');

    const response = await postMessage(baseUrl, session.id, 'stream and reconnect');
    expect(response.status).toBe(202);

    await waitForEventPersistence(session.id, 4);

    const replayStream = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream?lastEventId=0`,
      {
        maxEvents: 6,
        timeoutMs: 4000,
      }
    );

    const replayTypes = replayStream.events.map((event) => event.event);
    expect(replayTypes).toContain('message.created');
    expect(replayTypes).toContain('assistant.delta');
    expect(replayTypes).toContain('assistant.completed');
    expect(replayTypes).not.toContain('session.snapshot');
  });

  it('fresh connection replays persisted in-flight events for a running session before switching live', async () => {
    const session = manager.createSession({
      title: 'Fresh running replay',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    manager.addMessage(session.id, { role: 'user', content: 'Navigate now' });
    await manager.createSessionState({
      sessionId: session.id,
      status: 'running',
    });

    const sessionEventsDAO = DatabaseManager.getInstance().getSessionEventsDAO();
    await sessionEventsDAO.appendEvent(session.id, 'assistant.started', {
      messageId: 'msg-running-1',
    });
    await sessionEventsDAO.appendEvent(session.id, 'assistant.thinking', {
      messageId: 'msg-running-1',
      text: 'Working through the task',
    });
    await sessionEventsDAO.appendEvent(session.id, 'assistant.delta', {
      messageId: 'msg-running-1',
      text: 'Opening the page',
    });
    await sessionEventsDAO.flush();

    const freshStream = await collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
      maxEvents: 4,
      timeoutMs: 4000,
    });

    expect(freshStream.statusCode).toBe(200);
    expect(freshStream.events[0]?.event).toBe('session.snapshot');

    const snapshotPayload = parseEventData(freshStream.events[0]!);
    expect(snapshotPayload.state).toBe('running');

    const eventTypes = freshStream.events.map((event) => event.event);
    expect(eventTypes).toContain('assistant.started');
    expect(eventTypes).toContain('assistant.thinking');
    expect(eventTypes).toContain('assistant.delta');
  });

  it('concurrent access: two sessions receive independent streams', async () => {
    const sessionA = manager.createSession({
      title: 'Session A',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });
    const sessionB = manager.createSession({
      title: 'Session B',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const streamAPromise = collectSSEEvents(`${baseUrl}/api/chat/sessions/${sessionA.id}/stream`, {
      maxEvents: 5,
      timeoutMs: 4000,
    });
    const streamBPromise = collectSSEEvents(`${baseUrl}/api/chat/sessions/${sessionB.id}/stream`, {
      maxEvents: 5,
      timeoutMs: 4000,
    });

    await Promise.all([
      postMessage(baseUrl, sessionA.id, 'message for A'),
      postMessage(baseUrl, sessionB.id, 'message for B'),
    ]);

    const [streamA, streamB] = await Promise.all([streamAPromise, streamBPromise]);

    const getSessionIds = (events: ParsedSSEEvent[]) =>
      events
        .filter((event) => event.event !== 'session.snapshot')
        .map((event) => parseEventData(event))
        .map((payload) => {
          const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : undefined;
          return sessionId;
        })
        .filter((sessionId): sessionId is string => Boolean(sessionId));

    const sessionIdsA = getSessionIds(streamA.events);
    const sessionIdsB = getSessionIds(streamB.events);

    expect(sessionIdsA.length).toBeGreaterThan(0);
    expect(sessionIdsB.length).toBeGreaterThan(0);
    expect(new Set(sessionIdsA)).toEqual(new Set([sessionA.id]));
    expect(new Set(sessionIdsB)).toEqual(new Set([sessionB.id]));
  });

  it('error handling: AI error emits run.error event', async () => {
    const session = manager.createSession({
      title: 'Error flow',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    vi.spyOn(chatHandler as unknown as { resolveDecisionModel: () => DecisionClient }, 'resolveDecisionModel')
      .mockReturnValue({
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
        decide: vi.fn(),
        decideStream: vi.fn().mockImplementation(async () => {
          throw new Error('mock ai failure');
        }),
      } as unknown as DecisionClient);

    const ssePromise = collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
      maxEvents: 4,
      timeoutMs: 4000,
    });

    const response = await postMessage(baseUrl, session.id, 'trigger ai error');
    expect(response.status).toBe(202);

    const sse = await ssePromise;
    const runErrorEvent = sse.events.find((event) => event.event === 'run.error');
    expect(runErrorEvent).toBeDefined();

    const payload = parseEventData(runErrorEvent!);
    expect(payload.sessionId).toBe(session.id);
    expect(payload.error).toContain('mock ai failure');
  });
});
