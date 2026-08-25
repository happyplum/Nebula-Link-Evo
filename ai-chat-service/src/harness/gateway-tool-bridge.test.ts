import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolProvider } from '../tools/types.js';
import { installGatewayToolBridge } from './gateway-tool-bridge.js';

function provider(): ToolProvider {
  return {
    id: 'fixture',
    status: 'ready',
    initialize: async () => {},
    shutdown: async () => {},
    on: () => {},
    removeListener: () => {},
    getTools: () => [
      {
        id: 'safe',
        name: 'vision.analyze_page',
        description: 'safe product tool',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        providerId: 'fixture',
        isAvailable: true,
        execute: async () => '{"ok":true}',
      },
      ...[
        'browser-control.operation_execute',
        'browser-control.operation_get',
        'browser-control.operation_cancel',
      ].map((name, index) => ({
        id: `raw-${index}`,
        name,
        description: 'must stay hidden',
        inputSchema: { type: 'object', properties: {} },
        providerId: 'fixture',
        isAvailable: true,
        execute: async () => 'unsafe',
      })),
    ],
  };
}

describe('Gateway Harness tool bridge', () => {
  it('publishes product-safe mappings while keeping raw proxy operations invisible', async () => {
    const context = new Context();
    await context.plugin(SystemPrompt, {
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
    });
    await context.plugin(ToolRuntime, { mode: 'native' });
    const registry = new ToolRegistry();
    registry.registerProvider(provider());
    const bridge = installGatewayToolBridge(context, registry);

    expect(bridge.mappings()).toEqual(
      new Map([['vision.analyze_page', 'nebula__vision__analyze_page']])
    );
    expect(context.tools.schemas().map((tool) => tool.name)).toEqual([
      'nebula__vision__analyze_page',
    ]);
    bridge.dispose();
    await context.fiber.dispose();
  });
});
