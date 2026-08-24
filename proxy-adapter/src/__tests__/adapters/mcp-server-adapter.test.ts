import { describe, it, expect, vi } from 'vitest';
import type { GatewayTool } from '../../tools/types.js';
import { registerGatewayToolsToMcpServer } from '../../tools/adapters/mcp-server.js';

function makeTool(overrides: Partial<GatewayTool> & { name: string }): GatewayTool {
  return {
    id: 'test-tool',
    description: 'desc',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['url'],
    },
    providerId: 'test',
    exposeTo: ['mcp-server'],
    isAvailable: true,
    execute: vi.fn(async () => 'result-ok'),
    ...overrides,
  };
}

function makeMockServer() {
  return {
    tool: vi.fn(),
  };
}

describe('registerGatewayToolsToMcpServer', () => {
  it('should register an available tool on the MCP server', () => {
    const server = makeMockServer();
    const tool = makeTool({ name: 'browser-control.click' });

    registerGatewayToolsToMcpServer(server as never, [tool]);

    expect(server.tool).toHaveBeenCalledOnce();
    const [name, description, , handler] = server.tool.mock.calls[0];
    expect(name).toBe('browser-control.click');
    expect(description).toBe('desc');
    expect(handler).toBeTypeOf('function');
  });

  it('should skip unavailable tools', () => {
    const server = makeMockServer();
    const tool = makeTool({ name: 'hidden', isAvailable: false });

    registerGatewayToolsToMcpServer(server as never, [tool]);

    expect(server.tool).not.toHaveBeenCalled();
  });

  it('should return an MCP error result when execute throws', async () => {
    const server = makeMockServer();
    const tool = makeTool({
      name: 'failing',
      execute: async () => {
        throw new Error('execution failed');
      },
    });

    registerGatewayToolsToMcpServer(server as never, [tool]);

    const handler = server.tool.mock.calls[0][3];
    const result = await handler({ url: 'http://x' });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'execution failed' }],
      isError: true,
    });
  });

  it('should return String(error) for non-Error throws', async () => {
    const server = makeMockServer();
    const tool = makeTool({
      name: 'throw-string',
      execute: async () => {
        throw 'oops';
      },
    });

    registerGatewayToolsToMcpServer(server as never, [tool]);

    const handler = server.tool.mock.calls[0][3];
    const result = await handler({});

    expect(result).toEqual({
      content: [{ type: 'text', text: 'oops' }],
      isError: true,
    });
  });

  it('should convert input schema with enum to zod refine', () => {
    const server = makeMockServer();
    const tool = makeTool({
      name: 'enum-tool',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['fast', 'slow'] },
        },
        required: ['mode'],
      },
    });

    registerGatewayToolsToMcpServer(server as never, [tool]);

    expect(server.tool).toHaveBeenCalledOnce();
    // zodShape is passed as 3rd arg — just verify the call happened
    const zodShape = server.tool.mock.calls[0][2];
    expect(zodShape).toBeDefined();
  });

  it('should register no tools for empty array', () => {
    const server = makeMockServer();

    registerGatewayToolsToMcpServer(server as never, []);

    expect(server.tool).not.toHaveBeenCalled();
  });
});
