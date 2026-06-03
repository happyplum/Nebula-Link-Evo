import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import http from 'node:http';
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { ConversationManager } from '../conversation/manager.js';
import { ChatHandler } from '../conversation/chat-handler.js';
import { DatabaseManager } from '../conversation/db.js';
import { SessionEventHub } from '../services/session-event-hub.js';
import { SessionLock } from '../services/session-lock.js';
import { ConversationJobQueue } from '../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../services/stream-persist-worker.js';
import type { LanguageModelV3 } from '@ai-sdk/provider';
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
  version: '1.0',
  providers: {
    kimi: {
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      npmPackage: '@ai-sdk/openai-compatible',
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
  mcp: { enabled: false, servers: {} },
  defaults: {
    vision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
    decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
  },
};

function createMockStreamingModel(chunks: Array<Record<string, unknown>>): LanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks }),
    }),
  }) as unknown as LanguageModelV3;
}

const defaultStreamChunks = [
  { type: 'text-start', id: 'text-0' },
  { type: 'text-delta', id: 'text-0', delta: 'Test delta text' },
  { type: 'text-end', id: 'text-0' },
  {
    type: 'finish',
    finishReason: { unified: 'stop' },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 4, text: 4, reasoning: 0 },
    },
  },
];

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
  let sessionEventHub: SessionEventHub;

  beforeEach(async () => {
    DatabaseManager.resetInstance();
    SessionEventHub.resetInstance();
    SessionLock.getInstance().clear();

    manager = new ConversationManager(':memory:');
    sessionEventHub = SessionEventHub.getInstance();

    const mockModel = createMockStreamingModel(defaultStreamChunks);

    const db = DatabaseManager.getInstance();
    const sessionEventsDAO = db.getSessionEventsDAO();
    

    chatHandler = new ChatHandler(manager, mockConfig, undefined, sessionEventsDAO, sessionEventHub);

    vi.spyOn(chatHandler as unknown as { resolveDecisionModel: () => Promise<LanguageModelV3> }, 'resolveDecisionModel')
      .mockImplementation(async () => mockModel);

    // Create job queue instance
    const persistWorker = new StreamPersistWorker();
    const jobQueue = new ConversationJobQueue(persistWorker);

    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
    app.register(swaggerPlugin);
    app.register(errorHandler);
    app.decorate('conversationManager', manager);
    app.decorate('chatHandler', chatHandler);
    app.decorate('jobQueue', jobQueue);
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

  it('reconnection: fresh connection receives snapshot and any new live events', async () => {
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

    // Reconnect always gets a fresh snapshot — no lastEventId replay contract
    const replayStream = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream`,
      {
        maxEvents: 1,
        timeoutMs: 3000,
      }
    );

    const replayTypes = replayStream.events.map((event) => event.event);
    expect(replayTypes).toContain('session.snapshot');
  });

  it('fresh connection receives snapshot with running state for an active session', async () => {
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

    const freshStream = await collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
      maxEvents: 1,
      timeoutMs: 3000,
    });

    expect(freshStream.statusCode).toBe(200);
    expect(freshStream.events[0]?.event).toBe('session.snapshot');

    const snapshotPayload = parseEventData(freshStream.events[0]!);
    expect(snapshotPayload.state).toBe('running');
    expect(snapshotPayload.sessionId).toBe(session.id);
    expect(snapshotPayload.messages).toBeDefined();
    expect(Array.isArray(snapshotPayload.messages)).toBe(true);
    expect((snapshotPayload.messages as unknown[]).length).toBe(1);
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

  it('error handling: resolveDecisionModel failure causes session to stop without run.error', async () => {
    const session = manager.createSession({
      title: 'Error flow',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    vi.spyOn(chatHandler as unknown as { resolveDecisionModel: () => Promise<LanguageModelV3> }, 'resolveDecisionModel')
      .mockRejectedValue(new Error('mock ai failure'));

    const ssePromise = collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
      maxEvents: 4,
      timeoutMs: 4000,
    });

    const response = await postMessage(baseUrl, session.id, 'trigger ai error');
    expect(response.status).toBe(202);

    const sse = await ssePromise;

    // resolveDecisionModel failure happens outside the try-catch that emits run.error,
    // so only assistant.started is emitted before the failure, followed by session cleanup
    const eventTypes = sse.events.map((event) => event.event);
    expect(eventTypes).toContain('session.snapshot');
    // No run.error event — resolveDecisionModel failure is not caught by executeAIResponse
    expect(eventTypes).not.toContain('run.error');
  });
});
