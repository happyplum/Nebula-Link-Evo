import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamTask } from '../../clients/vercel-ai/streaming.js';
import type { ActionExecutor, ActionResult } from '../../services/action-executor.js';
import type { TaskOrchestrator } from '../../services/task-orchestrator.js';
import type { ModelMessage } from 'ai';
import type { ResolvedConfig } from '../../config/schema.js';

// Mock the AI SDK
vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

// Mock the provider module
vi.mock('../../clients/vercel-ai/provider.js', () => ({
  getModel: vi.fn().mockReturnValue({
    provider: 'test-provider',
    modelId: 'test-model',
  }),
}));

// Mock core tools
vi.mock('../../clients/vercel-ai/core-tools.js', () => ({
  createCoreTools: vi.fn().mockReturnValue({
    click: { description: 'click', inputSchema: {}, execute: vi.fn() },
    type: { description: 'type', inputSchema: {}, execute: vi.fn() },
    navigate: { description: 'navigate', inputSchema: {}, execute: vi.fn() },
    scroll: { description: 'scroll', inputSchema: {}, execute: vi.fn() },
    wait: { description: 'wait', inputSchema: {}, execute: vi.fn() },
    screenshot: { description: 'screenshot', inputSchema: {}, execute: vi.fn() },
  }),
}));

// Mock skills tool
vi.mock('../../clients/vercel-ai/skills-tool.js', () => ({
  createLoadSkillTool: vi.fn().mockReturnValue({
    description: 'loadSkill',
    inputSchema: {},
    execute: vi.fn(),
  }),
}));

describe('streamTask', () => {
  let mockExecutor: ActionExecutor;
  let mockTaskOrchestrator: TaskOrchestrator;
  let events: Array<{ type: string; [key: string]: unknown }>;

let mockConfig: ResolvedConfig;
  beforeEach(async () => {
    vi.clearAllMocks();

    mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        action: { type: 'click', params: {} },
        success: true,
        message: 'Action executed',
      } as ActionResult),
    } as unknown as ActionExecutor;

    mockTaskOrchestrator = {} as unknown as TaskOrchestrator;

    events = [];
mockConfig = {
      providers: {
        test: {
          apiKey: 'test-key',
          baseUrl: 'https://test.example.com',
        }
      },
      _resolved: {
        providers: {
          test: {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://test.example.com',
            models: {},
          },
        },
      },
    } as unknown as ResolvedConfig;
  });

  describe('streaming events', () => {
    it('should emit text-delta events', async () => {
      const { streamText } = vi.mocked(await import('ai'));

      const asyncIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', text: 'Hello' };
          yield { type: 'text-delta', text: ' World' };
          yield { type: 'finish', totalUsage: { promptTokens: 10, completionTokens: 5 } };
        },
      };
      streamText.mockResolvedValue({
        fullStream: asyncIterator,
      } as unknown as Awaited<ReturnType<typeof streamText>>);

await streamTask({
        provider: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
        executor: mockExecutor,
        taskOrchestrator: mockTaskOrchestrator,
        config: mockConfig,
        onEvent: (event) => events.push(event),
      });

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: 'chat_stream_token', text: 'Hello' });
      expect(events[1]).toEqual({ type: 'chat_stream_token', text: ' World' });
    });

    it('should emit tool-call events', async () => {
      const { streamText } = vi.mocked(await import('ai'));

      const asyncIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'tool-call',
            toolName: 'click',
            input: { x: 100, y: 200 },
          };
          yield { type: 'finish', totalUsage: { promptTokens: 10, completionTokens: 5 } };
        },
      };
      streamText.mockResolvedValue({
        fullStream: asyncIterator,
      } as unknown as Awaited<ReturnType<typeof streamText>>);

