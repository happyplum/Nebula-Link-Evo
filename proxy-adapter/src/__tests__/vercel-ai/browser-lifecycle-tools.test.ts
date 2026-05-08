import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBrowserLifecycleTools } from '../../clients/vercel-ai/browser-lifecycle-tools.js';
import type { BrowserClient } from '../../browser-client.js';

describe('createBrowserLifecycleTools', () => {
  let mockClient: BrowserClient;
  let tools: Record<string, unknown>;

  beforeEach(() => {
    mockClient = {
      openBrowser: vi.fn().mockResolvedValue(undefined),
      closeBrowser: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({
        isOpen: true,
        url: 'https://example.com',
        title: 'Example',
        viewport: { width: 1920, height: 1080 },
      }),
      getTabs: vi.fn().mockResolvedValue([
        { id: 'tab1', url: 'https://example.com', title: 'Example', isActive: true },
      ]),
      switchTab: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserClient;

    tools = createBrowserLifecycleTools(mockClient);
  });

  describe('tool creation', () => {
    it('should return object with exactly 5 keys', () => {
      const keys = Object.keys(tools);
      expect(keys).toHaveLength(5);
      expect(keys).toContain('browser_status');
      expect(keys).toContain('browser_open');
      expect(keys).toContain('browser_close');
      expect(keys).toContain('browser_list_tabs');
      expect(keys).toContain('browser_switch_tab');
    });

    it('should return tools with correct structure', () => {
      for (const toolName of Object.keys(tools)) {
        const t = tools[toolName] as Record<string, unknown>;
        expect(t).toHaveProperty('description');
        expect(t).toHaveProperty('inputSchema');
        expect(t).toHaveProperty('execute');
      }
    });
  });

  describe('browser_status', () => {
    it('should return ok:true with status data', async () => {
      const statusTool = tools.browser_status as Record<string, unknown>;
      const result = await (statusTool.execute as Function)({}, {});
      expect(result).toEqual({
        ok: true,
        isOpen: true,
        url: 'https://example.com',
        title: 'Example',
        viewport: { width: 1920, height: 1080 },
      });
      expect(mockClient.getStatus).toHaveBeenCalledOnce();
    });
  });

  describe('browser_open', () => {
    it('should return ok:true on success', async () => {
      const openTool = tools.browser_open as Record<string, unknown>;
      const result = await (openTool.execute as Function)({}, {});
      expect(result).toEqual({ ok: true });
      expect(mockClient.openBrowser).toHaveBeenCalledOnce();
    });

    it('should return ok:false with error message on failure', async () => {
      vi.mocked(mockClient.openBrowser).mockRejectedValueOnce(new Error('Connection refused'));
      const openTool = tools.browser_open as Record<string, unknown>;
      const result = await (openTool.execute as Function)({}, {});
      expect(result).toEqual({ ok: false, error: 'Connection refused' });
    });
  });

  describe('browser_close', () => {
    it('should return ok:true on success', async () => {
      const closeTool = tools.browser_close as Record<string, unknown>;
      const result = await (closeTool.execute as Function)({}, {});
      expect(result).toEqual({ ok: true });
      expect(mockClient.closeBrowser).toHaveBeenCalledOnce();
    });

    it('should return ok:false with error message on failure', async () => {
      vi.mocked(mockClient.closeBrowser).mockRejectedValueOnce(new Error('Already closed'));
      const closeTool = tools.browser_close as Record<string, unknown>;
      const result = await (closeTool.execute as Function)({}, {});
      expect(result).toEqual({ ok: false, error: 'Already closed' });
    });
  });

  describe('browser_list_tabs', () => {
    it('should return ok:true with tabs array', async () => {
      const listTabsTool = tools.browser_list_tabs as Record<string, unknown>;
      const result = await (listTabsTool.execute as Function)({}, {});
      expect(result).toEqual({
        ok: true,
        tabs: [{ id: 'tab1', url: 'https://example.com', title: 'Example', isActive: true }],
      });
      expect(mockClient.getTabs).toHaveBeenCalledOnce();
    });
  });

  describe('browser_switch_tab', () => {
    it('should return ok:true with valid id', async () => {
      const switchTabTool = tools.browser_switch_tab as Record<string, unknown>;
      const result = await (switchTabTool.execute as Function)({ id: 'tab1' }, {});
      expect(result).toEqual({ ok: true });
      expect(mockClient.switchTab).toHaveBeenCalledWith('tab1');
    });

    it('should return ok:false with error message on failure', async () => {
      vi.mocked(mockClient.switchTab).mockRejectedValueOnce(new Error('Tab not found'));
      const switchTabTool = tools.browser_switch_tab as Record<string, unknown>;
      const result = await (switchTabTool.execute as Function)({ id: 'nonexistent' }, {});
      expect(result).toEqual({ ok: false, error: 'Tab not found' });
    });

    it('should require id parameter in inputSchema', () => {
      const switchTabTool = tools.browser_switch_tab as Record<string, unknown>;
      const schema = switchTabTool.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
      // Valid: with id
      expect(schema.safeParse({ id: 'tab1' }).success).toBe(true);
      // Invalid: without id
      expect(schema.safeParse({}).success).toBe(false);
    });
  });
});
