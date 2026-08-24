/**
 * MCP Server Fastify plugin — exposes ToolRegistry tools via Streamable HTTP.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ToolRegistry } from '../tools/registry.js';
import { registerGatewayToolsToMcpServer } from '../tools/adapters/mcp-server.js';
import { registerStreamableHttpMcpRoute } from './transport.js';

export interface McpServerPluginOptions {
  toolRegistry: ToolRegistry;
  prefix?: string;
}

const mcpServerPlugin: FastifyPluginAsync<McpServerPluginOptions> = async (fastify, options) => {
  const { toolRegistry, prefix = '/mcp' } = options;

  // Cache tools at plugin init — avoids repeated registry queries per request.
  const cachedTools = toolRegistry.getAvailableTools();

  await registerStreamableHttpMcpRoute(
    fastify,
    () => {
      const server = new McpServer(
        { name: 'nebula-link-evo', version: '1.0.0' },
        { capabilities: { tools: {} } }
      );

      registerGatewayToolsToMcpServer(server, cachedTools);

      return server;
    },
    prefix
  );
};

export default fp(mcpServerPlugin, {
  name: 'mcp-server-plugin',
});
