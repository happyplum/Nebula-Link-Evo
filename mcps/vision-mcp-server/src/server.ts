import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VisionConfig } from './config.js';
import { PlaywrightClient } from './playwright-client.js';
import { VisionAnalyzer } from './vision-analyzer.js';
import { createSnapshotCache } from './types.js';
import { registerAllTools } from './tools/index.js';

/**
 * Create and configure the Vision MCP server.
 * - Creates McpServer instance
 * - Initializes PlaywrightClient, VisionAnalyzer, SnapshotCache
 * - Registers all 4 MCP tools
 *
 * @returns configured McpServer ready to connect to a transport
 */
export function createServer(config: VisionConfig): McpServer {
  const server = new McpServer({
    name: 'vision-mcp-server',
    version: '1.0.0',
  });

  const playwrightClient = new PlaywrightClient(config.PLAYWRIGHT_SERVER_URL);
  const visionAnalyzer = new VisionAnalyzer(config);
  const cache = createSnapshotCache();

  registerAllTools(
    server,
    {
      playwrightClient,
      visionAnalyzer,
      cache,
    },
    config
  );

  return server;
}
