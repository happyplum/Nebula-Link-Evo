import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from './config.js';
import { PlaywrightClient } from './playwright-client.js';
import { registerAllTools } from './tools/index.js';

export function createServer(): McpServer {
  const config = loadConfig();
  const server = new McpServer({
    name: 'browser-control-mcp-server',
    version: '1.0.0',
  });
  const playwrightClient = new PlaywrightClient(config.PLAYWRIGHT_SERVER_URL);
  registerAllTools(server, { playwrightClient });
  return server;
}
