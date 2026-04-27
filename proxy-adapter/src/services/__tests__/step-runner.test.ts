import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  createWorkerLogger: vi.fn(() => mockLogger),
}));

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DOMSnapshotResponse } from '../../config/schema.js';
import type { ActionExecutor, ActionResult } from '../action-executor.js';
import { StepRunner, type StepContext, type ConfigDefaults } from '../step-runner.js';

const {
  mockStreamText,
  mockTool,
  mockCreateVisionTool,
  mockResolveSessionModels,
  mockScreenshot,
  mockGetSimplifiedDOM,
} = vi.hoisted(() => ({
  mockStreamText: vi.fn(),
  mockTool: vi.fn((definition: unknown) => definition),
  mockCreateVisionTool: vi.fn(),
  mockResolveSessionModels: vi.fn(),
  mockScreenshot: vi.fn(),
  mockGetSimplifiedDOM: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: mockStreamText,
    tool: mockTool,
  };
});

vi.mock('../provider/vision-tool.js', () => ({
  createVisionTool: mockCreateVisionTool,
}));

vi.mock('../provider/resolver.js', () => ({
  resolveSessionModels: mockResolveSessionModels,
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
    provider: 'mock-provider',
    modelId: name,
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as unknown as LanguageModelV3;
}

function createStreamResult(parts: Array<{ type: string; [key: string]: unknown }>) {
  return {
    fullStream: (async function* () {
      for (const part of parts) {
        yield part;
      }
    })(),
  };
}

describe('StepRunner (single streamText flow)', () => {
  const defaults: ConfigDefaults = {
    decision: 'glm/glm-4.7-flash',
    vision: 'openai/gpt-4.1-mini',
  };

  const mockDom: DOMSnapshotResponse = {
    snapshot_id: 'snapshot-1',
    version: '2.0',
    annotated_screenshot_base64: 'annotated',
    elements_map: {},
    simplified_dom: {
      elements: [],
      viewport: { width: 1280, height: 720 },
    },
  };

  const baseContext: StepContext = {
    taskId: 'task-1',
    url: 'https://example.com',
    instruction: 'Click login button',
    maxSteps: 5,
    previousActions: [],
    session: {
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
      vision_provider: 'openai',
      vision_model: 'gpt-4.1-mini',
    },
  };

  const actionExecutor: Pick<ActionExecutor, 'execute'> = {
    execute: vi.fn(),
  };

  const registry = {
    resolve: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreenshot.mockResolvedValue({
      screenshot: 'ZmFrZS1iYXNlNjQ=',
      viewport: { width: 1280, height: 720 },
    });
    mockGetSimplifiedDOM.mockResolvedValue(mockDom);

    const decisionModel = createMockLanguageModel('decision-model');
    const visionModel = createMockLanguageModel('vision-model');
    mockResolveSessionModels.mockResolvedValue({
      decision: decisionModel,
      vision: visionModel,
    });

    mockCreateVisionTool.mockReturnValue({
      description: 'mock vision tool',
      inputSchema: {},
      execute: vi.fn(),
    });

    (actionExecutor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      action: { type: 'click', params: { x: 100, y: 200 } },
      success: true,
      message: 'ok',
    } satisfies ActionResult);
  });

  it('logs metadata with phase, provider, model, and runId after streamText completes', async () => {
    mockStreamText.mockResolvedValue(
      createStreamResult([
        {
          type: 'text-delta',
          text: '{"type":"click","params":{"x":100,"y":200},"reasoning":"targeted click"}',
        },
        { type: 'finish' },
      ]),
    );

    const runner = new StepRunner({
      actionExecutor: actionExecutor as ActionExecutor,
      registry: registry as never,
      defaults,
      getMCPTools: () => [],
    });

    await runner.runStep(baseContext, 0);

    expect(mockLogger.info).toHaveBeenCalledWith(
      {
        phase: 'decision',
        provider: 'mock-provider',
        model: 'decision-model',
        runId: 'task-1',
      },
      'Decision phase'
    );
  });

  it('runs one streamText call, resolves session models, and executes parsed action', async () => {
    mockStreamText.mockResolvedValue(
      createStreamResult([
        {
          type: 'text-delta',
          text: '{"type":"click","params":{"x":100,"y":200},"reasoning":"targeted click"}',
        },
        { type: 'finish' },
      ]),
    );

    const runner = new StepRunner({
      actionExecutor: actionExecutor as ActionExecutor,
      registry: registry as never,
      defaults,
      getMCPTools: () => [],
    });

    const result = await runner.runStep(baseContext, 0);

    expect(mockResolveSessionModels).toHaveBeenCalledWith(baseContext.session, registry, defaults);
    expect(mockCreateVisionTool).toHaveBeenCalledTimes(1);
    expect(mockStreamText).toHaveBeenCalledTimes(1);

    const streamTextArgs = mockStreamText.mock.calls[0]?.[0] as {
      maxSteps: number;
      tools: Record<string, unknown>;
    };
    expect(streamTextArgs.maxSteps).toBe(10);
    expect(streamTextArgs.tools).toHaveProperty('analyze_page');

    expect(actionExecutor.execute).toHaveBeenCalledWith({
      type: 'click',
      params: { x: 100, y: 200 },
      reasoning: 'targeted click',
    });

    expect(result).toEqual({
      action: { type: 'click', params: { x: 100, y: 200 }, reasoning: 'targeted click' },
      result: { action: { type: 'click', params: { x: 100, y: 200 } }, success: true, message: 'ok' },
      screenshot: 'ZmFrZS1iYXNlNjQ=',
      dom: mockDom,
      isFinished: false,
    });
  });

  it('uses wait fallback when stream output is not valid action JSON', async () => {
    mockStreamText.mockResolvedValue(
      createStreamResult([
        { type: 'text-delta', text: 'not-json' },
        { type: 'finish' },
      ]),
    );

    (actionExecutor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      action: { type: 'wait', params: { delay: 2000 } },
      success: true,
      message: 'waited',
    } satisfies ActionResult);

    const runner = new StepRunner({
      actionExecutor: actionExecutor as ActionExecutor,
      registry: registry as never,
      defaults,
      getMCPTools: () => [],
    });

    const result = await runner.runStep(baseContext, 1);

    expect(actionExecutor.execute).toHaveBeenCalledWith({ type: 'wait', params: { delay: 2000 } });
    expect(result.action).toEqual({ type: 'wait', params: { delay: 2000 } });
    expect(result.isFinished).toBe(false);
  });

  it('builds vision tool with screenshot function that calls browserClient.screenshot', async () => {
    mockStreamText.mockResolvedValue(
      createStreamResult([
        { type: 'text-delta', text: '{"type":"finish","params":{}}' },
        { type: 'finish' },
      ]),
    );

    const runner = new StepRunner({
      actionExecutor: actionExecutor as ActionExecutor,
      registry: registry as never,
      defaults,
      getMCPTools: () => [],
    });

    await runner.runStep(baseContext, 2);

    const visionToolArgs = mockCreateVisionTool.mock.calls[0];
    const screenshotFn = visionToolArgs?.[1] as (() => Promise<{ screenshot: Buffer; viewport: { width: number; height: number } }>) | undefined;

    expect(screenshotFn).toBeTypeOf('function');

    await screenshotFn?.();
    expect(mockScreenshot).toHaveBeenCalledTimes(2);
  });
});
