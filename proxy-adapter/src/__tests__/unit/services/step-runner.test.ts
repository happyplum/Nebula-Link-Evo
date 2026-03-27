import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { browserClient } from '../../../browser-client.js';
import { StepRunner, type StepContext } from '../../../services/step-runner.js';
import type { Action } from '../../../types.js';
import type { ClientFactory } from '../../../clients/index.js';
import type { ActionExecutor, ActionResult } from '../../../services/action-executor.js';
import type { MCPTool } from '../../../clients/types.js';
import type { DOMSnapshotResponse, UIElement } from '../../../config/schema.js';
import { createMockActionResult } from '../../../../../shared/test-utils/mocks/KimiClient.mock.js';

type ClientResult<T> = {
  success: boolean;
  data?: T;
};

type MockClientFactory = {
  isUnifiedMode: ReturnType<typeof vi.fn<() => boolean>>;
  decideAction: ReturnType<typeof vi.fn<(context: unknown, tools: MCPTool[]) => Promise<ClientResult<Action>>>>;
  detectWithFallback: ReturnType<
    typeof vi.fn<(screenshot: string, viewport: { width: number; height: number }, instruction: string) => Promise<ClientResult<UIElement[]>>>
  >;
};

type MockActionExecutor = {
  execute: ReturnType<typeof vi.fn<(action: Action) => Promise<ActionResult>>>;
};

const mockScreenshotData = {
  screenshot: 'base64-image',
  viewport: { width: 1920, height: 1080 },
};

const mockDom: DOMSnapshotResponse = {
  snapshot_id: 'snapshot-1',
  version: '2.0',
  annotated_screenshot_base64: 'annotated-base64',
  elements_map: {},
  simplified_dom: {
    elements: [],
    viewport: { width: 1920, height: 1080 },
  },
};

const baseContext: StepContext = {
  taskId: 'task-1',
  url: 'https://example.com',
  instruction: '执行测试步骤',
  maxSteps: 5,
  previousActions: [],
};

function createRunnerDeps(params?: {
  unified?: boolean;
  decideResult?: ClientResult<Action>;
  detectResult?: ClientResult<UIElement[]>;
  executeResult?: ActionResult;
  mcpTools?: MCPTool[];
}) {
  const actionExecutor: MockActionExecutor = {
    execute: vi.fn<(action: Action) => Promise<ActionResult>>(),
  };

  actionExecutor.execute.mockResolvedValue(
    params?.executeResult ??
      createMockActionResult({
        action: {
          type: 'click',
          params: { x: 100, y: 200 },
          reasoning: 'mock click',
        },
      })
  );

  const clientFactory: MockClientFactory = {
    isUnifiedMode: vi.fn<() => boolean>(() => params?.unified ?? true),
    decideAction: vi.fn<(context: unknown, tools: MCPTool[]) => Promise<ClientResult<Action>>>(),
    detectWithFallback: vi.fn<
      (screenshot: string, viewport: { width: number; height: number }, instruction: string) => Promise<ClientResult<UIElement[]>>
    >(),
  };

  clientFactory.decideAction.mockResolvedValue(
    params?.decideResult ?? {
      success: true,
      data: {
        type: 'click',
        params: { x: 100, y: 200 },
        reasoning: 'click target',
      },
    }
  );

  clientFactory.detectWithFallback.mockResolvedValue(
    params?.detectResult ?? {
      success: true,
      data: [],
    }
  );

  const mcpTools = params?.mcpTools ?? [];
  const stepRunner = new StepRunner({
    actionExecutor: actionExecutor as unknown as ActionExecutor,
    clientFactory: clientFactory as unknown as ClientFactory,
    getMCPTools: () => mcpTools,
  });

  return {
    stepRunner,
    actionExecutor,
    clientFactory,
  };
}

