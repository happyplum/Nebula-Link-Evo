import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ResolvedConfig } from '../../../config/schema.js';
import type { SessionEventType } from '@nebula-link-evo/shared/types/sse-events';
import { ChatHandler } from '../../../conversation/chat-handler.js';
import { ConversationManager } from '../../../conversation/manager.js';
import { DebugWebSocketManager } from '../../../websocket-manager.js';
import { MCPSDKClient } from '../../../clients/mcp/sdk-client.js';
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

describe('chat sdk loop success contract', () => {
  let manager: ConversationManager;
  let wsManager: DebugWebSocketManager;
  let mcpClient: MCPSDKClient;
  let chatHandler: ChatHandler;
  let sessionId: string;

  const appendEvent = vi.fn<(sessionId: string, type: SessionEventType, payload: Record<string, unknown>) => Promise<number>>();

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ConversationManager(':memory:');
    manager.initialize();
    wsManager = DebugWebSocketManager.getInstance();
    wsManager.setTaskCommandHandler(() => {});

    mcpClient = new MCPSDKClient(createResolvedConfig());
    vi.spyOn(mcpClient, 'isEnabled').mockReturnValue(true);
    vi.spyOn(mcpClient, 'getAvailableTools').mockReturnValue([
      {
        name: 'browser-control.browser_snapshot',
        description: 'Get browser snapshot',
        inputSchema: {
          type: 'object',
          properties: {
            includeMeta: { type: 'boolean' },
          },
        },
      },
    ]);
    vi.spyOn(mcpClient, 'callTool').mockResolvedValue({ snapshot: { url: 'https://example.com' } });

    sessionId = `sdk-loop-success-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    manager.createSession({
      id: sessionId,
      title: 'sdk-loop-success',
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
      wsManager,
      mcpClient,
      sessionEventsDAO,
      sessionEventHub
    );
  });

  afterEach(async () => {
    await manager.close();
    vi.restoreAllMocks();
  });

  it('emits started -> delta -> completed in single-step success path', async () => {
    streamTextMock.mockResolvedValue(
      createStream([
        { type: 'text-delta', text: 'Hello' },
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        },
      ])
    );

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'hi',
    });

    const eventTypes = appendEvent.mock.calls.map((call) => call[1]);
    const startedIndex = eventTypes.indexOf('assistant.started');
    const deltaIndex = eventTypes.indexOf('assistant.delta');
    const completedIndex = eventTypes.lastIndexOf('assistant.completed');

    expect(startedIndex).toBeGreaterThanOrEqual(0);
    expect(deltaIndex).toBeGreaterThan(startedIndex);
    expect(completedIndex).toBeGreaterThan(deltaIndex);
    expect(eventTypes).not.toContain('run.error');

    const startedPayload = appendEvent.mock.calls.find((call) => call[1] === 'assistant.started')?.[2] ?? {};
    expect(startedPayload.runId).toEqual(expect.any(String));
  });

  it('emits tool_call -> tool_result and continues generation in multi-step loop', async () => {
    streamTextMock.mockImplementation(async (...args) => {
      const streamOptions = args[0] as {
        tools?: Record<string, { execute?: (input: unknown) => Promise<unknown> }>;
      };
      const snapshotTool = streamOptions.tools?.['browser-control.browser_snapshot'];
      if (!snapshotTool?.execute) {
        throw new Error('tool wrapper not created');
      }

      const toolOutput = await snapshotTool.execute({ includeMeta: true });
      return createStream([
        { type: 'text-delta', text: '先查看页面。' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'browser-control.browser_snapshot',
          input: { includeMeta: true },
        },
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'browser-control.browser_snapshot',
          input: { includeMeta: true },
          output: toolOutput,
        },
        { type: 'text-delta', text: '已完成。' },
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: { inputTokens: 15, outputTokens: 8, totalTokens: 23 },
        },
      ]);
    });

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: '使用工具后继续回答',
    });

    expect(mcpClient.callTool).toHaveBeenCalledWith('browser-control', 'browser_snapshot', {
      includeMeta: true,
    });

    const eventTypes = appendEvent.mock.calls.map((call) => call[1]);
    const toolCallIndex = eventTypes.indexOf('assistant.tool_call');
    const toolResultIndex = eventTypes.indexOf('assistant.tool_result');
    const completedIndex = eventTypes.lastIndexOf('assistant.completed');

    expect(toolCallIndex).toBeGreaterThanOrEqual(0);
    expect(toolResultIndex).toBeGreaterThan(toolCallIndex);
    expect(completedIndex).toBeGreaterThan(toolResultIndex);

    const toolCallPayload = appendEvent.mock.calls.find((call) => call[1] === 'assistant.tool_call')?.[2] ?? {};
    const toolResultPayload = appendEvent.mock.calls.find((call) => call[1] === 'assistant.tool_result')?.[2] ?? {};

    expect(toolCallPayload.toolCallId).toBe('call_1');
    expect(toolResultPayload.toolCallId).toBe('call_1');
    expect(toolCallPayload.runId).toEqual(expect.any(String));
    expect(toolResultPayload.runId).toBe(toolCallPayload.runId);
  });
});
