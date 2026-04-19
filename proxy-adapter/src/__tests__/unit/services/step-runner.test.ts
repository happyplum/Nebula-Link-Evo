import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { browserClient } from '../../../browser-client.js';
import { StepRunner, type StepContext } from '../../../services/step-runner.js';
import type { ActionExecutor, ActionResult } from '../../../services/action-executor.js';
import type { ProviderRegistry } from '../../../services/provider/registry.js';

const { streamTextMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    streamText: streamTextMock,
  };
});

function streamParts(parts: Array<Record<string, unknown>>): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) {
        yield part;
      }
    },
  };
}

describe('StepRunner', () => {
  const mockContext: StepContext = {
    taskId: 'task-1',
    url: 'https://example.com',
    instruction: 'test',
    maxSteps: 5,
    previousActions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(browserClient, 'screenshot').mockResolvedValue({
      screenshot: 'base64',
      viewport: { width: 1280, height: 720 },
    });
    vi.spyOn(browserClient, 'getSimplifiedDOM').mockResolvedValue({
      snapshot_id: 'snapshot-1',
      version: '2.0',
      annotated_screenshot_base64: '',
      elements_map: {},
      simplified_dom: { elements: [], viewport: { width: 1280, height: 720 } },
    });
  });

  it('executes finish action from streamed JSON', async () => {
    const execute = vi.fn<(action: unknown) => Promise<ActionResult>>().mockResolvedValue({
      action: { type: 'finish', params: {} },
      success: true,
      message: 'done',
    });

    const registry = {
      resolve: vi.fn().mockResolvedValue({ provider: 'test-provider', modelId: 'test-model' }),
    } as unknown as ProviderRegistry;

    streamTextMock.mockResolvedValue({
      fullStream: streamParts([
        { type: 'text-delta', text: '{"type":"finish","params":{},"reasoning":"done"}' },
      ]),
    });

    const runner = new StepRunner({
      actionExecutor: { execute } as unknown as ActionExecutor,
      registry,
      defaults: { decision: 'test-provider/test-model', vision: 'test-provider/test-model' },
      getMCPTools: () => [],
    });

    const result = await runner.runStep(mockContext, 0);

    expect(result.action.type).toBe('finish');
    expect(result.isFinished).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(registry.resolve).toHaveBeenCalled();
  });

  it('falls back to wait when streamed output is invalid JSON', async () => {
    const execute = vi.fn<(action: unknown) => Promise<ActionResult>>().mockResolvedValue({
      action: { type: 'wait', params: { delay: 2000 } },
      success: true,
      message: 'wait',
    });

    const registry = {
      resolve: vi.fn().mockResolvedValue({ provider: 'test-provider', modelId: 'test-model' } as LanguageModelV3),
    } as unknown as ProviderRegistry;

    streamTextMock.mockResolvedValue({
      fullStream: streamParts([{ type: 'text-delta', text: 'invalid-json' }]),
    });

    const runner = new StepRunner({
      actionExecutor: { execute } as unknown as ActionExecutor,
      registry,
      defaults: { decision: 'test-provider/test-model', vision: 'test-provider/test-model' },
      getMCPTools: () => [],
    });

    const result = await runner.runStep(mockContext, 1);

    expect(result.action.type).toBe('wait');
    expect(result.isFinished).toBe(false);
    expect(execute).toHaveBeenCalledOnce();
  });
});
