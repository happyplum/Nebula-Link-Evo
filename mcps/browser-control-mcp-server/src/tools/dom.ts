import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolDeps } from '../types.js';
import { textResult, errorResult } from '../utils.js';

export function registerDomTools(server: McpServer, deps: ToolDeps): void {
  // dom_snapshot: Get a simplified DOM snapshot of the current page
  server.registerTool(
    'dom_snapshot',
    {
      description:
        'Get a simplified DOM snapshot of the current page with interactive elements and their bounding boxes',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const result = await deps.playwrightClient.getDomSnapshot();
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  // dom_script: Execute arbitrary JavaScript in the browser page context
  server.registerTool(
    'dom_script',
    {
      description: 'Execute arbitrary JavaScript in the browser page context',
      inputSchema: z
        .object({
          script: z.string().describe('JavaScript code to execute'),
          args: z.array(z.any()).optional().describe('Arguments to pass to the script function'),
        })
        .strict(),
    },
    async (input) => {
      try {
        const result = await deps.playwrightClient.executeScript(input.script, input.args);
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  // execute_by_marker: Execute an action on a DOM element identified by snapshot_id and nebula_id
  server.registerTool(
    'execute_by_marker',
    {
      description:
        'Execute an action on a DOM element identified by snapshot_id and nebula_id (from a previous dom_snapshot)',
      inputSchema: z
        .object({
          snapshot_id: z.string().describe('Snapshot ID from a previous dom_snapshot call'),
          nebula_id: z.number().describe('Element nebula_id from the snapshot'),
          action: z
            .enum(['click', 'type', 'focus', 'blur', 'hover', 'value', 'dispatch'])
            .describe('Action to perform on the element'),
          param: z
            .string()
            .optional()
            .describe('Parameter for the action (e.g., text for type action)'),
        })
        .strict(),
    },
    async (input) => {
      try {
        const result = await deps.playwrightClient.executeByMarker(
          input.snapshot_id,
          input.nebula_id,
          input.action,
          input.param
        );
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
