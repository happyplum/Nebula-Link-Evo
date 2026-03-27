import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../types.js';

const {
  mockClick,
  mockClickByMarker,
  mockClickBySelector,
  mockType,
  mockTypeByMarker,
  mockFocus,
  mockFocusByMarker,
  mockBlur,
  mockBlurByMarker,
  mockHover,
  mockHoverByMarker,
  mockSetValue,
  mockSetValueByMarker,
  mockDispatchEvent,
  mockDispatchEventByMarker,
  mockScroll,
  mockNavigate,
  mockScreenshot,
  mockGetStatus,
} = vi.hoisted(() => ({
  mockClick: vi.fn(),
  mockClickByMarker: vi.fn(),
  mockClickBySelector: vi.fn(),
  mockType: vi.fn(),
  mockTypeByMarker: vi.fn(),
  mockFocus: vi.fn(),
  mockFocusByMarker: vi.fn(),
  mockBlur: vi.fn(),
  mockBlurByMarker: vi.fn(),
  mockHover: vi.fn(),
  mockHoverByMarker: vi.fn(),
  mockSetValue: vi.fn(),
  mockSetValueByMarker: vi.fn(),
  mockDispatchEvent: vi.fn(),
  mockDispatchEventByMarker: vi.fn(),
  mockScroll: vi.fn(),
  mockNavigate: vi.fn(),
  mockScreenshot: vi.fn(),
  mockGetStatus: vi.fn(),
}));

vi.mock('../../browser-client.js', () => ({
  browserClient: {
    click: mockClick,
    clickByMarker: mockClickByMarker,
    clickBySelector: mockClickBySelector,
    type: mockType,
    typeByMarker: mockTypeByMarker,
    focus: mockFocus,
    focusByMarker: mockFocusByMarker,
    blur: mockBlur,
    blurByMarker: mockBlurByMarker,
    hover: mockHover,
    hoverByMarker: mockHoverByMarker,
    setValue: mockSetValue,
    setValueByMarker: mockSetValueByMarker,
    dispatchEvent: mockDispatchEvent,
    dispatchEventByMarker: mockDispatchEventByMarker,
    scroll: mockScroll,
    navigate: mockNavigate,
    screenshot: mockScreenshot,
    getStatus: mockGetStatus,
  },
}));

const { mockLog } = vi.hoisted(() => ({
  mockLog: vi.fn(),
}));

vi.mock('../../services/interaction-logger.js', () => ({
  interactionLogger: {
    log: mockLog,
  },
}));

const { mockSaveFailureSample } = vi.hoisted(() => ({
  mockSaveFailureSample: vi.fn(),
}));

vi.mock('../../services/failure-sample-collector.js', () => ({
  failureSampleCollector: {
    saveFailureSample: mockSaveFailureSample,
  },
}));

import { ActionExecutor, resolveClickAction, resolveTypeAction, resolveTargetAction, resolveValueAction, resolveDispatchAction, resolveScrollAction, resolveNavigateAction, resolveWaitAction, resolveMCPCallAction } from '../../services/action-executor.js';

