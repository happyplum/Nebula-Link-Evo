import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHandler } from '../conversation/chat-handler.js';
import { ConversationManager } from '../conversation/manager.js';
import type { ResolvedConfig } from '../config/schema.js';
import { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import { SessionEventsDAO } from '../conversation/session-events-dao.js';
import { SessionEventHub } from '../services/session-event-hub.js';
import type { BrowserClient } from '../browser-client.js';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import { toSDKResult } from '../browser-tools/result-adapter.js';

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

vi.mock('../clients/vercel-ai/provider.js', () => ({
  getModel: getModelMock,
}));

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

describe('ChatHandler SSE integration', () => {
  let conversationManager: ConversationManager;
  let mcpClient: MCPSDKClient;
  let mockBrowserClient: BrowserClient;
  let sessionId: string;

  beforeEach(() => {
    sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    conversationManager = new ConversationManager(':memory:');
    conversationManager.initialize();
    conversationManager.createSession({
      id: sessionId,
      title: 'SSE test session',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    mcpClient = new MCPSDKClient(mockConfig);
    vi.spyOn(mcpClient, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(mcpClient, 'isEnabled').mockReturnValue(true);
    vi.spyOn(mcpClient, 'getAvailableTools').mockReturnValue([]);

    // Mock browserClient - browser-control 工具现在走本地路径
    mockBrowserClient = {
      getSimplifiedDOM: vi.fn().mockResolvedValue({
        snapshot_id: 'test-snapshot-123',
        elements: [],
      } as DOMSnapshotResponse),
    } as unknown as BrowserClient;
  });

  it('emits required SSE event types with write-first behavior', async () => {
    const callLog: string[] = [];
    const appendEvent = vi
      .fn()
      .mockImplementation(async (_sessionId: string, type: string) => {
        callLog.push(`append:${type}`);
        return 1;
      });
    const appendLiveEvent = vi
      .fn()
      .mockImplementation((_sessionId: string, type: string) => {
        callLog.push(`appendLive:${type}`);
        return 1;
      });
    const publish = vi.fn().mockImplementation((_sessionId: string, event: { type: string }) => {
      callLog.push(`publish:${event.type}`);
    });

    const sessionEventsDAO = {
      appendEvent,
      appendLiveEvent,
      flush: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionEventsDAO;

    const sessionEventHub = {
      publish,
    } as unknown as SessionEventHub;

    streamTextMock.mockResolvedValue(
      createStream([
        { type: 'reasoning-delta', text: 'Need tool first' },
        { type: 'text-delta', text: 'Working' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'browser-control.dom_snapshot',
          input: {},
        },
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'browser-control.dom_snapshot',
          input: {},
          output: '{"snapshot_id":"test-snapshot-123","elements":[]}',
        },
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
        },
      ])
    );

    const chatHandler = new ChatHandler(
      conversationManager,
      mockConfig,
      mcpClient,
      sessionEventsDAO,
      sessionEventHub,
      mockBrowserClient
    );

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'Run with tools',
    });

    const appendedTypes = callLog
      .filter((entry) => entry.startsWith('append'))
      .map((entry) => entry.split(':')[1]);
    expect(appendedTypes).toContain('assistant.thinking');
    expect(appendedTypes).toContain('assistant.delta');
    expect(appendedTypes).toContain('assistant.tool_call');
    expect(appendedTypes).toContain('assistant.tool_result');
    expect(appendedTypes).toContain('assistant.completed');
    expect(appendedTypes).not.toContain('run.error');

    const appendCount = new Map<string, number>();
    const publishCount = new Map<string, number>();

    for (const entry of callLog) {
      const [op, type] = entry.split(':');
      if (op === 'append' || op === 'appendLive') {
        appendCount.set(type, (appendCount.get(type) ?? 0) + 1);
        continue;
      }

      publishCount.set(type, (publishCount.get(type) ?? 0) + 1);
      expect((publishCount.get(type) ?? 0)).toBeLessThanOrEqual(appendCount.get(type) ?? 0);
    }
  });

  it('emits events in expected execution order', async () => {
    const allTypes: string[] = [];
    const appendEvent = vi.fn().mockImplementation(async (_s: string, type: string) => {
      allTypes.push(type);
      return 1;
    });
    const appendLiveEvent = vi.fn().mockImplementation((_s: string, type: string) => {
      allTypes.push(type);
      return 1;
    });
    const publish = vi.fn();

    const sessionEventsDAO = {
      appendEvent,
      appendLiveEvent,
      flush: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionEventsDAO;

    const sessionEventHub = {
      publish,
    } as unknown as SessionEventHub;

    streamTextMock.mockResolvedValue(
      createStream([
        { type: 'reasoning-delta', text: 'step thinking' },
        { type: 'text-delta', text: 'chunk-1' },
        {
          type: 'tool-call',
          toolCallId: 'call_2',
          toolName: 'browser-control.dom_snapshot',
          input: {},
        },
        {
          type: 'tool-result',
          toolCallId: 'call_2',
          toolName: 'browser-control.dom_snapshot',
          input: {},
          output: '{"snapshot_id":"test-snapshot-123","elements":[]}',
        },
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
        },
      ])
    );

    const chatHandler = new ChatHandler(
      conversationManager,
      mockConfig,
      mcpClient,
      sessionEventsDAO,
      sessionEventHub,
      mockBrowserClient
    );

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'verify order',
    });

    const types = allTypes;

    const startedIndex = types.indexOf('assistant.started');
    const thinkingIndex = types.indexOf('assistant.thinking');
    const deltaIndex = types.indexOf('assistant.delta');
    const toolCallIndex = types.indexOf('assistant.tool_call');
    const toolResultIndex = types.indexOf('assistant.tool_result');
    const completedIndex = types.lastIndexOf('assistant.completed');

    expect(startedIndex).toBeGreaterThanOrEqual(0);
    expect(thinkingIndex).toBeGreaterThan(startedIndex);
    expect(deltaIndex).toBeGreaterThan(thinkingIndex);
    expect(toolCallIndex).toBeGreaterThan(deltaIndex);
    expect(toolResultIndex).toBeGreaterThan(toolCallIndex);
    expect(completedIndex).toBeGreaterThan(toolResultIndex);
  });

  it('format alignment: toSDKResult converts browserClient result to MCP-compatible format', () => {
    // MCP 路径格式：CallToolResult with content[0].text
    const mcpFormatResult = {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ snapshot_id: 'test-123', elements: [] }),
        },
      ],
      _meta: 'mcp',
    };

    // BrowserClient 本地路径返回：原始对象
    const browserClientResult = {
      snapshot_id: 'test-123',
      elements: [],
    } as DOMSnapshotResponse;

    // toSDKResult 将本地结果转为 MCP 兼容的字符串格式
    const converted = toSDKResult(browserClientResult);

    // 验证：toSDKResult 输出与 MCP content[0].text 一致
    expect(converted).toBe(mcpFormatResult.content[0].text);
    expect(converted).toBe(JSON.stringify(browserClientResult));
  });

  // 注意：browser-control 工具调用路径的验证在更低层次的测试中进行
  // （如 chat-handler.test.ts 和集成测试），因为 SSE 集成测试使用 streamTextMock
  // 完全模拟了执行流程，无法直接观察实际的工具调用
});
