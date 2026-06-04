import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types.js';
import { registerBrowserTools } from './browser.js';
import { registerTabTools } from './tabs.js';
import { registerInteractionTools } from './interaction.js';
import { registerDomTools } from './dom.js';

export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  registerBrowserTools(server, deps);
  registerTabTools(server, deps);
  registerInteractionTools(server, deps);
  registerDomTools(server, deps);
}
