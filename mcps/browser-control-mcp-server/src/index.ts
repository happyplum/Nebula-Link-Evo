import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  console.error('[DEPRECATED] browser-control-mcp-server is deprecated — browser tools are now served directly by proxy-adapter via the browser-tools module');
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Browser Control MCP Server running');
  const shutdown = async () => {
    console.error('Browser Control MCP Server shutting down...');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch((error: unknown) => {
  console.error('Browser Control MCP Server fatal error:', error);
  process.exit(1);
});
