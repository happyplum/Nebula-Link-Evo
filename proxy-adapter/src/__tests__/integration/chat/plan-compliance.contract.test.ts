import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { ResolvedConfig } from '../../../config/schema.js';
import type { SessionEvent, SessionEventType } from '@nebula-link-evo/shared';
import apiChatRoutes from '../../../plugins/routes/api/chat/index.js';
import swaggerPlugin from '../../../plugins/02-swagger.plugin.js';
import errorHandler from '../../../plugins/03-error-handler.plugin.js';
import { ConversationManager } from '../../../conversation/manager.js';
import { DatabaseManager } from '../../../conversation/db.js';
import { ChatHandler } from '../../../conversation/chat-handler.js';
import { SessionLock } from '../../../services/session-lock.js';
import { ConversationJobQueue } from '../../../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../../../services/stream-persist-worker.js';
import { SessionEventHub } from '../../../services/session-event-hub.js';
import { SessionEventsDAO } from '../../../conversation/session-events-dao.js';
import { DebugWebSocketManager } from '../../../websocket-manager.js';

type StreamPart = { type: string; [key: string]: unknown };

const { streamTextMock, stepCountIsMock, toolMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn<(...args: unknown[]) => Promise<{ fullStream: AsyncIterable<StreamPart> }>>(),
  stepCountIsMock: vi.fn().mockReturnValue(() => false),
  toolMock: vi.fn((definition: unknown) => definition),
}));

const { mockConfig, mockGetConfig } = vi.hoisted(() => {
  const config: ResolvedConfig = {
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
      mode: 'separation',
      vision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
      decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
    },
    settings: {
      timeout: 30000,
      maxRetries: 3,
      temperature: 0.4,
      maxTokens: 2000,
      maxSteps: 3,
    },
  };

  return {
    mockConfig: config,
    mockGetConfig: vi.fn().mockReturnValue(config),
  };
});

vi.mock('../../../services/index.js', () => ({
  TaskService: {
    getInstance: vi.fn().mockReturnValue({
      getConfig: mockGetConfig,
    }),
  },
}));

vi.mock('ai', () => ({
  streamText: streamTextMock,
  stepCountIs: stepCountIsMock,
  tool: toolMock,
}));

vi.mock('../../../clients/vercel-ai/provider.js', () => ({
  getModel: vi.fn().mockReturnValue({ provider: 'test-provider', modelId: 'test-model' }),
}));

function createStream(parts: StreamPart[]): { fullStream: AsyncIterable<StreamPart> } {
  return {
    fullStream: {
      async *[Symbol.asyncIterator]() {
        for (const part of parts) {
          yield part;
        }
      },
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return;
    }
    await sleep(5);
  }
  throw new Error('Condition was not met within timeout');
}

async function waitForJobTerminalStatuses(
  queue: ConversationJobQueue,
  jobIds: string[],
  timeoutMs = 2000
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const allTerminal = jobIds.every((jobId) => {
      const status = queue.getStatus(jobId)?.status;
      return status === 'completed' || status === 'failed' || status === 'cancelled';
    });

    if (allTerminal) {
      return;
    }
    await sleep(5);
  }

  throw new Error(`Timed out waiting for terminal statuses: ${jobIds.join(', ')}`);
}

