import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../types.js';

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
  mockScreenshot: vi.fn().mockResolvedValue({ screenshot: 'base64data' }),
  mockGetStatus: vi.fn().mockResolvedValue({ url: 'https://example.com' }),
}));

const { mockLog } = vi.hoisted(() => ({
  mockLog: vi.fn().mockResolvedValue(undefined),
}));

const { mockSaveFailureSample } = vi.hoisted(() => ({
  mockSaveFailureSample: vi.fn().mockResolvedValue(null),
}));

const { mockCallTool } = vi.hoisted(() => ({
  mockCallTool: vi.fn().mockResolvedValue({ result: 'success' }),
}));

vi.mock('../../../browser-client.js', () => ({
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

vi.mock('../../../services/interaction-logger.js', () => ({
  interactionLogger: {
    log: mockLog,
  },
}));

vi.mock('../../../services/failure-sample-collector.js', () => ({
  failureSampleCollector: {
    saveFailureSample: mockSaveFailureSample,
  },
}));

describe('ActionExecutor', () => {
  let ActionExecutor: any;
  let executor: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('../../../services/action-executor.js');
    ActionExecutor = module.ActionExecutor;
    
    const mockMCPClient = {
      callTool: mockCallTool,
    };
    
    executor = new ActionExecutor({ mcpClient: mockMCPClient });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor and MCP Client', () => {
    it('should initialize with MCP client', async () => {
      const module = await import('../../../services/action-executor.js');
      const mockClient = { callTool: vi.fn() };
      const exec = new module.ActionExecutor({ mcpClient: mockClient as any });
      expect(exec).toBeDefined();
    });

    it('should allow setting MCP client', () => {
      const newClient = { callTool: vi.fn() };
      executor.setMCPClient(newClient as any);
      expect(executor).toBeDefined();
    });

    it('should allow null MCP client', async () => {
      const module = await import('../../../services/action-executor.js');
      const exec = new module.ActionExecutor({ mcpClient: null });
      expect(exec).toBeDefined();
    });
  });

  describe('execute() - Click Actions', () => {
    it('should execute click by coordinates', async () => {
      const action: Action = {
        type: 'click',
        params: { x: 100, y: 200 },
      };

      const result = await executor.execute(action);

      expect(mockClick).toHaveBeenCalledWith(100, 200);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Clicked at (100, 200)');
      expect(mockLog).toHaveBeenCalled();
    });

    it('should execute click by marker', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: 'snap123',
            nebula_id: 42,
          },
        },
      };

      const result = await executor.execute(action);

      expect(mockClickByMarker).toHaveBeenCalledWith('snap123', 42);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Clicked marker: snap123/42');
    });

    it('should execute click by selector', async () => {
      const action: Action = {
        type: 'click',
        params: {
          selector: '#submit-button',
        },
      };

      const result = await executor.execute(action);

      expect(mockClickBySelector).toHaveBeenCalledWith('#submit-button');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Clicked selector: #submit-button');
    });

    it('should handle click with resolved_target selector', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'selector',
            selector: '.btn-primary',
          },
        },
      };

      const result = await executor.execute(action);

      expect(mockClickBySelector).toHaveBeenCalledWith('.btn-primary');
      expect(result.success).toBe(true);
    });

    it('should throw error for click without valid params', async () => {
      const action: Action = {
        type: 'click',
        params: {},
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Click action requires');
    });
  });

  describe('execute() - Type Actions', () => {
    it('should execute type by marker', async () => {
      const action: Action = {
        type: 'type',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: 'snap456',
            nebula_id: 99,
          },
          text: 'Hello World',
        },
      };

      const result = await executor.execute(action);

      expect(mockTypeByMarker).toHaveBeenCalledWith('snap456', 99, 'Hello World');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Typed "Hello World"');
    });

    it('should execute type by selector', async () => {
      const action: Action = {
        type: 'type',
        params: {
          selector: '#username',
          text: 'testuser',
        },
      };

      const result = await executor.execute(action);

      expect(mockType).toHaveBeenCalledWith('#username', 'testuser');
      expect(result.success).toBe(true);
    });

    it('should throw error for type without selector', async () => {
      const action: Action = {
        type: 'type',
        params: { text: 'test' },
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Type action requires');
    });
  });

  describe('execute() - Focus Actions', () => {
    it('should execute focus by marker', async () => {
      const action: Action = {
        type: 'focus',
        params: {
          resolved_target: {
            format: 'target_id',
            snapshot_id: 'snap789',
            target_id: 10,
          },
        },
      };

      const result = await executor.execute(action);

      expect(mockFocusByMarker).toHaveBeenCalledWith('snap789', 10);
      expect(result.success).toBe(true);
    });

    it('should execute focus by selector', async () => {
      const action: Action = {
        type: 'focus',
        params: { selector: '#email' },
      };

      const result = await executor.execute(action);

      expect(mockFocus).toHaveBeenCalledWith('#email');
      expect(result.success).toBe(true);
    });
  });

  describe('execute() - Blur Actions', () => {
    it('should execute blur by marker', async () => {
      const action: Action = {
        type: 'blur',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: 'snap111',
            nebula_id: 5,
          },
        },
      };

      const result = await executor.execute(action);

      expect(mockBlurByMarker).toHaveBeenCalledWith('snap111', 5);
      expect(result.success).toBe(true);
    });

    it('should execute blur by selector', async () => {
      const action: Action = {
        type: 'blur',
        params: { selector: '#password' },
      };

      const result = await executor.execute(action);

      expect(mockBlur).toHaveBeenCalledWith('#password');
      expect(result.success).toBe(true);
    });
  });

  describe('execute() - Hover Actions', () => {
    it('should execute hover by marker', async () => {
      const action: Action = {
        type: 'hover',
        params: {
          resolved_target: {
            format: 'target_id',
            snapshot_id: 'snap222',
            target_id: 15,
          },
        },
      };

      const result = await executor.execute(action);

      expect(mockHoverByMarker).toHaveBeenCalledWith('snap222', 15);
      expect(result.success).toBe(true);
    });

    it('should execute hover by selector', async () => {
      const action: Action = {
        type: 'hover',
        params: { selector: '.tooltip-trigger' },
      };

      const result = await executor.execute(action);

      expect(mockHover).toHaveBeenCalledWith('.tooltip-trigger');
      expect(result.success).toBe(true);
    });
  });

  describe('execute() - Value Actions', () => {
    it('should execute setValue by marker', async () => {
      const action: Action = {
        type: 'value',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: 'snap333',
            nebula_id: 20,
          },
          value: 'new value',
        },
      };

      const result = await executor.execute(action);

      expect(mockSetValueByMarker).toHaveBeenCalledWith('snap333', 20, 'new value');
      expect(result.success).toBe(true);
    });

    it('should execute setValue by selector', async () => {
      const action: Action = {
        type: 'value',
        params: {
          selector: '#range-slider',
          value: '50',
        },
      };

      const result = await executor.execute(action);

      expect(mockSetValue).toHaveBeenCalledWith('#range-slider', '50');
      expect(result.success).toBe(true);
    });

    it('should handle value with param instead of value', async () => {
      const action: Action = {
        type: 'value',
        params: {
          selector: '#input',
          param: 'param value',
        },
      };

      const result = await executor.execute(action);

      expect(mockSetValue).toHaveBeenCalledWith('#input', 'param value');
      expect(result.success).toBe(true);
    });
  });

  describe('execute() - Dispatch Actions', () => {
    it('should execute dispatchEvent by marker', async () => {
      const action: Action = {
        type: 'dispatch',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: 'snap444',
            nebula_id: 25,
          },
          eventType: 'change',
        },
      };

      const result = await executor.execute(action);

      expect(mockDispatchEventByMarker).toHaveBeenCalledWith('snap444', 25, 'change');
      expect(result.success).toBe(true);
    });

    it('should execute dispatchEvent by selector', async () => {
      const action: Action = {
        type: 'dispatch',
        params: {
          selector: '#custom-element',
          eventType: 'custom-event',
        },
      };

      const result = await executor.execute(action);

      expect(mockDispatchEvent).toHaveBeenCalledWith('#custom-element', 'custom-event');
      expect(result.success).toBe(true);
    });

    it('should handle dispatch with param instead of eventType', async () => {
      const action: Action = {
        type: 'dispatch',
        params: {
          selector: '#element',
          param: 'click',
        },
      };

      const result = await executor.execute(action);

      expect(mockDispatchEvent).toHaveBeenCalledWith('#element', 'click');
      expect(result.success).toBe(true);
    });
  });

  describe('execute() - Scroll Actions', () => {
    it('should execute scroll with x and y', async () => {
      const action: Action = {
        type: 'scroll',
        params: { x: 0, y: 500 },
      };

      const result = await executor.execute(action);

      expect(mockScroll).toHaveBeenCalledWith(0, 500);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Scrolled by (0, 500)');
    });

    it('should execute scroll with default values', async () => {
      const action: Action = {
        type: 'scroll',
        params: {},
      };

      const result = await executor.execute(action);

      expect(mockScroll).toHaveBeenCalledWith(0, 0);
      expect(result.success).toBe(true);
    });
  });

  describe('execute() - Navigate Actions', () => {
    it('should execute navigate', async () => {
      const action: Action = {
        type: 'navigate',
        params: { url: 'https://example.com' },
      };

      const result = await executor.execute(action);

      expect(mockNavigate).toHaveBeenCalledWith('https://example.com');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Navigated to https://example.com');
    });

    it('should throw error for navigate without url', async () => {
      const action: Action = {
        type: 'navigate',
        params: {},
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Navigate action requires url');
    });
  });

  describe('execute() - Wait Actions', () => {
    it('should execute wait with delay', async () => {
      const action: Action = {
        type: 'wait',
        params: { delay: 2000 },
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Waited 2000ms');
    });

    it('should execute wait with duration', async () => {
      const action: Action = {
        type: 'wait',
        params: { duration: 1500 },
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Waited 1500ms');
    });

    it('should execute wait with default delay', async () => {
      const action: Action = {
        type: 'wait',
        params: {},
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Waited 1000ms');
    });
  });

  describe('execute() - Screenshot Actions', () => {
    it('should execute screenshot', async () => {
      const action: Action = {
        type: 'screenshot',
        params: {},
      };

      const result = await executor.execute(action);

      expect(mockScreenshot).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.message).toContain('Screenshot captured');
      expect(result.screenshot).toBe('base64data');
    });
  });

  describe('execute() - MCP Call Actions', () => {
    it('should execute MCP call', async () => {
      const action: Action = {
        type: 'mcp_call',
        params: {
          server: 'test-server',
          tool: 'test-tool',
          args: { key: 'value' },
        },
      };

      const result = await executor.execute(action);

      expect(mockCallTool).toHaveBeenCalledWith('test-server', 'test-tool', { key: 'value' });
      expect(result.success).toBe(true);
      expect(result.message).toContain('MCP call succeeded');
    });

    it('should handle MCP call with dotted tool name', async () => {
      const action: Action = {
        type: 'mcp_call',
        params: {
          server: 'original-server',
          tool: 'extracted-server.actual-tool',
          args: {},
        },
      };

      const result = await executor.execute(action);

      expect(mockCallTool).toHaveBeenCalledWith('extracted-server', 'actual-tool', {});
      expect(result.success).toBe(true);
    });

    it('should throw error for MCP call without server', async () => {
      const action: Action = {
        type: 'mcp_call',
        params: { tool: 'test-tool' },
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('MCP call requires server and tool');
    });

    it('should throw error for MCP call without MCP client', async () => {
      const module = await import('../../../services/action-executor.js');
      const execWithoutMCP = new module.ActionExecutor({ mcpClient: null });

      const action: Action = {
        type: 'mcp_call',
        params: {
          server: 'test-server',
          tool: 'test-tool',
        },
      };

      const result = await execWithoutMCP.execute(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('MCP call requires server and tool');
    });
  });

  describe('execute() - Finish Actions', () => {
    it('should execute finish', async () => {
      const action: Action = {
        type: 'finish',
        params: {},
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Task finished');
    });
  });

  describe('execute() - Error Handling', () => {
    it('should handle browser client errors', async () => {
      mockClick.mockRejectedValueOnce(new Error('Browser error'));

      const action: Action = {
        type: 'click',
        params: { x: 100, y: 200 },
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Browser error');
      expect(mockSaveFailureSample).toHaveBeenCalled();
    });

    it('should log interaction on success', async () => {
      const action: Action = {
        type: 'click',
        params: { x: 100, y: 200 },
      };

      await executor.execute(action);

      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: 'click',
          success: true,
        })
      );
    });

    it('should log interaction on failure', async () => {
      mockClick.mockRejectedValueOnce(new Error('Test error'));

      const action: Action = {
        type: 'click',
        params: { x: 100, y: 200 },
      };

      await executor.execute(action);

      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: 'click',
          success: false,
          error_message: 'Test error',
        })
      );
    });

    it('should handle unknown action type', async () => {
      const action: Action = {
        type: 'unknown_action' as any,
        params: {},
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown action type');
    });
  });

  describe('execute() - Interaction Logging', () => {
    it('should include latency in log', async () => {
      const action: Action = {
        type: 'click',
        params: { x: 100, y: 200 },
      };

      await executor.execute(action);

      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          latency_ms: expect.any(Number),
        })
      );
    });

    it('should include target type in log', async () => {
      const action: Action = {
        type: 'click',
        params: { x: 100, y: 200 },
      };

      await executor.execute(action);

      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          target_type: 'coordinates',
        })
      );
    });

    it('should include locator strategy in log', async () => {
      const action: Action = {
        type: 'click',
        params: { selector: '#button' },
      };

      await executor.execute(action);

      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          locator_strategy: 'selector',
        })
      );
    });

    it('should handle logger errors gracefully', async () => {
      mockLog.mockRejectedValueOnce(new Error('Logger error'));

      const action: Action = {
        type: 'click',
        params: { x: 100, y: 200 },
      };

      const result = await executor.execute(action);

      expect(result.success).toBe(true);
    });
  });

  describe('Parameter Resolution', () => {
    it('should resolve marker parameters from resolved_target', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: 'snap-from-resolved',
            nebula_id: 100,
          },
        },
      };

      const result = await executor.execute(action);

      expect(mockClickByMarker).toHaveBeenCalledWith('snap-from-resolved', 100);
      expect(result.success).toBe(true);
    });

    it('should fallback to params for snapshot_id', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            nebula_id: 50,
          },
          snapshot_id: 'snap-from-params',
        },
      };

      const result = await executor.execute(action);

      expect(mockClickByMarker).toHaveBeenCalledWith('snap-from-params', 50);
      expect(result.success).toBe(true);
    });

    it('should handle target_id as alias for nebula_id', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            format: 'target_id',
            snapshot_id: 'snap123',
            target_id: 75,
          },
        },
      };

      const result = await executor.execute(action);

      expect(mockClickByMarker).toHaveBeenCalledWith('snap123', 75);
      expect(result.success).toBe(true);
    });

    it('should handle format field for marker detection', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            format: 'target_id',
            snapshot_id: 'snap456',
            target_id: 88,
          },
        },
      };

      const result = await executor.execute(action);

      expect(mockClickByMarker).toHaveBeenCalledWith('snap456', 88);
      expect(result.success).toBe(true);
    });

    it('should handle format field for selector detection', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            format: 'selector',
            selector: '.dynamic-button',
          },
        },
      };

      const result = await executor.execute(action);

      expect(mockClickBySelector).toHaveBeenCalledWith('.dynamic-button');
      expect(result.success).toBe(true);
    });
  });
});