describe('ActionExecutor', () => {
  let executor: ActionExecutor;
  const mockMcpClient = {
    callTool: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatus.mockResolvedValue({ url: 'https://example.com' });
    mockLog.mockResolvedValue(undefined);
    mockSaveFailureSample.mockResolvedValue('path/to/sample');
    
    executor = new ActionExecutor({
      mcpClient: mockMcpClient as any,
    });
  });

  describe('Pure Functions', () => {
    describe('resolveTargetAction', () => {
      it('should resolve marker target', () => {
        const action: Action = { type: 'focus', params: { resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } } };
        expect(resolveTargetAction(action, 'focus')).toEqual({ type: 'marker', snapshotId: 'snap1', nebulaId: 42 });
      });

      it('should resolve selector target', () => {
        const action: Action = { type: 'focus', params: { selector: '#btn' } };
        expect(resolveTargetAction(action, 'focus')).toEqual({ type: 'selector', selector: '#btn' });
      });

      it('should throw if marker missing snapshot_id', () => {
        const action: Action = { type: 'focus', params: { resolved_target: { type: 'marker', nebula_id: 42 } } };
        expect(() => resolveTargetAction(action, 'focus')).toThrow('Marker focus action requires snapshot_id and nebula_id/target_id');
      });

      it('should throw if selector missing', () => {
        const action: Action = { type: 'focus', params: { resolved_target: { type: 'selector' } } };
        expect(() => resolveTargetAction(action, 'focus')).toThrow('Selector focus action requires selector');
      });

      it('should throw if no target provided', () => {
        const action: Action = { type: 'focus', params: {} };
        expect(() => resolveTargetAction(action, 'focus')).toThrow('Focus action requires selector');
      });
    });

    describe('resolveClickAction', () => {
      it('should resolve coordinates', () => {
        const action: Action = { type: 'click', params: { x: 10, y: 20 } };
        expect(resolveClickAction(action)).toEqual({ type: 'coordinates', x: 10, y: 20 });
      });

      it('should resolve marker', () => {
        const action: Action = { type: 'click', params: { resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } } };
        expect(resolveClickAction(action)).toEqual({ type: 'marker', snapshotId: 'snap1', nebulaId: 42 });
      });

      it('should throw specific error if no target', () => {
        const action: Action = { type: 'click', params: {} };
        expect(() => resolveClickAction(action)).toThrow('Click action requires x,y, marker target, or selector');
      });
    });

    describe('resolveTypeAction', () => {
      it('should resolve marker with text', () => {
        const action: Action = { type: 'type', params: { text: 'hello', resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } } };
        expect(resolveTypeAction(action)).toEqual({ type: 'marker', snapshotId: 'snap1', nebulaId: 42, text: 'hello' });
      });

      it('should throw if selector missing text', () => {
        const action: Action = { type: 'type', params: { selector: '#input' } };
        expect(() => resolveTypeAction(action)).toThrow('Type action requires selector and text');
      });
    });

    describe('resolveValueAction', () => {
      it('should resolve marker with value', () => {
        const action: Action = { type: 'value', params: { value: 'hello', resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } } };
        expect(resolveValueAction(action)).toEqual({ type: 'marker', snapshotId: 'snap1', nebulaId: 42, value: 'hello' });
      });
    });

    describe('resolveDispatchAction', () => {
      it('should resolve marker with eventType', () => {
        const action: Action = { type: 'dispatch', params: { eventType: 'click', resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } } };
        expect(resolveDispatchAction(action)).toEqual({ type: 'marker', snapshotId: 'snap1', nebulaId: 42, eventType: 'click' });
      });

      it('should throw if selector missing eventType', () => {
        const action: Action = { type: 'dispatch', params: { selector: '#input' } };
        expect(() => resolveDispatchAction(action)).toThrow('Dispatch action requires selector and eventType');
      });
    });

    describe('resolveScrollAction', () => {
      it('should resolve x and y', () => {
        const action: Action = { type: 'scroll', params: { x: 10, y: 20 } };
        expect(resolveScrollAction(action)).toEqual({ x: 10, y: 20 });
      });

      it('should default to 0', () => {
        const action: Action = { type: 'scroll', params: {} };
        expect(resolveScrollAction(action)).toEqual({ x: 0, y: 0 });
      });
    });

    describe('resolveNavigateAction', () => {
      it('should resolve url', () => {
        const action: Action = { type: 'navigate', params: { url: 'https://example.com' } };
        expect(resolveNavigateAction(action)).toEqual({ url: 'https://example.com' });
      });

      it('should throw if url missing', () => {
        const action: Action = { type: 'navigate', params: {} };
        expect(() => resolveNavigateAction(action)).toThrow('Navigate action requires url');
      });
    });

    describe('resolveWaitAction', () => {
      it('should resolve delay', () => {
        const action: Action = { type: 'wait', params: { delay: 500 } };
        expect(resolveWaitAction(action)).toEqual({ delay: 500 });
      });

      it('should default to 1000', () => {
        const action: Action = { type: 'wait', params: {} };
        expect(resolveWaitAction(action)).toEqual({ delay: 1000 });
      });
    });

    describe('resolveMCPCallAction', () => {
      it('should resolve server and tool', () => {
        const action: Action = { type: 'mcp_call', params: { server: 'test', tool: 'do_thing', args: { a: 1 } } };
        expect(resolveMCPCallAction(action)).toEqual({ serverName: 'test', toolName: 'do_thing', args: { a: 1 } });
      });

      it('should resolve dot notation', () => {
        const action: Action = { type: 'mcp_call', params: { server: 'test', tool: 'server.tool', args: { a: 1 } } };
        expect(resolveMCPCallAction(action)).toEqual({ serverName: 'server', toolName: 'tool', args: { a: 1 } });
      });

      it('should throw if server or tool missing', () => {
        const action: Action = { type: 'mcp_call', params: {} };
        expect(() => resolveMCPCallAction(action)).toThrow('MCP call requires server and tool');
      });
    });
  });

  describe('execute()', () => {
    it('should execute click with coordinates', async () => {
      const action: Action = { type: 'click', params: { x: 100, y: 200 } };
      const result = await executor.execute(action);
      
      expect(mockClick).toHaveBeenCalledWith(100, 200);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Clicked at (100, 200)');
      expect(mockLog).toHaveBeenCalled();
    });

    it('should execute click with marker', async () => {
      const action: Action = { 
        type: 'click', 
        params: { 
          resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } 
        } 
      };
      const result = await executor.execute(action);
      
      expect(mockClickByMarker).toHaveBeenCalledWith('snap1', 42);
      expect(result.success).toBe(true);
    });

    it('should execute click with selector', async () => {
      const action: Action = { type: 'click', params: { selector: '#btn' } };
      const result = await executor.execute(action);
      
      expect(mockClickBySelector).toHaveBeenCalledWith('#btn');
      expect(result.success).toBe(true);
    });

    it('should handle click error', async () => {
      const action: Action = { type: 'click', params: {} };
      const result = await executor.execute(action);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Click action requires');
      expect(mockSaveFailureSample).toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalled();
    });

    it('should execute type with marker', async () => {
      const action: Action = { 
        type: 'type', 
        params: { 
          text: 'hello',
          resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } 
        } 
      };
      const result = await executor.execute(action);
      
      expect(mockTypeByMarker).toHaveBeenCalledWith('snap1', 42, 'hello');
      expect(result.success).toBe(true);
    });

    it('should execute type with selector', async () => {
      const action: Action = { type: 'type', params: { selector: '#input', text: 'hello' } };
      const result = await executor.execute(action);
      
      expect(mockType).toHaveBeenCalledWith('#input', 'hello');
      expect(result.success).toBe(true);
    });

    it('should execute focus with marker', async () => {
      const action: Action = { type: 'focus', params: { resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } } };
      const result = await executor.execute(action);
      expect(mockFocusByMarker).toHaveBeenCalledWith('snap1', 42);
      expect(result.success).toBe(true);
    });

    it('should execute focus with selector', async () => {
      const action: Action = { type: 'focus', params: { selector: '#btn' } };
      const result = await executor.execute(action);
      expect(mockFocus).toHaveBeenCalledWith('#btn');
      expect(result.success).toBe(true);
    });

    it('should execute blur with marker', async () => {
      const action: Action = { type: 'blur', params: { resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } } };
      const result = await executor.execute(action);
      expect(mockBlurByMarker).toHaveBeenCalledWith('snap1', 42);
      expect(result.success).toBe(true);
    });

    it('should execute blur with selector', async () => {
      const action: Action = { type: 'blur', params: { selector: '#btn' } };
      const result = await executor.execute(action);
      expect(mockBlur).toHaveBeenCalledWith('#btn');
      expect(result.success).toBe(true);
    });

    it('should execute hover with marker', async () => {
      const action: Action = { type: 'hover', params: { resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } } };
      const result = await executor.execute(action);
      expect(mockHoverByMarker).toHaveBeenCalledWith('snap1', 42);
      expect(result.success).toBe(true);
    });

    it('should execute hover with selector', async () => {
      const action: Action = { type: 'hover', params: { selector: '#btn' } };
      const result = await executor.execute(action);
      expect(mockHover).toHaveBeenCalledWith('#btn');
      expect(result.success).toBe(true);
    });

    it('should execute value with marker', async () => {
      const action: Action = { type: 'value', params: { value: 'test', resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } } };
      const result = await executor.execute(action);
      expect(mockSetValueByMarker).toHaveBeenCalledWith('snap1', 42, 'test');
      expect(result.success).toBe(true);
    });

    it('should execute value with selector', async () => {
      const action: Action = { type: 'value', params: { selector: '#btn', value: 'test' } };
      const result = await executor.execute(action);
      expect(mockSetValue).toHaveBeenCalledWith('#btn', 'test');
      expect(result.success).toBe(true);
    });

    it('should execute dispatch with marker', async () => {
      const action: Action = { type: 'dispatch', params: { eventType: 'click', resolved_target: { type: 'marker', snapshot_id: 'snap1', nebula_id: 42 } } };
      const result = await executor.execute(action);
      expect(mockDispatchEventByMarker).toHaveBeenCalledWith('snap1', 42, 'click');
      expect(result.success).toBe(true);
    });

    it('should execute dispatch with selector', async () => {
      const action: Action = { type: 'dispatch', params: { selector: '#btn', eventType: 'click' } };
      const result = await executor.execute(action);
      expect(mockDispatchEvent).toHaveBeenCalledWith('#btn', 'click');
      expect(result.success).toBe(true);
    });

    it('should execute scroll', async () => {
      const action: Action = { type: 'scroll', params: { x: 0, y: 500 } };
      const result = await executor.execute(action);
      
      expect(mockScroll).toHaveBeenCalledWith(0, 500);
      expect(result.success).toBe(true);
    });

    it('should execute navigate', async () => {
      const action: Action = { type: 'navigate', params: { url: 'https://test.com' } };
      const result = await executor.execute(action);
      
      expect(mockNavigate).toHaveBeenCalledWith('https://test.com');
      expect(result.success).toBe(true);
    });

    it('should execute wait', async () => {
      const action: Action = { type: 'wait', params: { delay: 10 } };
      const result = await executor.execute(action);
      
      expect(result.success).toBe(true);
    });

    it('should execute screenshot', async () => {
      mockScreenshot.mockResolvedValue({ screenshot: 'base64' });
      const action: Action = { type: 'screenshot', params: {} };
      const result = await executor.execute(action);
      
      expect(mockScreenshot).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.screenshot).toBe('base64');
    });

    it('should execute mcp_call', async () => {
      mockMcpClient.callTool.mockResolvedValue({ result: 'ok' });
      const action: Action = { type: 'mcp_call', params: { server: 'test', tool: 'do_thing', args: { a: 1 } } };
      const result = await executor.execute(action);
      
      expect(mockMcpClient.callTool).toHaveBeenCalledWith('test', 'do_thing', { a: 1 });
      expect(result.success).toBe(true);
    });

    it('should execute finish', async () => {
      const action: Action = { type: 'finish', params: {} };
      const result = await executor.execute(action);
      
      expect(result.success).toBe(true);
    });

    it('should handle unknown action type', async () => {
      const action: Action = { type: 'unknown' as any, params: {} };
      const result = await executor.execute(action);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown action type');
    });
  });
});
