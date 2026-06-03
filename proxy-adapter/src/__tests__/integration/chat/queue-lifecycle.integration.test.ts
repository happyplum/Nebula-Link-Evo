import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import http from 'node:http';
import { ConversationManager } from '../../../conversation/manager.js';
import { ChatHandler } from '../../../conversation/chat-handler.js';
import { DatabaseManager } from '../../../conversation/db.js';
import { SessionEventHub } from '../../../services/session-event-hub.js';
import { SessionLock } from '../../../services/session-lock.js';
import { ConversationJobQueue } from '../../../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../../../services/stream-persist-worker.js';
import type { ResolvedConfig } from '../../../config/schema.js';
import apiChatRoutes from '../../../plugins/routes/api/chat/index.js';
import errorHandler from '../../../plugins/03-error-handler.plugin.js';
import swaggerPlugin from '../../../plugins/02-swagger.plugin.js';

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

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

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

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function parseEventData(event: ParsedSSEEvent): Record<string, unknown> {
  return JSON.parse(event.data) as Record<string, unknown>;
}

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
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!responseClosed) {
        req.destroy();
      }
      resolve({ statusCode, headers: responseHeaders, events });
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
          if (line.startsWith(':')) continue;

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

async function postMessage(baseUrl: string, sessionId: string, content: string): Promise<Response> {
  return fetch(`${baseUrl}/api/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 3000,
  intervalMs = 20
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

async function waitForEventTypes(
  seenEventTypes: Set<string>,
  expected: string[],
  timeoutMs = 3000
): Promise<void> {
  await waitForCondition(() => expected.every((type) => seenEventTypes.has(type)), timeoutMs);
}

describe('chat queue lifecycle integration', () => {
  let app: ReturnType<typeof Fastify>;
  let server: http.Server;
  let baseUrl: string;
  let manager: ConversationManager;
  let chatHandler: ChatHandler;
  let sessionEventHub: SessionEventHub;
  let persistWorker: StreamPersistWorker;
  let jobQueue: ConversationJobQueue;
  let handleChatSendMock: ReturnType<typeof vi.spyOn>;
  let queuedExecutions: Array<Deferred<void>>;
  let executeOrder: string[];

  beforeEach(async () => {
    DatabaseManager.resetInstance();
    SessionEventHub.resetInstance();
    SessionLock.getInstance().clear();

    manager = new ConversationManager(':memory:');
    manager.initialize();
    sessionEventHub = SessionEventHub.getInstance();
    persistWorker = new StreamPersistWorker();
    jobQueue = new ConversationJobQueue(persistWorker, sessionEventHub);
    chatHandler = new ChatHandler(manager, mockConfig);
    queuedExecutions = [];
    executeOrder = [];

    handleChatSendMock = vi
      .spyOn(chatHandler, 'handleChatSend')
      .mockImplementation(async (_clientId, params) => {
        executeOrder.push(params.message);
        const deferred = createDeferred<void>();
        queuedExecutions.push(deferred);
        await deferred.promise;
      });

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
    for (const deferred of queuedExecutions) {
      deferred.resolve();
    }

    try {
      const dao = DatabaseManager.getInstance().getSessionEventsDAO();
      await dao.flush();
      dao.dispose();
    } catch {
      // no-op
    }

    await app.close();
    await persistWorker.shutdown();
    await manager.close();
    SessionLock.getInstance().clear();
    SessionEventHub.resetInstance();
    DatabaseManager.resetInstance();
    vi.restoreAllMocks();
  });

  it('场景1：基本排队生命周期会发送 queued -> started -> completed 并在 snapshot 携带 pendingJobs', async () => {
    const session = manager.createSession({
      title: 'queue-lifecycle',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const seenEvents: ParsedSSEEvent[] = [];
    const seenEventTypes = new Set<string>();
    const unsubscribe = sessionEventHub.subscribe(session.id, (event) => {
      seenEvents.push({ event: event.type, id: event.seq !== undefined ? String(event.seq) : undefined, data: JSON.stringify(event) });
      seenEventTypes.add(event.type);
    });

    const response = await postMessage(baseUrl, session.id, 'hello lifecycle');
    expect(response.status).toBe(202);
    const body = (await response.json()) as Record<string, string>;
    expect(body.jobId).toBeDefined();

    await waitForCondition(() => queuedExecutions.length === 1);

    const snapshotBeforeComplete = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream`,
      { maxEvents: 1, timeoutMs: 3000 }
    );
    const snapshotPayload = parseEventData(snapshotBeforeComplete.events[0]!);
    expect(snapshotPayload.pendingJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobId: body.jobId, sessionId: session.id }),
      ])
    );

    queuedExecutions[0].resolve();
    await waitForEventTypes(seenEventTypes, ['job.queued', 'job.started', 'job.completed']);

    unsubscribe();

    expect(
      seenEvents
        .map((event) => event.event)
        .filter((event) => event.startsWith('job.'))
    ).toEqual([
      'job.queued',
      'job.started',
      'job.completed',
    ]);
  });

  it('场景2：排队中的第二个 job 可以取消并发送 job.cancelled 事件', async () => {
    const session = manager.createSession({
      title: 'queue-cancel',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const published: string[] = [];
    const unsubscribe = sessionEventHub.subscribe(session.id, (event) => {
      published.push(event.type);
    });

    const firstResponse = await postMessage(baseUrl, session.id, 'first hold');
    const secondResponse = await postMessage(baseUrl, session.id, 'second queued');
    const firstBody = (await firstResponse.json()) as Record<string, string>;
    const secondBody = (await secondResponse.json()) as Record<string, string>;

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);

    await waitForCondition(() => queuedExecutions.length === 1);
    await waitForCondition(() => jobQueue.getStatus(secondBody.jobId)?.status === 'queued');

    const cancelResponse = await fetch(
      `${baseUrl}/api/chat/sessions/${session.id}/jobs/${secondBody.jobId}`,
      { method: 'DELETE' }
    );
    expect(cancelResponse.status).toBe(200);

    await waitForCondition(() => published.includes('job.cancelled'));
    expect(jobQueue.getStatus(secondBody.jobId)?.status).toBe('cancelled');

    queuedExecutions[0].resolve();
    unsubscribe();
    expect(firstBody.jobId).not.toBe(secondBody.jobId);
  });

  it('场景3：运行中的 job 取消返回 409', async () => {
    const session = manager.createSession({
      title: 'running-cancel',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const response = await postMessage(baseUrl, session.id, 'running now');
    const body = (await response.json()) as Record<string, string>;
    expect(response.status).toBe(202);

    await waitForCondition(() => queuedExecutions.length === 1);
    await waitForCondition(() => jobQueue.getStatus(body.jobId)?.status === 'running');

    const cancelResponse = await fetch(
      `${baseUrl}/api/chat/sessions/${session.id}/jobs/${body.jobId}`,
      { method: 'DELETE' }
    );

    expect(cancelResponse.status).toBe(409);
    const cancelBody = (await cancelResponse.json()) as Record<string, string>;
    expect(cancelBody.error).toContain('already running');

    queuedExecutions[0].resolve();
  });

  it('场景4：SSE 重连后 snapshot 仍能恢复 pendingJobs', async () => {
    const session = manager.createSession({
      title: 'reconnect-pending',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const response = await postMessage(baseUrl, session.id, 'keep pending');
    const body = (await response.json()) as Record<string, string>;
    expect(response.status).toBe(202);

    await waitForCondition(() => queuedExecutions.length === 1);

    const firstSnapshot = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream`,
      { maxEvents: 1, timeoutMs: 3000 }
    );
    const firstPayload = parseEventData(firstSnapshot.events[0]!);
    expect(firstPayload.pendingJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobId: body.jobId, sessionId: session.id }),
      ])
    );

    const secondSnapshot = await collectSSEEvents(
      `${baseUrl}/api/chat/sessions/${session.id}/stream`,
      { maxEvents: 1, timeoutMs: 3000 }
    );
    const secondPayload = parseEventData(secondSnapshot.events[0]!);
    expect(secondPayload.pendingJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobId: body.jobId, sessionId: session.id }),
      ])
    );

    queuedExecutions[0].resolve();
  });

  it('场景5：并发消息会全部 202，并按顺序执行', async () => {
    const session = manager.createSession({
      title: 'parallel-queue',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const [response1, response2, response3] = await Promise.all([
      postMessage(baseUrl, session.id, 'one'),
      postMessage(baseUrl, session.id, 'two'),
      postMessage(baseUrl, session.id, 'three'),
    ]);

    expect(response1.status).toBe(202);
    expect(response2.status).toBe(202);
    expect(response3.status).toBe(202);

    await waitForCondition(() => queuedExecutions.length === 1);
    expect(executeOrder).toEqual(['one']);

    queuedExecutions.shift()?.resolve();
    await waitForCondition(() => executeOrder.length === 2);
    expect(executeOrder).toEqual(['one', 'two']);

    queuedExecutions.shift()?.resolve();
    await waitForCondition(() => executeOrder.length === 3);
    expect(executeOrder).toEqual(['one', 'two', 'three']);

    queuedExecutions.shift()?.resolve();
    expect(handleChatSendMock).toHaveBeenCalledTimes(3);
  });
});
