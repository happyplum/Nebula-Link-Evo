import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolDeps } from '../types.js';
import { textResult, errorResult } from './utils.js';

export function registerAnalyzeTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'analyze',
    {
      description: 'Fetch page snapshot and return element summary with annotated screenshot',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const snapshot = await deps.playwrightClient.getSimplifiedDOM();
        deps.cache.set(snapshot.snapshot_id, snapshot);

        const viewport = snapshot.simplified_dom.viewport;
        const elementCount = Object.keys(snapshot.elements_map).length;

        const lines: string[] = [
          `[Page Snapshot] snapshot_id: ${snapshot.snapshot_id}`,
          `Viewport: ${viewport.width}x${viewport.height} | Elements: ${elementCount}`,
          '',
          'Interactive Elements:',
        ];

        for (const [id, el] of Object.entries(snapshot.elements_map)) {
          const { bbox } = el;
          const textPart = el.text ? ` "${el.text}"` : '';
          lines.push(
            `[${id}] <${el.tag}>${textPart} @ (${bbox.x},${bbox.y},${bbox.width},${bbox.height})`
          );
        }

        return {
          content: [
            { type: 'text' as const, text: lines.join('\n') },
            {
              type: 'image' as const,
              data: snapshot.annotated_screenshot_base64,
              mimeType: 'image/jpeg',
            },
          ],
        };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
