import { describe, expect, it } from 'vitest';
import { AppService } from './app-service.js';

function buildServiceWithVisionState(options: {
  readonly hasVisionTool: boolean;
  readonly gatewayRunning: boolean;
}): AppService {
  const service = new AppService();
  const serviceInternals = service as unknown as {
    toolRegistry: {
      getAvailableTools(options?: {
        consumer?: 'chat' | 'mcp-server' | 'all';
      }): Array<{ name: string }>;
    };
  };

  serviceInternals.toolRegistry = {
    getAvailableTools: () => (options.hasVisionTool ? [{ name: 'vision.resolve_target' }] : []),
  };
  service.setHarnessMcpInventory(
    ['gateway'],
    options.gatewayRunning ? ['mcp__gateway__browser-control_operation_execute'] : []
  );

  return service;
}

describe('AppService.testAIConnectivity vision status', () => {
  it('reports vision degraded when the gateway MCP server is not running', async () => {
    const service = buildServiceWithVisionState({ hasVisionTool: true, gatewayRunning: false });

    const result = await service.testAIConnectivity();

    expect(result.visionAgent.status).toBe('degraded');
    expect(result.visionAgent.tools).toEqual(['vision.resolve_target']);
    expect(result.visionAgent.error).toContain('Gateway MCP server is unavailable');
  });

  it('reports vision connected when the vision tool and gateway MCP server are both available', async () => {
    const service = buildServiceWithVisionState({ hasVisionTool: true, gatewayRunning: true });

    const result = await service.testAIConnectivity();

    expect(result.visionAgent.status).toBe('connected');
    expect(result.visionAgent.tools).toEqual(['vision.resolve_target']);
    expect(result.visionAgent.error).toBeNull();
  });
});
