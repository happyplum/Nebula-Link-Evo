import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { MCPSDKClient, MCPTool } from '../../clients/mcp/sdk-client.js';
import { MCPClientProvider } from './mcp-client-provider.js';

class FakeMCPClient extends EventEmitter {
  readonly callTool = vi.fn(async () => ({ text: 'screenshot ok' }));

  getAvailableTools(): MCPTool[] {
    return [
      {
        name: 'browser-control.screenshot',
        serverName: 'gateway',
        originalName: 'browser-control.screenshot',
        description: 'Take screenshot',
        inputSchema: { type: 'object' },
      },
      {
        name: 'browser-control.operation_execute',
        serverName: 'gateway',
        originalName: 'browser-control.operation_execute',
        description: 'Scoped browser operation',
        inputSchema: { type: 'object' },
      },
    ];
  }
}

describe('MCPClientProvider', () => {
  it('exposes browser-control tools from the gateway and calls them through MCP', async () => {
    const fakeClient = new FakeMCPClient();
    const provider = new MCPClientProvider(fakeClient as MCPSDKClient);

    await provider.initialize();
    const tool = provider
      .getTools()
      .find((candidate) => candidate.name === 'browser-control.screenshot');

    expect(tool).toBeDefined();
    await expect(tool?.execute({ format: 'png' })).resolves.toBe('screenshot ok');
    expect(fakeClient.callTool).toHaveBeenCalledWith('gateway', 'browser-control.screenshot', {
      format: 'png',
    });
  });

  it('keeps model-hidden browser operation tools out of ordinary Chat', async () => {
    const fakeClient = new FakeMCPClient();
    const provider = new MCPClientProvider(fakeClient as MCPSDKClient);

    await provider.initialize();

    expect(provider.getTools().map((tool) => tool.name)).toEqual(['browser-control.screenshot']);
  });
});
