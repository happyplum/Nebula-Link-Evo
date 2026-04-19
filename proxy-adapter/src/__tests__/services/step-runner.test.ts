import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DOMSnapshotResponse } from '../../config/schema.js';
import type { MCPTool } from '../../clients/types.js';
import type { ActionExecutor } from '../../services/action-executor.js';
import { StepRunner } from '../../services/step-runner.js';

const {
  mockStreamText,
  mockTool,
  mockCreateVisionTool,
  mockResolveSessionModels,
  mockScreenshot,
  mockGetSimplifiedDOM,
  mockExecute,
  mockGetMCPTools,
} = vi.hoisted(() => ({
  mockStreamText: vi.fn(),
  mockTool: vi.fn((definition: unknown) => definition),
  mockCreateVisionTool: vi.fn(),
  mockResolveSessionModels: vi.fn(),
  mockScreenshot: vi.fn(),
  mockGetSimplifiedDOM: vi.fn(),
  mockExecute: vi.fn(),
  mockGetMCPTools: vi.fn(),
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai');
  return {
    ...actual,
    streamText: mockStreamText,
    tool: mockTool,
  };
});

vi.mock('../../services/provider/resolver.js', () => ({
  resolveSessionModels: mockResolveSessionModels,
}));

vi.mock('../../services/provider/vision-tool.js', () => ({
  createVisionTool: mockCreateVisionTool,
}));

vi.mock('../../browser-client.js', () => ({
  browserClient: {
    screenshot: mockScreenshot,
    getSimplifiedDOM: mockGetSimplifiedDOM,
  },
}));

function createMockLanguageModel(name: string): LanguageModelV3 {
  return {
    specificationVersion: 'v2',
    provider: 'test-provider',
    modelId: name,
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as unknown as LanguageModelV3;
}

function createStreamResult(text: string) {
  return {
    fullStream: (async function* () {
      yield { type: 'text-delta', text };
      yield { type: 'finish' };
    })(),
  };
}

describe('StepRunner', () => {
  const actionExecutor = {
    execute: mockExecute,
  };

  const registry = {
    resolve: vi.fn(),
  };

  const defaults = {
    decision: 'test-provider/test-model',
    vision: 'test-provider/test-vision-model',
  };

  const getMCPTools = mockGetMCPTools;

  const defaultContext = {
    taskId: 'test-task-123',
    url: 'https://example.com',
    instruction: 'test instruction',
    maxSteps: 5,
    previousActions: [],
    session: {
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
      vision_provider: 'openai',
      vision_model: 'gpt-4.1-mini',
    },
  };

  const mockDom: DOMSnapshotResponse = {
    snapshot_id: 'test-snapshot-123',
    version: '2.0',
    annotated_screenshot_base64: 'base64-annotated-image',
    elements_map: {},
    simplified_dom: {
      elements: [],
      viewport: { width: 1920, height: 1080 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreenshot.mockResolvedValue({
      screenshot: 'base64-image-data',
      viewport: { width: 1920, height: 1080 },
    });

    mockGetSimplifiedDOM.mockResolvedValue(mockDom);

    mockResolveSessionModels.mockResolvedValue({
      decision: createMockLanguageModel('decision-model'),
      vision: createMockLanguageModel('vision-model'),
    });

    mockCreateVisionTool.mockReturnValue({
      description: 'mock vision tool',
      inputSchema: {},
      execute: vi.fn(),
    });

    mockExecute.mockImplementation(async (action) => ({
      action,
      success: true,
      message: 'ok',
    }));

    mockGetMCPTools.mockReturnValue([]);
  });

  describe('runStep in unified mode', () => {
    it('should execute step successfully and return action', async () => {
      mockStreamText.mockResolvedValue(
        createStreamResult('{"type":"click","params":{"x":100,"y":200}}'),
      );

      const runner = new StepRunner({
        actionExecutor: actionExecutor as never as ActionExecutor,
        registry: registry as never,
        defaults,
        getMCPTools,
      });

      const result = await runner.runStep(defaultContext, 0);

      expect(mockResolveSessionModels).toHaveBeenCalledWith(defaultContext.session, registry, defaults);
      expect(mockStreamText).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith({ type: 'click', params: { x: 100, y: 200 }, reasoning: undefined });
      expect(result).toEqual({
        action: { type: 'click', params: { x: 100, y: 200 }, reasoning: undefined },
        result: { action: { type: 'click', params: { x: 100, y: 200 }, reasoning: undefined }, success: true, message: 'ok' },
        screenshot: 'base64-image-data',
        dom: mockDom,
        isFinished: false,
      });
    });

    it('should fallback to wait action if decideAction fails', async () => {
      mockStreamText.mockResolvedValue(createStreamResult('not-json'));

      const runner = new StepRunner({
        actionExecutor: actionExecutor as never as ActionExecutor,
        registry: registry as never,
        defaults,
        getMCPTools,
      });

      const result = await runner.runStep(defaultContext, 0);

      expect(mockExecute).toHaveBeenCalledWith({ type: 'wait', params: { delay: 2000 } });
      expect(result.action).toEqual({ type: 'wait', params: { delay: 2000 } });
      expect(result.isFinished).toBe(false);
    });

    it('should pass MCP tools to decideAction if available', async () => {
      const mcpTools: MCPTool[] = [
        {
          name: 'test-tool',
          description: 'test tool',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
          },
        },
      ];
      mockGetMCPTools.mockReturnValue(mcpTools);
      mockStreamText.mockResolvedValue(createStreamResult('{"type":"finish","params":{}}'));

      const runner = new StepRunner({
        actionExecutor: actionExecutor as never as ActionExecutor,
        registry: registry as never,
        defaults,
        getMCPTools,
      });

      const result = await runner.runStep(defaultContext, 0);

      const streamArgs = mockStreamText.mock.calls[0]?.[0] as {
        tools: Record<string, unknown>;
      };

      expect(streamArgs.tools).toHaveProperty('test-tool');
      expect(streamArgs.tools).toHaveProperty('analyze_page');
      expect(mockTool).toHaveBeenCalled();
      expect(result.isFinished).toBe(true);
    });
  });

  describe('runStep in non-unified mode', () => {
    it('should detect elements and then decide action', async () => {
      mockStreamText.mockResolvedValue(createStreamResult('{"type":"type","params":{"text":"hello"}}'));

      const runner = new StepRunner({
        actionExecutor: actionExecutor as never as ActionExecutor,
        registry: registry as never,
        defaults,
        getMCPTools,
      });

      const result = await runner.runStep(defaultContext, 0);

      expect(mockScreenshot).toHaveBeenCalledTimes(1);
      expect(mockGetSimplifiedDOM).toHaveBeenCalledTimes(1);
      expect(mockCreateVisionTool).toHaveBeenCalledTimes(1);

      const visionToolArgs = mockCreateVisionTool.mock.calls[0];
      const screenshotFn = visionToolArgs?.[1] as (() => Promise<{ screenshot: Buffer; viewport: { width: number; height: number } }>) | undefined;
      expect(screenshotFn).toBeTypeOf('function');

      const streamArgs = mockStreamText.mock.calls[0]?.[0] as {
        messages: Array<{ role: string; content: string }>;
        tools: Record<string, unknown>;
      };
      expect(streamArgs.tools).toHaveProperty('analyze_page');

      const userMessage = streamArgs.messages[1];
      expect(userMessage?.role).toBe('user');
      expect(JSON.parse(userMessage?.content ?? '')).toEqual({
        taskId: defaultContext.taskId,
        url: defaultContext.url,
        instruction: defaultContext.instruction,
        step: 1,
        maxSteps: defaultContext.maxSteps,
        previousActions: defaultContext.previousActions,
        dom: mockDom,
      });

      expect(result.action).toEqual({ type: 'type', params: { text: 'hello' }, reasoning: undefined });
    });

    it('should proceed with empty elements if detect fails', async () => {
      mockStreamText.mockResolvedValue(createStreamResult('{"type":"scroll","params":{"direction":"down"}}'));

      const runner = new StepRunner({
        actionExecutor: actionExecutor as never as ActionExecutor,
        registry: registry as never,
        defaults,
        getMCPTools,
      });

      const result = await runner.runStep(defaultContext, 0);

      const streamArgs = mockStreamText.mock.calls[0]?.[0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const userPayload = JSON.parse(streamArgs.messages[1]?.content ?? 'null') as { dom: DOMSnapshotResponse };

      expect(userPayload.dom.simplified_dom.elements).toEqual([]);
      expect(result.action).toEqual({ type: 'scroll', params: { direction: 'down' }, reasoning: undefined });
      expect(result.dom).toEqual(mockDom);
    });

    it('should fallback to wait action if decideAction fails in non-unified mode', async () => {
      mockStreamText.mockResolvedValue(createStreamResult('{"type":"click"}'));

      const runner = new StepRunner({
        actionExecutor: actionExecutor as never as ActionExecutor,
        registry: registry as never,
        defaults,
        getMCPTools,
      });

      const result = await runner.runStep(defaultContext, 0);

      expect(mockExecute).toHaveBeenCalledWith({ type: 'wait', params: { delay: 2000 } });
      expect(result.action).toEqual({ type: 'wait', params: { delay: 2000 } });
      expect(result.isFinished).toBe(false);
    });
  });

  describe('sleep', () => {
    it('should resolve after specified time', async () => {
      const runner = new StepRunner({
        actionExecutor: actionExecutor as never as ActionExecutor,
        registry: registry as never,
        defaults,
        getMCPTools,
      });

      vi.useFakeTimers();
      const sleepPromise = runner.sleep(1000);

      vi.advanceTimersByTime(1000);
      await expect(sleepPromise).resolves.toBeUndefined();

      vi.useRealTimers();
    });
  });
});
