import { describe, expect, it, vi } from 'vitest';
import { BrowserExecutionError } from '../browser-execution/errors.js';
import type { BrowserExecutionService } from '../browser-execution/service.js';
import { BrowserClient } from '../browser-client.js';
import { BrowserExecutionToolsProvider } from '../tools/providers/browser-execution-tools-provider.js';
import type { GatewayTool } from '../tools/types.js';

function requireTool(provider: BrowserExecutionToolsProvider, suffix: string): GatewayTool {
  const tool = provider.getTools().find((candidate) => candidate.name.endsWith(suffix));
  if (!tool) throw new Error(`Missing fixture tool ${suffix}`);
  return tool;
}

describe('BrowserExecutionToolsProvider', () => {
  it('exposes only the three controlled MCP tools', async () => {
    const service = {
      executeOperation: vi.fn(),
      getOperation: vi.fn(),
      cancelOperation: vi.fn(),
    } as unknown as BrowserExecutionService;
    const provider = new BrowserExecutionToolsProvider(service);

    await provider.initialize();

    expect(provider.getTools().map((tool) => tool.name)).toEqual([
      'browser-control.operation_execute',
      'browser-control.operation_get',
      'browser-control.operation_cancel',
    ]);
  });

  it('forwards the hidden execution envelope to the durable service', async () => {
    const result = { operationId: 'op-1', status: 'succeeded' };
    const executeOperation = vi.fn(async () => result);
    const service = {
      executeOperation,
      getOperation: vi.fn(),
      cancelOperation: vi.fn(),
    } as unknown as BrowserExecutionService;
    const provider = new BrowserExecutionToolsProvider(service);
    await provider.initialize();
    const tool = requireTool(provider, 'operation_execute');

    const output = await tool.execute({
      sessionId: 'session-1',
      leaseId: 'lease-1',
      leaseToken: 'secret',
      tabId: 'tab-1',
      request: {
        schema: 'nebula.browser.operation/1.0',
        operationId: 'op-1',
        leaseSequence: 1,
        deadlineAt: '2099-01-01T00:00:00.000Z',
        kind: 'observe',
        operation: 'url',
      },
    });

    expect(JSON.parse(output)).toEqual(result);
    expect(executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        leaseId: 'lease-1',
        leaseToken: 'secret',
        tabId: 'tab-1',
      })
    );
  });

  it('rejects unknown tool envelope fields', async () => {
    const service = {
      executeOperation: vi.fn(),
      getOperation: vi.fn(),
      cancelOperation: vi.fn(),
    } as unknown as BrowserExecutionService;
    const provider = new BrowserExecutionToolsProvider(service);
    await provider.initialize();
    const tool = requireTool(provider, 'operation_get');

    await expect(tool.execute({ operationId: 'op-1', unexpected: true })).rejects.toThrow(
      'Unexpected browser execution tool fields'
    );
    expect(service.getOperation).not.toHaveBeenCalled();
  });

  it('preserves structured browser problems across the MCP text envelope', async () => {
    const service = {
      executeOperation: vi.fn(),
      getOperation: vi.fn(() => {
        throw new BrowserExecutionError('lease_expired', 'expired');
      }),
      cancelOperation: vi.fn(),
    } as unknown as BrowserExecutionService;
    const provider = new BrowserExecutionToolsProvider(service);
    await provider.initialize();
    const tool = requireTool(provider, 'operation_get');

    await expect(tool.execute({ operationId: 'op-1' })).rejects.toSatisfy((error: unknown) => {
      const problem = JSON.parse((error as Error).message) as Record<string, unknown>;
      expect(problem).toMatchObject({
        code: 'lease_expired',
        message: 'expired',
        retryable: false,
      });
      expect(problem.correlationId).toEqual(expect.any(String));
      return true;
    });
  });
});

describe('BrowserClient direct-access arbiter', () => {
  it('blocks direct writes and capture before they reach Playwright', async () => {
    const client = new BrowserClient();
    const gate = {
      assertDirectBrowserAccess: vi.fn((kind: 'read' | 'capture' | 'write') => {
        throw new BrowserExecutionError('browser_busy', `${kind} blocked`);
      }),
    };
    client.setAccessArbiter(gate);

    await expect(client.openBrowser()).rejects.toMatchObject({ code: 'browser_busy' });
    await expect(client.getSimplifiedDOM()).rejects.toMatchObject({ code: 'browser_busy' });
    expect(gate.assertDirectBrowserAccess).toHaveBeenNthCalledWith(1, 'write');
    expect(gate.assertDirectBrowserAccess).toHaveBeenNthCalledWith(2, 'capture');
  });
});
