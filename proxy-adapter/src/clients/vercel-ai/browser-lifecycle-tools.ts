import { tool } from 'ai';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import type { BrowserClient } from '../../browser-client.js';


export function createBrowserLifecycleTools(client: BrowserClient): Record<string, unknown> {
  const statusTool = tool({
    description: '检查浏览器当前状态（是否打开、当前URL、页面标题、视口大小）',
    inputSchema: z.object({}).optional(),
    execute: async (_input, _options: ToolExecutionOptions) => {
      const status = await client.getStatus();
      return { ok: true, ...status };
    },
  });

  const openTool = tool({
    description: '打开浏览器。如果浏览器已打开，此操作会重新创建上下文和页面',
    inputSchema: z.object({}).optional(),
    execute: async (_input, _options: ToolExecutionOptions) => {
      try {
        await client.openBrowser();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
  });

  const closeTool = tool({
    description: '关闭浏览器。关闭浏览器后，所有 MCP 浏览器操作工具将不可用，直到重新调用 browser_open',
    inputSchema: z.object({}).optional(),
    execute: async (_input, _options: ToolExecutionOptions) => {
      try {
        await client.closeBrowser();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
  });

  const listTabsTool = tool({
    description: '获取所有打开的标签页列表',
    inputSchema: z.object({}).optional(),
    execute: async (_input, _options: ToolExecutionOptions) => {
      const tabs = await client.getTabs();
      return { ok: true, tabs };
    },
  });

  const switchTabTool = tool({
    description: '切换到指定标签页。切换标签页后，后续所有操作将作用于新标签页',
    inputSchema: z.object({
      id: z.string().describe('标签页ID'),
    }),
    execute: async ({ id }, _options: ToolExecutionOptions) => {
      try {
        await client.switchTab(id);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
  });

  return {
    browser_status: statusTool,
    browser_open: openTool,
    browser_close: closeTool,
    browser_list_tabs: listTabsTool,
    browser_switch_tab: switchTabTool,
  };
}
