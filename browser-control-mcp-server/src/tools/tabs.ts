import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolDeps } from '../types.js';
import { textResult, errorResult } from '../utils.js';

export function registerTabTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'browser_list_tabs',
    {
      description: 'List all open browser tabs',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const result = await deps.playwrightClient.listTabs();
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    'browser_switch_tab',
    {
      description: 'Switch to a specific browser tab by ID',
      inputSchema: z.object({
        id: z.string().describe('Tab ID to switch to'),
      }),
    },
    async (input: { id: string }) => {
      try {
        const result = await deps.playwrightClient.switchTab(input.id);
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