await streamTask({
        provider: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Click button' }] as ModelMessage[],
        executor: mockExecutor,
        taskOrchestrator: mockTaskOrchestrator,
        config: mockConfig,
        onEvent: (event) => events.push(event),
      });

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: 'chat_stream_tool_call',
        name: 'click',
        input: { x: 100, y: 200 },
      });
    });

    it('should emit tool-result events', async () => {
      const { streamText } = vi.mocked(await import('ai'));

      const asyncIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'tool-result',
            toolName: 'click',
            output: { success: true, message: 'Clicked' },
          };
          yield { type: 'finish', totalUsage: { promptTokens: 10, completionTokens: 5 } };
        },
      };
      streamText.mockResolvedValue({
        fullStream: asyncIterator,
      } as unknown as Awaited<ReturnType<typeof streamText>>);

await streamTask({
        provider: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Click button' }] as ModelMessage[],
        executor: mockExecutor,
        taskOrchestrator: mockTaskOrchestrator,
        config: mockConfig,
        onEvent: (event) => events.push(event),
      });

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: 'chat_stream_tool_result',
        name: 'click',
        output: { success: true, message: 'Clicked' },
      });
    });

    it('should emit finish event', async () => {
      const { streamText } = vi.mocked(await import('ai'));

      const usage = { promptTokens: 100, completionTokens: 50 };
      const asyncIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'finish', totalUsage: usage };
        },
      };
      streamText.mockResolvedValue({
        fullStream: asyncIterator,
      } as unknown as Awaited<ReturnType<typeof streamText>>);

await streamTask({
        provider: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
        executor: mockExecutor,
        taskOrchestrator: mockTaskOrchestrator,
        config: mockConfig,
        onEvent: (event) => events.push(event),
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'chat_stream_end',
        usage,
      });
    });

    it('should emit error events for stream errors', async () => {
      const { streamText } = vi.mocked(await import('ai'));

      const asyncIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'error', error: 'Stream error occurred' };
        },
      };

      streamText.mockResolvedValue({
        fullStream: asyncIterator,
      } as unknown as Awaited<ReturnType<typeof streamText>>);

