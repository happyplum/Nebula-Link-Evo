import type { VisionConfig } from '../config.js';
import type { ToolDeps, VisionAgentTool } from '../types.js';
import { objectInput, optionalString, resolveSnapshot } from './utils.js';

export function createFindElementTool(deps: ToolDeps, config: VisionConfig): VisionAgentTool {
  return {
    name: 'find_element',
    description: 'Find a DOM element by natural language description using vision AI',
    inputSchema: {
      type: 'object',
      required: ['description'],
      additionalProperties: false,
      properties: {
        description: {
          type: 'string',
          description: 'Natural language description of the target element',
        },
        snapshot_id: {
          type: 'string',
          description: 'Optional snapshot ID from previous analyze call',
        },
      },
    },
    async execute(args: unknown) {
      try {
        const input = objectInput(args);
        const description = optionalString(input.description);
        if (!description) {
          throw new Error('description is required');
        }

        const snapshot = await resolveSnapshot(deps, optionalString(input.snapshot_id));
        const result = await deps.visionAnalyzer.findElement(snapshot, description, config);

        if (result.nebula_id === null) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    nebula_id: null,
                    snapshot_id: snapshot.snapshot_id,
                    confidence: result.confidence,
                    reasoning: result.reasoning,
                  },
                  null,
                  2,
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
              type: 'text',
              text: JSON.stringify(
                {
                  nebula_id: result.nebula_id,
                  snapshot_id: snapshot.snapshot_id,
                  element: enriched,
                  confidence: result.confidence,
                  reasoning: result.reasoning,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  };
}
