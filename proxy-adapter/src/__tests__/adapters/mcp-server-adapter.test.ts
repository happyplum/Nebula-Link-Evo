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
    isAvailable: true,
    execute: vi.fn(async () => 'result-ok'),
    ...overrides,
  };
}

function makeMockServer() {
  return {
    registerTool: vi.fn(),
  };
}

describe('registerGatewayToolsToMcpServer', () => {
  it('should register an available tool on the MCP server', () => {
    const server = makeMockServer();
    const tool = makeTool({ name: 'browser-control.click' });

    registerGatewayToolsToMcpServer(server as never, [tool]);

    expect(server.registerTool).toHaveBeenCalledOnce();
    const [name, config, handler] = server.registerTool.mock.calls[0];
    expect(name).toBe('browser-control.click');
    expect(config.description).toBe('desc');
    expect(handler).toBeTypeOf('function');
  });

  it('should skip unavailable tools', () => {
    const server = makeMockServer();
    const tool = makeTool({ name: 'hidden', isAvailable: false });

    registerGatewayToolsToMcpServer(server as never, [tool]);

    expect(server.registerTool).not.toHaveBeenCalled();
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

    const handler = server.registerTool.mock.calls[0][2];
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

    const handler = server.registerTool.mock.calls[0][2];
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

    expect(server.registerTool).toHaveBeenCalledOnce();
    const config = server.registerTool.mock.calls[0][1];
    expect(config.inputSchema.parse({ mode: 'fast' })).toEqual({ mode: 'fast' });
  });

  it('should register no tools for empty array', () => {
    const server = makeMockServer();

    registerGatewayToolsToMcpServer(server as never, []);

    expect(server.registerTool).not.toHaveBeenCalled();
  });

  it('compiles additionalProperties false into strict nested validation', () => {
    const server = makeMockServer();
    const tool = makeTool({
      name: 'strict-tool',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          request: {
            type: 'object',
            additionalProperties: false,
            properties: { operationId: { type: 'string' } },
            required: ['operationId'],
          },
        },
        required: ['request'],
      },
    });

    registerGatewayToolsToMcpServer(server as never, [tool]);
    const inputSchema = server.registerTool.mock.calls[0][1].inputSchema;
    expect(() => inputSchema.parse({ request: { operationId: 'op-1', injected: true } })).toThrow();
  });

  it('compiles unions, integer bounds, string patterns and strict empty objects', () => {
    const server = makeMockServer();
    const tool = makeTool({
      name: 'constraint-tool',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          selector: {
            oneOf: [
              { type: 'string', pattern: '^css:', minLength: 5 },
              { type: 'integer', minimum: 1, maximum: 2 },
            ],
          },
          empty: { type: 'object', additionalProperties: false },
        },
        required: ['selector', 'empty'],
      },
    });

    registerGatewayToolsToMcpServer(server as never, [tool]);
    const inputSchema = server.registerTool.mock.calls[0][1].inputSchema;
    expect(inputSchema.parse({ selector: 'css:a', empty: {} })).toEqual({
      selector: 'css:a',
      empty: {},
    });
    expect(() => inputSchema.parse({ selector: 3, empty: {} })).toThrow();
    expect(() => inputSchema.parse({ selector: 'xpath:a', empty: { injected: true } })).toThrow();
  });
});
