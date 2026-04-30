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

describe('chat sdk loop error contract', () => {
  let manager: ConversationManager;
  let mcpClient: MCPSDKClient;
  let chatHandler: ChatHandler;
  let sessionId: string;

  const appendEvent = vi.fn<(sessionId: string, type: SessionEventType, payload: Record<string, unknown>) => Promise<number>>();

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ConversationManager(':memory:');
    manager.initialize();
    mcpClient = new MCPSDKClient(createResolvedConfig());
    vi.spyOn(mcpClient, 'isEnabled').mockReturnValue(true);
    vi.spyOn(mcpClient, 'getAvailableTools').mockReturnValue([]);

    sessionId = `sdk-loop-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    manager.createSession({
      id: sessionId,
      title: 'sdk-loop-error',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    appendEvent.mockResolvedValue(1);
    const sessionEventsDAO = {
      appendEvent,
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

  it('emits run.error when SDK stream fails', async () => {
    streamTextMock.mockRejectedValue(new Error('stream failed'));

    await expect(
      chatHandler.handleChatSend('test-client', {
        sessionId,
        message: 'trigger error',
      })
    ).resolves.toBeUndefined();

    const eventTypes = appendEvent.mock.calls.map((call) => call[1]);
    expect(eventTypes).toContain('assistant.started');
    expect(eventTypes).toContain('run.error');

    const errorPayload = appendEvent.mock.calls.find((call) => call[1] === 'run.error')?.[2] ?? {};
    expect(errorPayload.error).toContain('stream failed');
    expect(errorPayload.runId).toEqual(expect.any(String));
  });

  it('handles abort signal gracefully without emitting run.error', async () => {
    streamTextMock.mockImplementation(async (...args) => {
      const streamOptions = args[0] as { abortSignal?: AbortSignal };

      return {
        fullStream: {
          async *[Symbol.asyncIterator]() {
            const signal = streamOptions.abortSignal;
            if (!signal) {
              return;
            }

            if (!signal.aborted) {
              await new Promise<void>((resolve) => {
                signal.addEventListener('abort', () => resolve(), { once: true });
              });
            }

            yield {
              type: 'abort',
              reason: 'interrupted',
            };
          },
        },
      };
    });

    const runPromise = chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'interrupt me',
    });

    await Promise.resolve();
    await ChatSessionController.getInstance().interrupt(sessionId);

    await expect(runPromise).resolves.toBeUndefined();
    const eventTypes = appendEvent.mock.calls.map((call) => call[1]);
    expect(eventTypes).toContain('assistant.started');
    expect(eventTypes).not.toContain('run.error');
  });
});
