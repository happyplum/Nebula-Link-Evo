import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type McpServerFactory = () => McpServer | Promise<McpServer>;

export function createStatelessStreamableHttpTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
}

export async function registerStreamableHttpMcpRoute(
  app: FastifyInstance,
  createMcpServer: McpServerFactory,
  url = '/mcp'
): Promise<void> {
  app.post(url, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.raw.headers.accept || request.raw.headers.accept === '*/*') {
      request.raw.headers.accept = 'application/json, text/event-stream';
      request.raw.rawHeaders.push('Accept', 'application/json, text/event-stream');
    }

    const mcpServer = await createMcpServer();
    const transport = createStatelessStreamableHttpTransport();
    await mcpServer.connect(transport);

    reply.hijack();
    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } finally {
      await transport.close();
      await mcpServer.close();
    }
  });
}