await streamTask({
        provider: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
        executor: mockExecutor,
        taskOrchestrator: mockTaskOrchestrator,
        config: mockConfig,
        onEvent: (event) => events.push(event),
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'chat_stream_error',
        error: 'Stream error occurred',
      });
    });
  });

  describe('setup errors', () => {
    it('should emit error event and throw when streamText fails', async () => {
      const { streamText } = vi.mocked(await import('ai'));

      streamText.mockRejectedValue(new Error('API connection failed'));

await expect(
        streamTask({
          provider: 'test',
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
          executor: mockExecutor,
          taskOrchestrator: mockTaskOrchestrator,
          config: mockConfig,
          onEvent: (event) => events.push(event),
        })
      ).rejects.toThrow('API connection failed');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'chat_stream_error',
        error: 'Failed to start stream: API connection failed',
      });
    });

    it('should emit error event for non-Error exceptions', async () => {
      const { streamText } = vi.mocked(await import('ai'));

      streamText.mockRejectedValue('String error');

await expect(
        streamTask({
          provider: 'test',
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
          executor: mockExecutor,
          taskOrchestrator: mockTaskOrchestrator,
          config: mockConfig,
          onEvent: (event) => events.push(event),
        })
      ).rejects.toThrow('String error');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'chat_stream_error',
        error: 'Failed to start stream: String error',
      });
    });
  });

  describe('stream processing errors', () => {
    it('should handle unknown part types gracefully', async () => {
      const { streamText } = vi.mocked(await import('ai'));
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const asyncIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'unknown-type', data: 'something' };
          yield { type: 'finish', totalUsage: { promptTokens: 10, completionTokens: 5 } };
        },
      };
      streamText.mockResolvedValue({
        fullStream: asyncIterator,
      } as unknown as Awaited<ReturnType<typeof streamText>>);

await streamTask({
        provider: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
        executor: mockExecutor,
        taskOrchestrator: mockTaskOrchestrator,
        config: mockConfig,
        onEvent: (event) => events.push(event),
      });

      expect(consoleSpy).toHaveBeenCalledWith('Unknown stream part type:', 'unknown-type');
      consoleSpy.mockRestore();
    });
  });

  describe('tool creation', () => {
    it('should create core tools with executor', async () => {
      const { streamText } = vi.mocked(await import('ai'));
      const { createCoreTools } = vi.mocked(await import('../../clients/vercel-ai/core-tools.js'));

      const asyncIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'finish', totalUsage: { promptTokens: 10, completionTokens: 5 } };
        },
      };

      streamText.mockResolvedValue({
        fullStream: asyncIterator,
      } as unknown as Awaited<ReturnType<typeof streamText>>);

      await streamTask({
        provider: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
        executor: mockExecutor,
        taskOrchestrator: mockTaskOrchestrator,
        config: mockConfig,
        onEvent: (event) => events.push(event),
      });

      expect(createCoreTools).toHaveBeenCalledWith(mockExecutor);
    });

    it('should create loadSkill tool with executor and taskOrchestrator', async () => {
      const { streamText } = vi.mocked(await import('ai'));
      const { createLoadSkillTool } = vi.mocked(await import('../../clients/vercel-ai/skills-tool.js'));

      const asyncIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'finish', totalUsage: { promptTokens: 10, completionTokens: 5 } };
        },
      };

      streamText.mockResolvedValue({
        fullStream: asyncIterator,
      } as unknown as Awaited<ReturnType<typeof streamText>>);

      await streamTask({
        provider: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
        executor: mockExecutor,
        taskOrchestrator: mockTaskOrchestrator,
        config: mockConfig,
        onEvent: (event) => events.push(event),
      });

      expect(createLoadSkillTool).toHaveBeenCalledWith(mockExecutor, mockTaskOrchestrator);
    });
  });

  describe('model initialization', () => {
    it('should call getModel with provider and model', async () => {
      const { streamText } = vi.mocked(await import('ai'));
      const { getModel } = vi.mocked(await import('../../clients/vercel-ai/provider.js'));

      const asyncIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'finish', totalUsage: { promptTokens: 10, completionTokens: 5 } };
        },
      };

      streamText.mockResolvedValue({
        fullStream: asyncIterator,
      } as unknown as Awaited<ReturnType<typeof streamText>>);

      await streamTask({
        provider: 'anthropic',
        model: 'claude-3-opus',
        messages: [{ role: 'user', content: 'Hello' }] as ModelMessage[],
        executor: mockExecutor,
        taskOrchestrator: mockTaskOrchestrator,
        config: mockConfig,
        onEvent: (event) => events.push(event),
      });

      expect(getModel).toHaveBeenCalledWith(expect.any(Object), 'anthropic', 'claude-3-opus');
    });
  });

  describe('mixed event sequence', () => {
    it('should handle complex event sequence', async () => {
      const { streamText } = vi.mocked(await import('ai'));

      const asyncIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', text: 'I will ' };
          yield { type: 'text-delta', text: 'click the button.' };
          yield {
            type: 'tool-call',
            toolName: 'click',
            input: { selector: '#submit' },
          };
          yield {
            type: 'tool-result',
            toolName: 'click',
            output: { success: true },
          };
          yield { type: 'text-delta', text: 'Done!' };
          yield {
            type: 'finish',
            totalUsage: { promptTokens: 50, completionTokens: 20 },
          };
        },
      };
      streamText.mockResolvedValue({
        fullStream: asyncIterator,
      } as unknown as Awaited<ReturnType<typeof streamText>>);

      await streamTask({
        provider: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Click the button' }] as ModelMessage[],
        executor: mockExecutor,
        taskOrchestrator: mockTaskOrchestrator,
        config: mockConfig,
        onEvent: (event) => events.push(event),
      });

      expect(events).toHaveLength(6);
      expect(events[0]).toMatchObject({ type: 'chat_stream_token' });
      expect(events[1]).toMatchObject({ type: 'chat_stream_token' });
      expect(events[2]).toMatchObject({ type: 'chat_stream_tool_call', name: 'click' });
      expect(events[3]).toMatchObject({ type: 'chat_stream_tool_result', name: 'click' });
      expect(events[4]).toMatchObject({ type: 'chat_stream_token' });
      expect(events[5]).toMatchObject({ type: 'chat_stream_end' });
    });
  });
});