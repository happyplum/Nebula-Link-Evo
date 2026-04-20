import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ResolvedConfig } from '../../../config/schema.js';
import type { SessionEventType } from '@nebula-link-evo/shared/types/sse-events';
import { ChatHandler } from '../../../conversation/chat-handler.js';
import { ConversationManager } from '../../../conversation/manager.js';
import { DatabaseManager } from '../../../conversation/db.js';
import { DebugWebSocketManager } from '../../../websocket-manager.js';
import { MCPSDKClient } from '../../../clients/mcp/sdk-client.js';
import { SessionEventsDAO } from '../../../conversation/session-events-dao.js';
import { SessionEventHub } from '../../../services/session-event-hub.js';

type EmitSessionEvent = (
  sessionId: string,
  type: SessionEventType,
  payload: Record<string, unknown>
) => Promise<void>;

function createResolvedConfig(): ResolvedConfig {
  return {
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
    mcp: { enabled: true, servers: {} },
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
      maxSteps: 8,
    },
  };
}

function getEmitSessionEvent(handler: ChatHandler): EmitSessionEvent {
  return (handler as unknown as { emitSessionEvent: EmitSessionEvent }).emitSessionEvent.bind(handler);
}

describe('single writer failure contract', () => {
  let manager: ConversationManager;
  let wsManager: DebugWebSocketManager;
  let mcpClient: MCPSDKClient;
  let sessionId: string;

  beforeEach(() => {
    manager = new ConversationManager(':memory:');
    manager.initialize();
    wsManager = DebugWebSocketManager.getInstance();
    wsManager.setTaskCommandHandler(() => {});

    mcpClient = new MCPSDKClient(createResolvedConfig());
    vi.spyOn(mcpClient, 'isEnabled').mockReturnValue(false);

    sessionId = `single-writer-failure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    manager.createSession({
      id: sessionId,
      title: 'single-writer-failure',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });
  });

  afterEach(async () => {
    await manager.close();
    vi.restoreAllMocks();
  });

  it('does not publish when dao append throws', async () => {
    const appendEvent = vi.fn<
      (sessionId: string, type: SessionEventType, payload: Record<string, unknown>) => Promise<number>
    >();
    appendEvent.mockRejectedValue(new Error('append failed'));

    const publish = vi.fn();
    const chatHandler = new ChatHandler(
      manager,
      createResolvedConfig(),
      wsManager,
      mcpClient,
      { appendEvent } as unknown as SessionEventsDAO,
      { publish } as unknown as SessionEventHub
    );

    await getEmitSessionEvent(chatHandler)(sessionId, 'assistant.delta', {
      sessionId,
      messageId: 'msg-1',
      text: 'no publish',
    });

    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not publish when buffered batch flush fails', async () => {
    vi.useFakeTimers();
    const dao = DatabaseManager.getInstance().getSessionEventsDAO();
    const daoDb = (dao as unknown as { db: { prepare: (sql: string) => unknown } }).db;
    const originalPrepare = daoDb.prepare.bind(daoDb);

    let failOnce = true;
    vi.spyOn(daoDb, 'prepare').mockImplementation((sql: string) => {
      if (failOnce && sql.includes('INSERT INTO session_events')) {
        failOnce = false;
        throw new Error('batch flush failed');
      }
      return originalPrepare(sql);
    });

    const publish = vi.fn();
    const chatHandler = new ChatHandler(
      manager,
      createResolvedConfig(),
      wsManager,
      mcpClient,
      dao,
      { publish } as unknown as SessionEventHub
    );

    const emitPromise = getEmitSessionEvent(chatHandler)(sessionId, 'assistant.delta', {
      sessionId,
      messageId: 'msg-1',
      text: 'buffered',
    });

    await vi.advanceTimersByTimeAsync(100);
    await emitPromise;

    expect(publish).not.toHaveBeenCalled();
    const events = await dao.getEventsAfter(sessionId, 0, 10);
    expect(events).toHaveLength(0);
    vi.useRealTimers();
  });

  it('propagates sync write errors instead of swallowing them', () => {
    const dao = DatabaseManager.getInstance().getSessionEventsDAO();
    const daoDb = (dao as unknown as { db: { prepare: (sql: string) => unknown } }).db;
    const originalPrepare = daoDb.prepare.bind(daoDb);

    let failOnce = true;
    vi.spyOn(daoDb, 'prepare').mockImplementation((sql: string) => {
      if (failOnce && sql.includes('INSERT INTO session_events')) {
        failOnce = false;
        throw new Error('sync insert failed');
      }
      return originalPrepare(sql);
    });

    expect(() =>
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'must fail',
      })
    ).toThrow('sync insert failed');
  });

  it('recovers after a write failure and accepts subsequent writes', async () => {
    const dao = DatabaseManager.getInstance().getSessionEventsDAO();
    const daoDb = (dao as unknown as { db: { prepare: (sql: string) => unknown } }).db;
    const originalPrepare = daoDb.prepare.bind(daoDb);

    let failOnce = true;
    vi.spyOn(daoDb, 'prepare').mockImplementation((sql: string) => {
      if (failOnce && sql.includes('INSERT INTO session_events')) {
        failOnce = false;
        throw new Error('transient insert failure');
      }
      return originalPrepare(sql);
    });

    expect(() =>
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'first attempt fails',
      })
    ).toThrow('transient insert failure');

    const seq = dao.appendEventSync(sessionId, 'assistant.delta', {
      sessionId,
      messageId: 'msg-1',
      text: 'second attempt succeeds',
    });

    expect(seq).toBe(1);
    const events = await dao.getEventsAfter(sessionId, 0, 10);
    expect(events).toHaveLength(1);
    expect(events[0].seq).toBe(1);
    expect(events[0].type).toBe('assistant.delta');
  });
});