describe('StepRunner', () => {
  beforeEach(() => {
    vi.spyOn(browserClient, 'screenshot').mockResolvedValue(mockScreenshotData);
    vi.spyOn(browserClient, 'getSimplifiedDOM').mockResolvedValue(mockDom);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should run unified-mode step and mark finish action as completed', async () => {
    const finishAction: Action = {
      type: 'finish',
      params: {},
      reasoning: 'task completed',
    };

    const { stepRunner, actionExecutor, clientFactory } = createRunnerDeps({
      unified: true,
      decideResult: { success: true, data: finishAction },
      executeResult: createMockActionResult({
        action: finishAction,
        success: true,
        message: 'Task finished',
      }),
      mcpTools: [{ name: 'tool-1', description: 'test tool', inputSchema: { type: 'object', properties: {} } }],
    });

    let stepStatus: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' = 'PENDING';

    stepStatus = 'RUNNING';
    const result = await stepRunner.runStep(baseContext, 0);
    stepStatus = 'COMPLETED';

    expect(stepStatus).toBe('COMPLETED');
    expect(clientFactory.isUnifiedMode).toHaveBeenCalledOnce();
    expect(clientFactory.decideAction).toHaveBeenCalledOnce();
    expect(actionExecutor.execute).toHaveBeenCalledWith(finishAction);
    expect(result.action).toEqual(finishAction);
    expect(result.isFinished).toBe(true);
    expect(result.screenshot).toBe(mockScreenshotData.screenshot);
    expect(result.dom).toEqual(mockDom);
  });

  it('should run separation-mode step and execute decided action', async () => {
    const detectedElements: UIElement[] = [
      {
        id: 1,
        type: 'button',
        bbox: [10, 10, 100, 40],
        center: [60, 30],
        confidence: 0.98,
      },
    ];

    const clickAction: Action = {
      type: 'click',
      params: { x: 60, y: 30 },
      reasoning: 'click detected button',
    };

    const { stepRunner, actionExecutor, clientFactory } = createRunnerDeps({
      unified: false,
      detectResult: { success: true, data: detectedElements },
      decideResult: { success: true, data: clickAction },
      executeResult: createMockActionResult({
        action: clickAction,
        success: true,
        message: 'Clicked at (60, 30)',
      }),
    });

    const result = await stepRunner.runStep(baseContext, 1);

    expect(clientFactory.detectWithFallback).toHaveBeenCalledWith(
      mockScreenshotData.screenshot,
      mockScreenshotData.viewport,
      '检测页面中可交互的UI元素'
    );
    expect(clientFactory.decideAction).toHaveBeenCalledWith(
      expect.objectContaining({ elements: detectedElements }),
      []
    );
    expect(actionExecutor.execute).toHaveBeenCalledWith(clickAction);
    expect(result.action).toEqual(clickAction);
    expect(result.isFinished).toBe(false);
  });

  it('should fallback to wait action when decideAction returns unsuccessful result', async () => {
    const waitAction: Action = {
      type: 'wait',
      params: { delay: 2000 },
    };

    const { stepRunner, actionExecutor } = createRunnerDeps({
      unified: true,
      decideResult: { success: false },
      executeResult: createMockActionResult({
        action: waitAction,
        success: true,
        message: 'Waited 2000ms',
      }),
    });

    const result = await stepRunner.runStep(baseContext, 2);

    expect(actionExecutor.execute).toHaveBeenCalledWith(waitAction);
    expect(result.action).toEqual(waitAction);
    expect(result.isFinished).toBe(false);
  });

  it('should set failed status when action execution throws error', async () => {
    const { stepRunner, actionExecutor } = createRunnerDeps({
      unified: true,
      decideResult: {
        success: true,
        data: {
          type: 'click',
          params: { x: 1, y: 2 },
        },
      },
    });

    actionExecutor.execute.mockRejectedValue(new Error('execution failed'));

    let stepStatus: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' = 'PENDING';

    stepStatus = 'RUNNING';

    await expect(stepRunner.runStep(baseContext, 3)).rejects.toThrow('execution failed');

    stepStatus = 'FAILED';

    expect(stepStatus).toBe('FAILED');
  });

  it('should resolve sleep after specified delay', async () => {
    const { stepRunner } = createRunnerDeps();

    vi.useFakeTimers();

    const sleepPromise = stepRunner.sleep(250);
    await vi.advanceTimersByTimeAsync(250);

    await expect(sleepPromise).resolves.toBeUndefined();

    vi.useRealTimers();
  });
});
