import type { ToolDeps, VisionAgentTool } from '../types.js';
import { errorResult, objectInput, optionalString, resolveSnapshot } from './utils.js';

export function createGetElementInfoTool(deps: ToolDeps): VisionAgentTool {
  return {
    name: 'get_element_info',
    description: 'Given a nebula_id, return full element info from snapshot',
    inputSchema: {
      type: 'object',
      required: ['nebula_id'],
      additionalProperties: false,
      properties: {
        nebula_id: {
          type: 'string',
          description: 'The element ID (nebula_id) to look up',
        },
        snapshot_id: {
          type: 'string',
          description: 'Optional snapshot ID',
        },
      },
    },
    async execute(args: unknown) {
      try {
        const input = objectInput(args);
        const nebulaId = optionalString(input.nebula_id);
        if (!nebulaId) {
          throw new Error('nebula_id is required');
        }

        const snapshot = await resolveSnapshot(deps, optionalString(input.snapshot_id));
        const element = snapshot.elements_map[nebulaId];

        if (!element) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Element '${nebulaId}' not found in snapshot`,
                }),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  nebula_id: nebulaId,
                  tag: element.tag,
                  text: element.text ?? null,
                  bbox: element.bbox,
                  locators: element.locator_bundle,
                  snapshot_id: snapshot.snapshot_id,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
