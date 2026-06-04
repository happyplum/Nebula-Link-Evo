import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolDeps } from '../types.js';
import type { VisionConfig } from '../config.js';
import { resolveSnapshot } from './utils.js';

export function registerFindElementTool(
  server: McpServer,
  deps: ToolDeps,
  config: VisionConfig
): void {
  server.registerTool(
    'find_element',
    {
      description: 'Find a DOM element by natural language description using vision AI',
      inputSchema: z.object({
        description: z.string().describe('Natural language description of the target element'),
        snapshot_id: z
          .string()
          .optional()
          .describe('Optional snapshot ID from previous analyze call'),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input: { description: string; snapshot_id?: string }) => {
      try {
        const snapshot = await resolveSnapshot(deps, input.snapshot_id);

        const result = await deps.visionAnalyzer.findElement(snapshot, input.description, config);

        if (result.nebula_id === null) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    nebula_id: null,
                    snapshot_id: snapshot.snapshot_id,
                    confidence: result.confidence,
                    reasoning: result.reasoning,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const element = snapshot.elements_map[result.nebula_id];
        const enriched = element
          ? { tag: element.tag, text: element.text, bbox: element.bbox }
          : undefined;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  nebula_id: result.nebula_id,
                  snapshot_id: snapshot.snapshot_id,
                  element: enriched,
                  confidence: result.confidence,
                  reasoning: result.reasoning,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
