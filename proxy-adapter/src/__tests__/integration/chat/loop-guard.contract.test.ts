import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ResolvedConfig } from '../../../config/schema.js';
import type { SessionEventType } from '@nebula-link-evo/shared/types/sse-events';
import { ChatHandler } from '../../../conversation/chat-handler.js';
import { ConversationManager } from '../../../conversation/manager.js';
import { MCPSDKClient } from '../../../clients/mcp/sdk-client.js';
import { ChatSessionController } from '../../../services/chat-session-controller.js';
import { SessionEventsDAO } from '../../../conversation/session-events-dao.js';
import { SessionEventHub } from '../../../services/session-event-hub.js';

type StreamResult = {
  fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>;
};

const { streamTextMock, toolMock, stepCountIsMock, getModelMock } = vi.hoisted(() => {
  const streamText = vi.fn<(...args: unknown[]) => Promise<StreamResult>>();
  const tool = vi.fn((definition: unknown) => definition);
  const stepCountIs = vi.fn().mockReturnValue(() => false);
  const getModel = vi.fn().mockReturnValue({ provider: 'test-provider', modelId: 'test-model' });
  return {
    streamTextMock: streamText,
    toolMock: tool,
    stepCountIsMock: stepCountIs,
    getModelMock: getModel,
  };
});

vi.mock('ai', () => ({
  streamText: streamTextMock,
  tool: toolMock,
  stepCountIs: stepCountIsMock,
}));

vi.mock('../../../clients/vercel-ai/provider.js', () => ({
  getModel: getModelMock,
}));

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

function createStream(parts: Array<{ type: string; [key: string]: unknown }>): StreamResult {
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

describe('chat loop guard completion contract', () => {
  let manager: ConversationManager;
  let mcpClient: MCPSDKClient;
  let chatHandler: ChatHandler;
  let sessionId: string;

  const appendEvent = vi.fn<
    (sessionId: string, type: SessionEventType, payload: Record<string, unknown>) => Promise<number>
  >();

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ConversationManager(':memory:');
    manager.initialize();
    mcpClient = new MCPSDKClient(createResolvedConfig());
    vi.spyOn(mcpClient, 'isEnabled').mockReturnValue(true);
    vi.spyOn(mcpClient, 'getAvailableTools').mockReturnValue([]);

    sessionId = `loop-guard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    manager.createSession({
      id: sessionId,
      title: 'loop-guard-contract',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    appendEvent.mockResolvedValue(1);
    const sessionEventsDAO = {
      appendEvent,
      flush: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionEventsDAO;
    const sessionEventHub = {
      publish: vi.fn(),
    } as unknown as SessionEventHub;

    chatHandler = new ChatHandler(
      manager,
      createResolvedConfig(),
      mcpClient,
      sessionEventsDAO,
      sessionEventHub
    );
  });

  afterEach(async () => {
    await manager.close();
    vi.restoreAllMocks();
  });

  it('emits terminal_reason=max_steps_reached when finishReason is max-steps and persists terminal reason', async () => {
    const updateSessionStatusSpy = vi.spyOn(manager, 'updateSessionStatus').mockResolvedValue(undefined);

    streamTextMock.mockResolvedValue(
      createStream([
        { type: 'text-delta', text: 'keep going' },
        {
          type: 'finish',
          finishReason: 'max-steps',
          rawFinishReason: 'max-steps',
          totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      ])
    );

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'trigger max steps',
    });

    const completedPayload = appendEvent.mock.calls.find((call) => call[1] === 'assistant.completed')?.[2] ?? {};
    expect(completedPayload.terminal_reason).toBe('max_steps_reached');

    const completionStateCall = updateSessionStatusSpy.mock.calls.find((call) => call[1] === 'completed');
    expect(completionStateCall).toBeDefined();
    expect(completionStateCall?.[2]).toMatchObject({
      terminalReason: 'max_steps_reached',
    });
  });

  it('emits terminal_reason=stop when model finishes normally', async () => {
    streamTextMock.mockResolvedValue(
      createStream([
        { type: 'text-delta', text: 'done' },
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
        },
      ])
    );

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'normal finish',
    });

    const completedPayload = appendEvent.mock.calls.find((call) => call[1] === 'assistant.completed')?.[2] ?? {};
    expect(completedPayload.terminal_reason).toBe('stop');
  });

  it('emits terminal_reason=pause when pause is requested at finish-step', async () => {
    const controller = ChatSessionController.getInstance();
    controller.setPauseFlags(sessionId, { pauseAfterGeneration: true });

    streamTextMock.mockResolvedValue(
      createStream([
        { type: 'text-delta', text: 'partial' },
        { type: 'finish-step' },
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
        },
      ])
    );

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'pause me',
    });

    const completedPayload = appendEvent.mock.calls.find((call) => call[1] === 'assistant.completed')?.[2] ?? {};
    expect(completedPayload.terminal_reason).toBe('pause');

    const persistedState = await manager.getSessionState(sessionId);
    expect(persistedState?.agentState).toMatchObject({
      terminalReason: 'pause',
    });
  });
});
