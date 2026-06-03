import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types.js';
import type { VisionConfig } from '../config.js';
import { registerAnalyzeTool } from './analyze.js';
import { registerFindElementTool } from './find-element.js';
import { registerScreenshotTool } from './screenshot.js';
import { registerGetElementInfoTool } from './get-element-info.js';

export function registerAllTools(server: McpServer, deps: ToolDeps, config: VisionConfig): void {
  registerAnalyzeTool(server, deps);
  registerFindElementTool(server, deps, config);
  registerScreenshotTool(server, deps);
  registerGetElementInfoTool(server, deps);
}
