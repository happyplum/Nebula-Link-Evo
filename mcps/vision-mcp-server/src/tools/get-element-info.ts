import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolDeps } from '../types.js';
import { resolveSnapshot, errorResult } from './utils.js';

export function registerGetElementInfoTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_element_info',
    {
      description: 'Given a nebula_id, return full element info from snapshot',
      inputSchema: z.object({
        nebula_id: z.string().describe('The element ID (nebula_id) to look up'),
        snapshot_id: z.string().optional().describe('Optional snapshot ID'),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input: { nebula_id: string; snapshot_id?: string }) => {
      try {
        const snapshot = await resolveSnapshot(deps, input.snapshot_id);
        const element = snapshot.elements_map[input.nebula_id];

        if (!element) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Element '${input.nebula_id}' not found in snapshot`,
                }),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  nebula_id: input.nebula_id,
                  tag: element.tag,
                  text: element.text ?? null,
                  bbox: element.bbox,
                  locators: element.locator_bundle,
                  snapshot_id: snapshot.snapshot_id,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
