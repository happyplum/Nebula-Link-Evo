import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../types.js';
import type { UIElement, DOMSnapshotResponse } from '../../config/schema.js';
import type { MCPTool } from '../../clients/types.js';

const {
  mockScreenshot,
  mockGetSimplifiedDOM,
  mockIsUnifiedMode,
  mockDecideAction,
  mockDetectWithFallback,
  mockExecute,
  mockGetMCPTools,
} = vi.hoisted(() => ({
  mockScreenshot: vi.fn(),
  mockGetSimplifiedDOM: vi.fn(),
  mockIsUnifiedMode: vi.fn(),
  mockDecideAction: vi.fn(),
  mockDetectWithFallback: vi.fn(),
  mockExecute: vi.fn(),
  mockGetMCPTools: vi.fn(),
}));

vi.mock('../../browser-client.js', () => ({
  browserClient: {
    screenshot: mockScreenshot,
    getSimplifiedDOM: mockGetSimplifiedDOM,
  },
}));

import { StepRunner } from '../../services/step-runner.js';

describe('StepRunner', () => {
  const actionExecutor = {
    execute: mockExecute,
  };

  const clientFactory = {
    isUnifiedMode: mockIsUnifiedMode,
    decideAction: mockDecideAction,
    detectWithFallback: mockDetectWithFallback,
  };

  const getMCPTools = mockGetMCPTools;

  const defaultContext = {
    taskId: 'test-task-123',
    url: 'https://example.com',
    instruction: 'test instruction',
    maxSteps: 5,
    previousActions: [],
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

    mockExecute.mockResolvedValue({
      action: { type: 'wait', params: { delay: 100 } },
      success: true,
      message: 'ok',
    });

    mockGetMCPTools.mockReturnValue([]);
  });

  describe('runStep in unified mode', () => {
    beforeEach(() => {
      mockIsUnifiedMode.mockReturnValue(true);
    });

    it('should execute step successfully and return action', async () => {
      const runner = new StepRunner({
        actionExecutor: actionExecutor as never,
        clientFactory: clientFactory as never,
        getMCPTools,
      });

      const expectedAction: Action = { type: 'click', params: { x: 100, y: 200 } };
      mockDecideAction.mockResolvedValue({
        success: true,
        data: expectedAction,
      });

      const result = await runner.runStep(defaultContext, 0);

      expect(mockScreenshot).toHaveBeenCalledTimes(1);
      expect(mockGetSimplifiedDOM).toHaveBeenCalledTimes(1);
      expect(mockIsUnifiedMode).toHaveBeenCalledTimes(1);
      expect(mockDecideAction).toHaveBeenCalledWith(
        {
          screenshot: 'base64-image-data',
          dom: mockDom,
          elements: [],
          instruction: defaultContext.instruction,
          previousActions: defaultContext.previousActions,
        },
        []
      );
      expect(mockExecute).toHaveBeenCalledWith(expectedAction);

      expect(result.action).toEqual(expectedAction);
      expect(result.screenshot).toBe('base64-image-data');
      expect(result.dom).toEqual(mockDom);
      expect(result.isFinished).toBe(false);
    });

    it('should fallback to wait action if decideAction fails', async () => {
      const runner = new StepRunner({
        actionExecutor: actionExecutor as never,
        clientFactory: clientFactory as never,
        getMCPTools,
      });

      mockDecideAction.mockResolvedValue({
        success: false,
        error: 'AI failed',
      });

      const result = await runner.runStep(defaultContext, 0);

      expect(mockDecideAction).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith({ type: 'wait', params: { delay: 2000 } });
      expect(result.action).toEqual({ type: 'wait', params: { delay: 2000 } });
      expect(result.isFinished).toBe(false);
    });

    it('should pass MCP tools to decideAction if available', async () => {
      const runner = new StepRunner({
        actionExecutor: actionExecutor as never,
        clientFactory: clientFactory as never,
        getMCPTools,
      });

      const mcpTools: MCPTool[] = [{ name: 'test-tool', description: 'test', inputSchema: {} }];
      mockGetMCPTools.mockReturnValue(mcpTools);

      mockDecideAction.mockResolvedValue({
        success: true,
        data: { type: 'finish', params: {} },
      });

      const result = await runner.runStep(defaultContext, 0);

      expect(mockDecideAction).toHaveBeenCalledWith(
        expect.any(Object),
        mcpTools
      );
      expect(result.isFinished).toBe(true);
    });
  });

  describe('runStep in non-unified mode', () => {
    beforeEach(() => {
      mockIsUnifiedMode.mockReturnValue(false);
    });

    it('should detect elements and then decide action', async () => {
      const runner = new StepRunner({
        actionExecutor: actionExecutor as never,
        clientFactory: clientFactory as never,
        getMCPTools,
      });

      const mockElements: UIElement[] = [
        { id: 1, type: 'button', bbox: [0, 0, 10, 10], center: [5, 5], confidence: 0.9 },
      ];

      mockDetectWithFallback.mockResolvedValue({
        success: true,
        data: mockElements,
      });

      const expectedAction: Action = { type: 'type', params: { text: 'hello' } };
      mockDecideAction.mockResolvedValue({
        success: true,
        data: expectedAction,
      });

      const result = await runner.runStep(defaultContext, 0);

      expect(mockDetectWithFallback).toHaveBeenCalledWith(
        'base64-image-data',
        { width: 1920, height: 1080 },
        '检测页面中可交互的UI元素'
      );

      expect(mockDecideAction).toHaveBeenCalledWith(
        {
          screenshot: 'base64-image-data',
          dom: mockDom,
          elements: mockElements,
          instruction: defaultContext.instruction,
          previousActions: defaultContext.previousActions,
        },
        []
      );

      expect(mockExecute).toHaveBeenCalledWith(expectedAction);
      expect(result.action).toEqual(expectedAction);
    });

    it('should proceed with empty elements if detect fails', async () => {
      const runner = new StepRunner({
        actionExecutor: actionExecutor as never,
        clientFactory: clientFactory as never,
        getMCPTools,
      });

      mockDetectWithFallback.mockResolvedValue({
        success: false,
        error: 'Vision failed',
      });

      const expectedAction: Action = { type: 'scroll', params: { direction: 'down' } };
      mockDecideAction.mockResolvedValue({
        success: true,
        data: expectedAction,
      });

      const result = await runner.runStep(defaultContext, 0);

      expect(mockDetectWithFallback).toHaveBeenCalledTimes(1);
      expect(mockDecideAction).toHaveBeenCalledWith(
        expect.objectContaining({ elements: [] }),
        []
      );
      expect(result.action).toEqual(expectedAction);
    });

    it('should fallback to wait action if decideAction fails in non-unified mode', async () => {
      const runner = new StepRunner({
        actionExecutor: actionExecutor as never,
        clientFactory: clientFactory as never,
        getMCPTools,
      });

      mockDetectWithFallback.mockResolvedValue({
        success: true,
        data: [],
      });

      mockDecideAction.mockResolvedValue({
        success: false,
        error: 'AI failed',
      });

      const result = await runner.runStep(defaultContext, 0);

      expect(mockDecideAction).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith({ type: 'wait', params: { delay: 2000 } });
      expect(result.action).toEqual({ type: 'wait', params: { delay: 2000 } });
      expect(result.isFinished).toBe(false);
    });
  });

  describe('sleep', () => {
    it('should resolve after specified time', async () => {
      const runner = new StepRunner({
        actionExecutor: actionExecutor as never,
        clientFactory: clientFactory as never,
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
