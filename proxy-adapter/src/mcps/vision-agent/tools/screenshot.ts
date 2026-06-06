import type { ToolDeps, VisionAgentTool } from '../types.js';
import { errorResult, objectInput, resolveSnapshot, textResult } from './utils.js';

export function createScreenshotTool(deps: ToolDeps): VisionAgentTool {
  return {
    name: 'screenshot',
    description: 'Get a page screenshot — annotated with red nebula_id markers or raw PNG',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: {
          type: 'string',
          enum: ['annotated', 'raw'],
          default: 'annotated',
          description: "'annotated' includes red nebula_id markers; 'raw' is a clean PNG",
        },
        fullPage: {
          type: 'boolean',
          default: false,
          description: 'Capture the full scrollable page (only for raw screenshots)',
        },
      },
    },
    async execute(args: unknown) {
      try {
        const input = objectInput(args);
        const type = input.type === 'raw' ? 'raw' : 'annotated';
        const fullPage = typeof input.fullPage === 'boolean' ? input.fullPage : false;

        if (type === 'annotated') {
          const snapshot = await resolveSnapshot(deps);
          const viewport = snapshot.simplified_dom.viewport;

          return {
            content: [
              {
                type: 'image',
                data: snapshot.annotated_screenshot_base64,
                mimeType: 'image/jpeg',
              },
              textResult(`Viewport: ${viewport.width}x${viewport.height} | Type: annotated`)
                .content[0],
            ],
          };
        }

        const result = await deps.browserClient.screenshot(fullPage);

        return {
          content: [
            {
              type: 'image',
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
    },
  };
}
