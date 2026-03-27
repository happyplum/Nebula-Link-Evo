import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCoreTools } from '../../clients/vercel-ai/core-tools.js';
import type { ActionExecutor, ActionResult } from '../../services/action-executor.js';

// Type guard for ActionResult vs AsyncIterable<ActionResult>
function isActionResult(result: unknown): result is ActionResult {
  return result !== null && typeof result === 'object' && 'success' in result;
}
describe('createCoreTools', () => {
  let mockExecutor: ActionExecutor;
  let tools: ReturnType<typeof createCoreTools>;

  beforeEach(() => {
    mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        action: { type: 'click', params: {} },
        success: true,
        message: 'Action executed',
      } as ActionResult),
    } as unknown as ActionExecutor;

    tools = createCoreTools(mockExecutor);
  });

  describe('tool creation', () => {
    it('should return all 6 core tools', () => {
      expect(tools).toHaveProperty('click');
      expect(tools).toHaveProperty('type');
      expect(tools).toHaveProperty('navigate');
      expect(tools).toHaveProperty('scroll');
      expect(tools).toHaveProperty('wait');
      expect(tools).toHaveProperty('screenshot');
    });

    it('should return tools with correct structure', () => {
      for (const toolName of ['click', 'type', 'navigate', 'scroll', 'wait', 'screenshot']) {
        const tool = tools[toolName as keyof typeof tools];
        expect(tool).toBeDefined();
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('execute');
      }
    });
  });

  describe('click tool', () => {
    it('should have correct description', () => {
      expect(tools.click.description).toBe('Click element by selector or coordinates');
    });

    it('should execute click with selector', async () => {
      const result = await tools.click.execute?.({ selector: '#button' }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'click',
        params: { selector: '#button', x: undefined, y: undefined },
      });
      expect(result.success).toBe(true);
    });

    it('should execute click with coordinates', async () => {
      const result = await tools.click.execute?.({ x: 100, y: 200 }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'click',
        params: { selector: undefined, x: 100, y: 200 },
      });
      expect(result.success).toBe(true);
    });

    it('should execute click with both selector and coordinates', async () => {
      const result = await tools.click.execute?.({ selector: '#btn', x: 50, y: 75 }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'click',
        params: { selector: '#btn', x: 50, y: 75 },
      });
      expect(result.success).toBe(true);
    });

    it('should validate input schema requires selector or coordinates', () => {
      const schema = tools.click.inputSchema as any;
      // Valid: selector only
      expect(schema.safeParse?.({ selector: '#btn' }).success).toBe(true);
      // Valid: both x and y
      expect(schema.safeParse?.({ x: 100, y: 200 }).success).toBe(true);
      // Invalid: neither
      expect(schema.safeParse?.({}).success).toBe(false);
      // Invalid: only x
      expect(schema.safeParse?.({ x: 100 }).success).toBe(false);
      // Invalid: only y
      expect(schema.safeParse?.({ y: 100 }).success).toBe(false);
    });
  });

  describe('type tool', () => {
    it('should have correct description', () => {
      expect(tools.type.description).toBe('Type text into an input field');
    });

    it('should execute type with required params', async () => {
      const result = await tools.type.execute?.({ selector: '#input', text: 'hello', clear: true }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'type',
        params: { selector: '#input', text: 'hello', clear: true },
      });
      expect(result.success).toBe(true);
    });

    it('should execute type with clear=false', async () => {
      await tools.type.execute?.({ selector: '#input', text: 'world', clear: false }, {} as any);
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'type',
        params: { selector: '#input', text: 'world', clear: false },
      });
    });

    it('should validate input schema requires selector and text', () => {
      const schema = tools.type.inputSchema as any;
      expect(schema.safeParse?.({ selector: '#input', text: 'test' }).success).toBe(true);
      expect(schema.safeParse?.({ selector: '#input' }).success).toBe(false);
      expect(schema.safeParse?.({ text: 'test' }).success).toBe(false);
    });
  });

  describe('navigate tool', () => {
    it('should have correct description', () => {
      expect(tools.navigate.description).toBe('Navigate to a URL');
    });

    it('should execute navigate with valid URL', async () => {
      const result = await tools.navigate.execute?.({ url: 'https://example.com' }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'navigate',
        params: { url: 'https://example.com' },
      });
      expect(result.success).toBe(true);
    });

    it('should validate input schema requires valid URL', () => {
      const schema = tools.navigate.inputSchema as any;
      expect(schema.safeParse?.({ url: 'https://example.com' }).success).toBe(true);
      expect(schema.safeParse?.({ url: 'http://test.org' }).success).toBe(true);
      expect(schema.safeParse?.({ url: 'invalid-url' }).success).toBe(false);
      expect(schema.safeParse?.({}).success).toBe(false);
    });
  });

  describe('scroll tool', () => {
    it('should have correct description', () => {
      expect(tools.scroll.description).toBe('Scroll the page');
    });

    it('should execute scroll with default values', async () => {
      const result = await tools.scroll.execute?.({ x: 0, y: 0 }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'scroll',
        params: { x: 0, y: 0 },
      });
      expect(result.success).toBe(true);
    });

    it('should execute scroll with custom values', async () => {
      const result = await tools.scroll.execute?.({ x: 100, y: 500 }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'scroll',
        params: { x: 100, y: 500 },
      });
      expect(result.success).toBe(true);
    });

    it('should validate input schema with defaults', () => {
      const schema = tools.scroll.inputSchema as any;
      expect(schema.safeParse?.({}).success).toBe(true);
      expect(schema.safeParse?.({ x: 100 }).success).toBe(true);
      expect(schema.safeParse?.({ y: 200 }).success).toBe(true);
      expect(schema.safeParse?.({ x: 100, y: 200 }).success).toBe(true);
    });
  });

  describe('wait tool', () => {
    it('should have correct description', () => {
      expect(tools.wait.description).toBe('Wait for a specified duration');
    });

    it('should execute wait with default duration', async () => {
      const result = await tools.wait.execute?.({ duration: 1000 }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'wait',
        params: { duration: 1000 },
      });
      expect(result.success).toBe(true);
    });

    it('should execute wait with custom duration', async () => {
      const result = await tools.wait.execute?.({ duration: 2000 }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'wait',
        params: { duration: 2000 },
      });
      expect(result.success).toBe(true);
    });

    it('should validate input schema with default duration', () => {
      const schema = tools.wait.inputSchema as any;
      expect(schema.safeParse?.({}).success).toBe(true);
      expect(schema.safeParse?.({ duration: 500 }).success).toBe(true);
    });
  });

  describe('screenshot tool', () => {
    it('should have correct description', () => {
      expect(tools.screenshot.description).toBe('Take a screenshot of the current page');
    });

    it('should execute screenshot with default fullPage', async () => {
      const result = await tools.screenshot.execute?.({ fullPage: false }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'screenshot',
        params: { fullPage: false },
      });
      expect(result.success).toBe(true);
    });

    it('should execute screenshot with fullPage=true', async () => {
      const result = await tools.screenshot.execute?.({ fullPage: true }, {} as any) as ActionResult;
      expect(mockExecutor.execute).toHaveBeenCalledWith({
        type: 'screenshot',
        params: { fullPage: true },
      });
      expect(result.success).toBe(true);
    });

    it('should validate input schema with default fullPage', () => {
      const schema = tools.screenshot.inputSchema as any;
      expect(schema.safeParse?.({}).success).toBe(true);
      expect(schema.safeParse?.({ fullPage: true }).success).toBe(true);
      expect(schema.safeParse?.({ fullPage: false }).success).toBe(true);
    });
  });

  describe('executor error handling', () => {
    it('should propagate executor errors', async () => {
      const errorMessage = 'Click failed';
      vi.mocked(mockExecutor.execute).mockResolvedValueOnce({
        action: { type: 'click', params: {} },
        success: false,
        message: errorMessage,
      } as ActionResult);

      const result = await tools.click.execute?.({ selector: '#btn' }, {} as any) as ActionResult;
      expect(result.success).toBe(false);
      expect(result.message).toBe(errorMessage);
    });

    it('should propagate executor exceptions', async () => {
      const error = new Error('Network error');
      vi.mocked(mockExecutor.execute).mockRejectedValueOnce(error);

      await expect(tools.click.execute?.({ selector: '#btn' }, {} as any)).rejects.toThrow('Network error');
    });
  });
});