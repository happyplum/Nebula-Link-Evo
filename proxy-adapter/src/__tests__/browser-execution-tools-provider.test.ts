import { describe, expect, it, vi } from 'vitest';
import { BrowserExecutionError } from '../browser-execution/errors.js';
import type { BrowserExecutionService } from '../browser-execution/service.js';
import { BrowserClient } from '../browser-client.js';
import { createBrowserTools } from '../browser-tools/index.js';
import { BrowserExecutionToolsProvider } from '../tools/providers/browser-execution-tools-provider.js';

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
    expect(
      provider
        .getTools()
        .every((tool) => tool.exposeTo.length === 1 && tool.exposeTo[0] === 'mcp-server')
    ).toBe(true);
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
    const tool = provider.getTools().find((item) => item.name.endsWith('operation_execute'))!;

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
    const tool = provider.getTools().find((item) => item.name.endsWith('operation_get'))!;

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
    const tool = provider.getTools().find((item) => item.name.endsWith('operation_get'))!;

    const output = JSON.parse(await tool.execute({ operationId: 'op-1' })) as Record<
      string,
      unknown
    >;

    expect(output).toMatchObject({
      code: 'lease_expired',
      message: 'expired',
      retryable: false,
    });
    expect(output.correlationId).toEqual(expect.any(String));
  });
});

describe('BrowserClient controlled-session gate', () => {
  it('blocks legacy writes and direct capture before they reach Playwright', async () => {
    const client = new BrowserClient();
    const gate = {
      assertLegacyBrowserAccess: vi.fn((kind: 'read' | 'capture' | 'write') => {
        throw new BrowserExecutionError('browser_busy', `${kind} blocked`);
      }),
    };
    client.setAccessGate(gate);

    await expect(client.openBrowser()).rejects.toMatchObject({ code: 'browser_busy' });
    await expect(client.getSimplifiedDOM()).rejects.toMatchObject({ code: 'browser_busy' });
    expect(gate.assertLegacyBrowserAccess).toHaveBeenNthCalledWith(1, 'write');
    expect(gate.assertLegacyBrowserAccess).toHaveBeenNthCalledWith(2, 'capture');

    const legacyTool = createBrowserTools(client)['browser-control.browser_open'];
    expect(await legacyTool.execute({})).toBe('Error [browser_busy]: write blocked');
  });
});