describe('VF1 plan compliance contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    SessionLock.getInstance().clear();
    DatabaseManager.resetInstance();
  });

  afterEach(() => {
    SessionLock.getInstance().clear();
    DatabaseManager.resetInstance();
  });

  it('1) only POST /api/chat/sessions/:sessionId/messages triggers execution', async () => {
    const app = Fastify();
    const manager = new ConversationManager(':memory:');
    manager.initialize();
    const wsManager = DebugWebSocketManager.getInstance();
    const handler = new ChatHandler(manager, mockConfig, wsManager);
    const handleChatSendSpy = vi.spyOn(handler, 'handleChatSend').mockResolvedValue(undefined);

    await app.register(swaggerPlugin);
    await app.register(errorHandler);
    app.decorate('conversationManager', manager);
    app.decorate('chatHandler', handler);
    await app.register(apiChatRoutes, { prefix: '/api/chat' });

    const session = manager.createSession({
      title: 'plan-compliance-route',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const legacy = await app.inject({
      method: 'POST',
      url: '/api/chat/message',
      payload: { sessionId: session.id, message: 'legacy call' },
    });
    expect(legacy.statusCode).toBe(404);

    const canonical = await app.inject({
      method: 'POST',
      url: `/api/chat/sessions/${session.id}/messages`,
      payload: { content: 'canonical call' },
    });
    expect(canonical.statusCode).toBe(202);

    await waitFor(() => handleChatSendSpy.mock.calls.length === 1);

    await app.inject({ method: 'GET', url: `/api/chat/sessions/${session.id}` });
    await app.inject({ method: 'GET', url: `/api/chat/sessions/${session.id}/messages` });
    await app.inject({ method: 'POST', url: `/api/chat/sessions/${session.id}/pause` });
    await app.inject({ method: 'POST', url: `/api/chat/sessions/${session.id}/resume` });
    await app.inject({ method: 'POST', url: `/api/chat/sessions/${session.id}/interrupt` });

    expect(handleChatSendSpy).toHaveBeenCalledTimes(1);

    await manager.close();
    await app.close();
  });

  it('2) same-session serial and cross-session parallel execution are deterministic', async () => {
    const sessionLock = SessionLock.getInstance();
    const persistWorker = new StreamPersistWorker();
    const queue = new ConversationJobQueue(persistWorker);

    const acquired1 = sessionLock.acquire('same-session', 'run-1');
    const acquired2 = sessionLock.acquire('same-session', 'run-2');
    expect(acquired1).toBe(true);
    expect(acquired2).toBe(false);
    sessionLock.release('same-session', 'run-1');

    let sameSessionActive = 0;
    let sameSessionMaxActive = 0;
    const sameSessionStartOrder: number[] = [];
    const sameSessionJobIds = await Promise.all(
      [0, 1, 2].map((index) =>
        queue.enqueue({
          sessionId: 'serialized-session',
          execute: async () => {
            sameSessionStartOrder.push(index);
            sameSessionActive++;
            sameSessionMaxActive = Math.max(sameSessionMaxActive, sameSessionActive);
            await sleep(10);
            sameSessionActive--;
          },
        })
      )
    );

    await waitForJobTerminalStatuses(queue, sameSessionJobIds);
    expect(sameSessionMaxActive).toBe(1);
    expect(sameSessionStartOrder).toEqual([0, 1, 2]);

    let sessionAStarted = false;
    let sessionBStarted = false;
    let resolveParallelJobs!: () => void;
    const parallelBarrier = new Promise<void>((resolve) => {
      resolveParallelJobs = resolve;
    });

    const jobA = await queue.enqueue({
      sessionId: 'parallel-session-a',
      execute: async () => {
        sessionAStarted = true;
        await parallelBarrier;
      },
    });
    const jobB = await queue.enqueue({
      sessionId: 'parallel-session-b',
      execute: async () => {
        sessionBStarted = true;
        await parallelBarrier;
      },
    });

    await waitFor(() => sessionAStarted && sessionBStarted);
    expect(queue.getStatus(jobA)?.status).toBe('running');
    expect(queue.getStatus(jobB)?.status).toBe('running');

    resolveParallelJobs();
    await waitForJobTerminalStatuses(queue, [jobA, jobB]);
    await persistWorker.shutdown();
  });

  it('3) maxToolLoops is enforced with explicit terminal semantics', async () => {
    const manager = new ConversationManager(':memory:');
    manager.initialize();
    const wsManager = DebugWebSocketManager.getInstance();

    const events: SessionEvent[] = [];
    const appendEvent = vi.fn<
      (sessionId: string, type: SessionEventType, payload: Record<string, unknown>) => Promise<number>
    >();
    appendEvent.mockImplementation(async (_sessionId, type, payload) => {
      const seq = events.length + 1;
      events.push({ type, seq, ...payload } as SessionEvent);
      return seq;
    });

    const publish = vi.fn((sessionId: string, event: SessionEvent) => {
      if (sessionId.startsWith('plan-compliance-loop-')) {
        events.push(event);
      }
    });

    const handler = new ChatHandler(
      manager,
      mockConfig,
      wsManager,
      undefined,
      { appendEvent } as unknown as SessionEventsDAO,
      { publish } as unknown as SessionEventHub
    );

    const sessionId = `plan-compliance-loop-${randomUUID()}`;
    manager.createSession({
      id: sessionId,
      title: 'plan-compliance-loop',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    streamTextMock.mockResolvedValue(
      createStream([
        { type: 'text-delta', text: 'chunk' },
        {
          type: 'finish',
          finishReason: 'max-steps',
          totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      ]) as any
    );

    await handler.handleChatSend('plan-compliance-client', {
      sessionId,
      message: 'trigger loop guard',
    });

    expect(stepCountIsMock).toHaveBeenCalledWith(3);
    expect((streamTextMock.mock.calls[0]?.[0] as any)?.maxSteps).toBe(3);

    const completed = events.find((event) => event.type === 'assistant.completed');
    expect(completed).toBeDefined();
    expect((completed as { terminal_reason?: string }).terminal_reason).toBe('max_steps_reached');

    await manager.close();
  });

  it('4) SSE observability and deterministic event replay via DAO remain available', async () => {
    const manager = new ConversationManager(':memory:');
    manager.initialize();
    const wsManager = DebugWebSocketManager.getInstance();

    const emittedTypes: SessionEventType[] = [];
    const appendEvent = vi.fn<
      (sessionId: string, type: SessionEventType, payload: Record<string, unknown>) => Promise<number>
    >();
    appendEvent.mockImplementation(async (_sessionId, type, _payload) => {
      emittedTypes.push(type);
      return emittedTypes.length;
    });

    const handler = new ChatHandler(
      manager,
      mockConfig,
      wsManager,
      undefined,
      { appendEvent } as unknown as SessionEventsDAO,
      { publish: vi.fn() } as unknown as SessionEventHub
    );

    const sessionId = `plan-compliance-observability-${randomUUID()}`;
    manager.createSession({
      id: sessionId,
      title: 'plan-compliance-observability',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    streamTextMock.mockResolvedValue(
      createStream([
        { type: 'text-delta', text: 'd1' },
        { type: 'reasoning-delta', text: 'think' },
        { type: 'tool-call', toolCallId: 'tc-1', toolName: 'browser.snapshot', input: { a: 1 } },
        { type: 'tool-result', toolCallId: 'tc-1', toolName: 'browser.snapshot', output: { ok: true } },
        {
          type: 'finish',
          finishReason: 'stop',
          totalUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        },
      ]) as any
    );

    await handler.handleChatSend('plan-compliance-client', {
      sessionId,
      message: 'emit all sse runtime events',
    });

    expect(emittedTypes).toEqual(
      expect.arrayContaining([
        'assistant.delta',
        'assistant.thinking',
        'assistant.tool_call',
        'assistant.tool_result',
        'assistant.completed',
      ])
    );

    const dao = DatabaseManager.getInstance().getSessionEventsDAO();
    const replaySessionId = `plan-compliance-replay-${randomUUID()}`;
    manager.createSession({
      id: replaySessionId,
      title: 'plan-compliance-replay',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    dao.appendEventSync(replaySessionId, 'assistant.delta', {
      sessionId: replaySessionId,
      messageId: 'm1',
      text: 'a',
    });
    dao.appendEventSync(replaySessionId, 'assistant.thinking', {
      sessionId: replaySessionId,
      messageId: 'm1',
      text: 'b',
    });
    dao.appendEventSync(replaySessionId, 'assistant.tool_call', {
      sessionId: replaySessionId,
      messageId: 'm1',
      toolCall: { function: { name: 'x' } },
    });
    dao.appendEventSync(replaySessionId, 'assistant.tool_result', {
      sessionId: replaySessionId,
      messageId: 'm1',
      result: 'ok',
    });
    dao.appendEventSync(replaySessionId, 'assistant.completed', {
      sessionId: replaySessionId,
      messageId: 'm1',
      terminal_reason: 'stop',
    });

    const replayBatch1 = await dao.getEventsAfter(replaySessionId, 0, 3);
    const lastSeq = replayBatch1[replayBatch1.length - 1].seq ?? 0;
    const replayBatch2 = await dao.getEventsAfter(replaySessionId, lastSeq, 10);

    const seqsBatch1 = replayBatch1.map((event) => event.seq ?? -1);
    const seqsBatch2 = replayBatch2.map((event) => event.seq ?? -1);
    const overlap = seqsBatch1.filter((seq) => seqsBatch2.includes(seq));

    expect(overlap).toHaveLength(0);
    expect(seqsBatch1).toEqual([...seqsBatch1].sort((a, b) => a - b));
    expect(seqsBatch2).toEqual([...seqsBatch2].sort((a, b) => a - b));

    await manager.close();
  });

  it('5) durable/playback boundaries are non-overlapping', async () => {
    const manager = new ConversationManager(':memory:');
    manager.initialize();
    const db = DatabaseManager.getInstance();
    const dao = db.getSessionEventsDAO();

    const sessionId = `plan-compliance-boundary-${randomUUID()}`;
    manager.createSession({
      id: sessionId,
      title: 'plan-compliance-boundary',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });
    await manager.createSessionState({ sessionId, status: 'idle' });

    const messageBefore = db.executeSql('SELECT COUNT(*) as count FROM messages WHERE session_id = ?', [sessionId]);
    const eventBefore = db.executeSql('SELECT COUNT(*) as count FROM session_events WHERE session_id = ?', [sessionId]);
    const stateBefore = db.executeSql('SELECT COUNT(*) as count FROM sessions_state WHERE session_id = ?', [sessionId]);

    expect((messageBefore[0] as { count: number }).count).toBe(0);
    expect((eventBefore[0] as { count: number }).count).toBe(0);
    expect((stateBefore[0] as { count: number }).count).toBe(1);

    manager.addMessage(sessionId, {
      role: 'user',
      content: 'durable message',
    });
    await manager.updateSessionStatus(sessionId, 'running');

    const messageAfterDurable = db.executeSql('SELECT COUNT(*) as count FROM messages WHERE session_id = ?', [sessionId]);
    const eventAfterDurable = db.executeSql('SELECT COUNT(*) as count FROM session_events WHERE session_id = ?', [sessionId]);
    const stateAfterDurable = db.executeSql('SELECT status FROM sessions_state WHERE session_id = ?', [sessionId]);

    expect((messageAfterDurable[0] as { count: number }).count).toBe(1);
    expect((eventAfterDurable[0] as { count: number }).count).toBe(0);
    expect((stateAfterDurable[0] as { status: string }).status).toBe('running');

    dao.appendEventSync(sessionId, 'assistant.delta', {
      sessionId,
      messageId: 'm-boundary',
      text: 'playback event',
    });

    const messageAfterEvent = db.executeSql('SELECT COUNT(*) as count FROM messages WHERE session_id = ?', [sessionId]);
    const eventAfterEvent = db.executeSql('SELECT COUNT(*) as count FROM session_events WHERE session_id = ?', [sessionId]);
    const stateAfterEvent = db.executeSql('SELECT status FROM sessions_state WHERE session_id = ?', [sessionId]);

    expect((messageAfterEvent[0] as { count: number }).count).toBe(1);
    expect((eventAfterEvent[0] as { count: number }).count).toBe(1);
    expect((stateAfterEvent[0] as { status: string }).status).toBe('running');

    await manager.close();
  });
});
