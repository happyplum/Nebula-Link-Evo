import 'dotenv/config';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    // Required env vars missing — exit gracefully
    console.error('Vision MCP Server: Missing required configuration.');
    console.error('Required: VISION_PROVIDER_BASE_URL, VISION_PROVIDER_API_KEY, VISION_MODEL_ID');
    console.error('Server will not start without these values.');
    process.exit(0);
  }

  const server = createServer(config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Use console.error for logging — stdout is reserved for MCP protocol
  console.error(`Vision MCP Server running (model: ${config.VISION_MODEL_ID})`);

  // Graceful shutdown
  const shutdown = async () => {
    console.error('Vision MCP Server shutting down...');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('Vision MCP Server fatal error:', error);
  process.exit(1);
});
