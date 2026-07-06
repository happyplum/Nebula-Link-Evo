import { describe, expect, it } from 'vitest';
import { ToolRegistry } from './registry.js';
import type { GatewayTool, ToolProvider, ToolProviderStatus } from './types.js';

class StaticProvider implements ToolProvider {
  status: ToolProviderStatus = 'ready';

  constructor(
    readonly id: string,
    private readonly tools: readonly GatewayTool[],
  ) {}

  getTools(): GatewayTool[] {
    return [...this.tools];
  }

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}

  on(): void {}

  removeListener(): void {}
}

function createTool(tool: Pick<GatewayTool, 'id' | 'name' | 'providerId'> & Partial<GatewayTool>): GatewayTool {
  return {
    description: 'test tool',
    inputSchema: { type: 'object' },
    exposeTo: ['chat'],
    isAvailable: true,
    execute: async () => 'ok',
    ...tool,
  };
}

describe('ToolRegistry MCP name collisions', () => {
  it('prefixes an external MCP tool with its server name when its raw name collides', () => {
    const registry = new ToolRegistry();
    registry.registerProvider(new StaticProvider('local', [
      createTool({ id: 'local:screenshot', name: 'screenshot', providerId: 'local' }),
    ]));
    registry.registerProvider(new StaticProvider('mcp-client', [
      createTool({
        id: 'mcp-client:gateway:screenshot',
        name: 'screenshot',
        providerId: 'mcp-client',
        source: { type: 'mcp', serverName: 'gateway', toolName: 'screenshot' },
      }),
    ]));

    const tools = registry.getAvailableTools({ consumer: 'chat' });

    expect(tools.map((tool) => tool.name)).toEqual(['screenshot', 'gateway-screenshot']);
  });
});
