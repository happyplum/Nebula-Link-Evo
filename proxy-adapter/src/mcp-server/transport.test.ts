import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStreamableHttpMcpRoute } from './transport.js';

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
});
