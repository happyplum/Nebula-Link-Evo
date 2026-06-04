import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolDeps } from '../types.js';
import { resolveSnapshot, textResult, errorResult } from './utils.js';

export function registerScreenshotTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'screenshot',
    {
      description: 'Get a page screenshot — annotated with red nebula_id markers or raw PNG',
      inputSchema: z.object({
        type: z
          .enum(['annotated', 'raw'])
          .default('annotated')
          .describe("'annotated' includes red nebula_id markers; 'raw' is a clean PNG"),
        fullPage: z
          .boolean()
          .default(false)
          .describe('Capture the full scrollable page (only for raw screenshots)'),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input: { type: 'annotated' | 'raw'; fullPage: boolean }) => {
      try {
        if (input.type === 'annotated') {
          const snapshot = await resolveSnapshot(deps);
          const viewport = snapshot.simplified_dom.viewport;

          return {
            content: [
              {
                type: 'image' as const,
                data: snapshot.annotated_screenshot_base64,
                mimeType: 'image/jpeg',
              },
              textResult(`Viewport: ${viewport.width}x${viewport.height} | Type: annotated`)
                .content[0],
            ],
          };
        }

        const result = await deps.playwrightClient.getScreenshot(input.fullPage);

        return {
          content: [
            {
              type: 'image' as const,
              data: result.screenshot,
              mimeType: 'image/png',
            },
            textResult(`Viewport: ${result.viewport.width}x${result.viewport.height} | Type: raw`)
              .content[0],
          ],
        };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
