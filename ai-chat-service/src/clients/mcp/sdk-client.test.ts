import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../../config/schema.js';

const mocks = vi.hoisted(() => {
  const streamableUrls: string[] = [];
  const stdioCommands: string[] = [];
  const callToolRequests: Array<{ readonly name: string; readonly arguments?: Record<string, unknown> }> = [];

  class MockStreamableHTTPClientTransport {
    onclose?: () => void;
    onerror?: (error: Error) => void;

    constructor(url: URL) {
      streamableUrls.push(url.toString());
    }

    async close(): Promise<void> {}
  }

  class MockStdioClientTransport {
    onclose?: () => void;
    onerror?: (error: Error) => void;

    constructor(params: { readonly command: string }) {
      stdioCommands.push(params.command);
    }

    async close(): Promise<void> {}
  }

  class MockClient {
    onclose?: () => void;

    async connect(): Promise<void> {}

    async listTools(): Promise<{ readonly tools: readonly [{ readonly name: 'browser-control.screenshot'; readonly description: 'Take screenshot'; readonly inputSchema: { readonly type: 'object' } }] }> {
      return {
        tools: [
          {
            name: 'browser-control.screenshot',
            description: 'Take screenshot',
            inputSchema: { type: 'object' },
          },
        ],
      };
    }

    async callTool(request: { readonly name: string; readonly arguments?: Record<string, unknown> }): Promise<{ readonly content: readonly [{ readonly type: 'text'; readonly text: '{"ok":true}' }] }> {
      callToolRequests.push(request);
      return { content: [{ type: 'text', text: '{"ok":true}' }] };
    }
  }

  return {
    callToolRequests,
    streamableUrls,
    stdioCommands,
    MockClient,
    MockStdioClientTransport,
    MockStreamableHTTPClientTransport,
  };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: mocks.MockClient,
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mocks.MockStdioClientTransport,
  getDefaultEnvironment: () => ({}),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mocks.MockStreamableHTTPClientTransport,
}));

import { MCPSDKClient } from './sdk-client.js';

function createConfig(): ResolvedConfig {
  return {
    version: '2.0',
    providers: {},
    defaults: { mode: 'unified', decision: { provider: 'glm', model: 'test' } },
    settings: {
      timeout: 30000,
      maxRetries: 3,
      temperature: 0.2,
      maxTokens: 1000,
      maxSteps: 1,
      contextWindowTokens: 131072,
    },
    mcp: {
      enabled: true,
      servers: {
        gateway: {
          enabled: true,
          command: '',
          args: [],
          env: {},
          url: 'http://127.0.0.1:3000/mcp',
        },
      },
    },
  };
}

describe('MCPSDKClient HTTP transport', () => {
  beforeEach(() => {
    mocks.callToolRequests.length = 0;
    mocks.streamableUrls.length = 0;
    mocks.stdioCommands.length = 0;
  });

  it('uses StreamableHTTP transport for url servers and preserves browser-control tool metadata', async () => {
    const client = new MCPSDKClient(createConfig());

    await client.initialize();

    expect(mocks.streamableUrls).toEqual(['http://127.0.0.1:3000/mcp']);
    expect(mocks.stdioCommands).toEqual([]);
    expect(client.getAvailableTools()).toEqual([
      expect.objectContaining({
        name: 'browser-control.screenshot',
        serverName: 'gateway',
        originalName: 'browser-control.screenshot',
      }),
    ]);

    await client.callTool('gateway', 'browser-control.screenshot', { format: 'png' });

    expect(mocks.callToolRequests).toEqual([{ name: 'browser-control.screenshot', arguments: { format: 'png' } }]);
    await client.shutdown();
  });
});
