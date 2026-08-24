import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStreamableHttpMcpRoute } from './transport.js';
import { registerGatewayToolsToMcpServer } from '../tools/adapters/mcp-server.js';

describe('registerStreamableHttpMcpRoute', () => {
  it('rejects the optional GET SSE stream with the protocol-compatible 405 response', async () => {
    const app = Fastify();
    const createMcpServer = vi.fn<() => McpServer>();

    await registerStreamableHttpMcpRoute(app, createMcpServer);

    const response = await app.inject({
      method: 'GET',
      url: '/mcp',
      headers: { accept: 'text/event-stream' },
    });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe('POST');
    expect(createMcpServer).not.toHaveBeenCalled();

    await app.close();
  });

  it('preserves structured tool failures as isError across the real /mcp boundary', async () => {
    const app = Fastify();
    await registerStreamableHttpMcpRoute(app, () => {
      const server = new McpServer({ name: 'contract-test', version: '1.0.0' });
      registerGatewayToolsToMcpServer(server, [
        {
          id: 'contract:error',
          name: 'browser-control.operation_get',
          description: 'contract error',
          inputSchema: {
            type: 'object',
            properties: { operationId: { type: 'string' } },
            required: ['operationId'],
          },
          providerId: 'contract',
          isAvailable: true,
          execute: async () => {
            throw new Error(
              JSON.stringify({ code: 'lease_expired', message: 'expired', retryable: false })
            );
          },
        },
      ]);
      return server;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'browser-control.operation_get', arguments: { operationId: 'op-1' } },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ code: 'lease_expired', message: 'expired', retryable: false }),
          },
        ],
      },
    });
    await app.close();
  });
});
