import type { GatewayTool } from '../../../tools/types.js';
import type { VisionConfig } from '../config.js';
import type { ToolDeps, VisionAgentTool, VisionToolResult } from '../types.js';
import { createAnalyzeTool } from './analyze.js';
import { createFindElementTool } from './find-element.js';
import { createGetElementInfoTool } from './get-element-info.js';
import { createScreenshotTool } from './screenshot.js';

export function createVisionAgentTools(
  deps: ToolDeps,
  config: VisionConfig,
  isAvailable: () => boolean,
): GatewayTool[] {
  const tools: VisionAgentTool[] = [
    createAnalyzeTool(deps),
    createFindElementTool(deps, config),
    createGetElementInfoTool(deps),
    createScreenshotTool(deps),
  ];

  return tools.map((tool) => toGatewayTool(tool, isAvailable));
}

function toGatewayTool(tool: VisionAgentTool, isAvailable: () => boolean): GatewayTool {
  const name = `vision-agent.${tool.name}`;

  return {
    id: `vision-agent:${tool.name}`,
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    providerId: 'vision-agent',
    exposeTo: ['chat', 'mcp-server'] as const,
    get isAvailable() {
      return isAvailable();
    },
    execute: async (args: unknown) => formatToolResult(await tool.execute(args)),
  };
}

function formatToolResult(result: VisionToolResult): string {
  if (!result.isError && result.content.length === 1 && result.content[0].type === 'text') {
    return result.content[0].text;
  }

  return JSON.stringify(result, null, 2);
}
