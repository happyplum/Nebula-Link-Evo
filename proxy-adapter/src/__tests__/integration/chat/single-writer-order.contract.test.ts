import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ResolvedConfig } from '../../../config/schema.js';
import type { SessionEvent, SessionEventType } from '@nebula-link-evo/shared/types/sse-events';
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

describe('single writer order contract', () => {
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

    sessionId = `single-writer-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    manager.createSession({
      id: sessionId,
      title: 'single-writer-order',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });
  });

  afterEach(async () => {
    await manager.close();
    vi.restoreAllMocks();
  });

  it('persists event to sqlite before publishing to hub', async () => {
    const dao = DatabaseManager.getInstance().getSessionEventsDAO();
    const publishChecks: Promise<void>[] = [];
    const publish = vi.fn((publishedSessionId: string, event: SessionEvent) => {
      if (publishedSessionId !== sessionId || event.seq === undefined) {
        return;
      }

      publishChecks.push(
        (async () => {
          const events = await dao.getEventsAfter(sessionId, event.seq - 1, 1);
          expect(events).toHaveLength(1);
          expect(events[0].seq).toBe(event.seq);
          expect(events[0].type).toBe(event.type);
        })()
      );
    });

    const chatHandler = new ChatHandler(
      manager,
      createResolvedConfig(),
      wsManager,
      mcpClient,
      dao,
      { publish } as unknown as SessionEventHub
    );

    const emitSessionEvent = getEmitSessionEvent(chatHandler);
    await emitSessionEvent(sessionId, 'assistant.delta', {
      sessionId,
      messageId: 'msg-1',
      text: 'hello',
    });

    await Promise.all(publishChecks);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('appendEventSync writes immediately and is queryable right away', async () => {
    const dao = DatabaseManager.getInstance().getSessionEventsDAO();
    const seq = dao.appendEventSync(sessionId, 'assistant.started', {
      sessionId,
      messageId: 'msg-1',
    });

    const events = await dao.getEventsAfter(sessionId, seq - 1, 1);
    expect(events).toHaveLength(1);
    expect(events[0].seq).toBe(seq);
    expect(events[0].type).toBe('assistant.started');
  });

  it('keeps sequence numbers monotonically increasing within a session', async () => {
    const dao = DatabaseManager.getInstance().getSessionEventsDAO();

    const seq1 = dao.appendEventSync(sessionId, 'assistant.started', {
      sessionId,
      messageId: 'msg-1',
    });
    const seq2 = dao.appendEventSync(sessionId, 'assistant.delta', {
      sessionId,
      messageId: 'msg-1',
      text: 'part-1',
    });
    const seq3 = await dao.appendEvent(sessionId, 'assistant.completed', {
      sessionId,
      messageId: 'msg-1',
      terminalReason: 'stop',
    });

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
    expect(seq3).toBe(3);
  });

  it('does not publish when dao write fails', async () => {
    const appendEvent = vi.fn<
      (sessionId: string, type: SessionEventType, payload: Record<string, unknown>) => Promise<number>
    >();
    appendEvent.mockRejectedValue(new Error('dao failure'));

    const publish = vi.fn();
    const chatHandler = new ChatHandler(
      manager,
      createResolvedConfig(),
      wsManager,
      mcpClient,
      { appendEvent } as unknown as SessionEventsDAO,
      { publish } as unknown as SessionEventHub
    );

    const emitSessionEvent = getEmitSessionEvent(chatHandler);
    await emitSessionEvent(sessionId, 'assistant.delta', {
      sessionId,
      messageId: 'msg-1',
      text: 'should-not-publish',
    });

    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });
});
