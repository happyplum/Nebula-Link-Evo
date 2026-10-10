import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BrowserOperationRecordSchema } from '@nebula-link-evo/shared/types/browser-operation-result';
import {
  ACT_OPERATIONS,
  OBSERVE_OPERATIONS,
} from '@nebula-link-evo/shared/types/browser-execution';
import { BrowserExecutionError } from '../browser-execution/errors.js';
import type { BrowserExecutionService } from '../browser-execution/service.js';
import { BrowserClient } from '../browser-client.js';
import { BrowserExecutionToolsProvider } from './browser-execution-tools-provider.js';
import type { GatewayTool } from './types.js';
import { BrowserTargetRefV1Schema } from '@nebula-link-evo/shared/types/browser-target';
import { jsonPropertyToZod } from './adapters/json-schema-to-zod.js';
import { registerGatewayToolsToMcpServer } from './adapters/mcp-server.js';

function requireTool(provider: BrowserExecutionToolsProvider, suffix: string): GatewayTool {
  const tool = provider.getTools().find((candidate) => candidate.name.endsWith(suffix));
  if (!tool) throw new Error(`Missing fixture tool ${suffix}`);
  return tool;
}

describe('BrowserExecutionToolsProvider', () => {
  it('shares the output schema and validates nested results through the real MCP SDK', async () => {
    const valid = {
      schema: 'nebula.browser.operation-result/1.0',
      operationId: 'op-1',
      requestHash: 'hash-1',
      sessionId: 'session-1',
      leaseId: 'lease-1',
      leaseSequence: -1,
      kind: 'observe',
      operation: 'dom_snapshot',
      status: 'succeeded',
      queueSequence: -1,
      acceptedAt: 'accepted',
      startedAt: 'started',
      completedAt: 'completed',
      tabId: 'tab-1',
      resolvedTarget: { semantic: '', strategy: 'role', candidateIndex: 0, matchedCount: 0 },
      actual: { free: [false, null, 1] },
      artifacts: [
        {
          id: 'artifact-1',
          kind: 'dom_snapshot',
          sha256: 'a'.repeat(64),
          mimeType: 'application/json',
          sizeBytes: 1,
          snapshotId: 'snapshot-1',
        },
      ],
      error: {
        code: 'error',
        message: 'message',
        retryable: false,
        correlationId: 'c-1',
        details: { free: true },
      },
    };
    let operation: unknown = valid;
    const service = { getOperation: vi.fn(() => operation) } as unknown as BrowserExecutionService;
    const provider = new BrowserExecutionToolsProvider(service);
    await provider.initialize();
    for (const tool of provider.getTools())
      expect(tool.outputSchema).toBe(BrowserOperationRecordSchema);

    const output = jsonPropertyToZod(requireTool(provider, 'operation_get').outputSchema);
    for (const [kind, operations] of [
      ['observe', OBSERVE_OPERATIONS],
      ['act', ACT_OPERATIONS],
    ] as const) {
      for (const name of operations) {
        for (const status of [
          'queued',
          'running',
          'succeeded',
          'failed',
          'cancelled',
          'outcome_unknown',
        ]) {
          expect(output.safeParse({ ...valid, kind, operation: name, status }).success).toBe(true);
        }
      }
    }

    const server = new McpServer({ name: 'operation-contract-test', version: '1.0.0' });
    const client = new Client({ name: 'operation-contract-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    registerGatewayToolsToMcpServer(server, provider.getTools());
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect((await client.listTools()).tools).toHaveLength(3);
      const args = { name: 'browser-control.operation_get', arguments: { operationId: 'op-1' } };
      expect(await client.callTool(args)).toMatchObject({ structuredContent: valid });
      for (const invalid of [
        { ...valid, status: 'done' },
        { ...valid, acceptedAt: undefined },
        { ...valid, operation: 'unsupported' },
        { ...valid, unexpected: true },
        { ...valid, artifacts: [{ ...valid.artifacts[0], sizeBytes: 0 }] },
        { ...valid, artifacts: [{ ...valid.artifacts[0], sha256: 'invalid' }] },
        { ...valid, artifacts: [{ ...valid.artifacts[0], snapshotId: '' }] },
        { ...valid, artifacts: [{ ...valid.artifacts[0], unexpected: true }] },
        { ...valid, resolvedTarget: { ...valid.resolvedTarget, candidateIndex: -1 } },
        { ...valid, resolvedTarget: { ...valid.resolvedTarget, strategy: 'coordinates' } },
        { ...valid, resolvedTarget: { ...valid.resolvedTarget, unexpected: true } },
        { ...valid, error: { code: 'error', message: 'message', retryable: false } },
        { ...valid, error: { ...valid.error, unexpected: true } },
      ]) {
        operation = invalid;
        const result = await client.callTool(args);
        expect(result.isError).toBe(true);
        expect(result).not.toHaveProperty('structuredContent');
      }
    } finally {
      await client.close();
      await server.close();
      await provider.shutdown();
    }
  });

  it('rejects unknown operation names in the MCP output contract', async () => {
    const provider = new BrowserExecutionToolsProvider({} as BrowserExecutionService);
    await provider.initialize();
    const output = jsonPropertyToZod(requireTool(provider, 'operation_get').outputSchema);
    const record = {
      schema: 'nebula.browser.operation-result/1.0',
      operationId: 'op-1',
      requestHash: 'hash-1',
      sessionId: 'session-1',
      leaseId: 'lease-1',
      leaseSequence: 1,
      kind: 'observe',
      operation: 'unsupported',
      status: 'succeeded',
      queueSequence: 1,
      acceptedAt: 'accepted',
      artifacts: [],
    };
    expect(output.safeParse(record).success).toBe(false);
  });

  it('compiles the shared target schema for every supported locator strategy', async () => {
    const provider = new BrowserExecutionToolsProvider({} as BrowserExecutionService);
    await provider.initialize();
    const tool = requireTool(provider, 'operation_execute');
    const request = tool.inputSchema.properties?.request as { properties: { target: unknown } };
    expect(request.properties.target).toBe(BrowserTargetRefV1Schema);
    const target = jsonPropertyToZod(request.properties.target);
    const base = { semantic: 'Login', expected: { cardinality: 'exactly_one' } };
    for (const candidate of [
      { strategy: 'role', role: 'button', name: 'Login', exact: true },
      ...['test_id', 'label', 'placeholder', 'text', 'css', 'xpath'].map((strategy) => ({
        strategy,
        value: 'login',
      })),
    ]) {
      expect(target.safeParse({ ...base, candidates: [candidate] }).success).toBe(true);
    }
    expect(
      target.safeParse({
        ...base,
        candidates: [{ strategy: 'role', role: 'button', value: 'extra' }],
      }).success
    ).toBe(false);
    expect(
      target.safeParse({ ...base, candidates: [{ strategy: 'text', value: '' }] }).success
    ).toBe(false);
    expect(
      target.safeParse({ ...base, candidates: [{ strategy: 'css', value: 'x'.repeat(2001) }] })
        .success
    ).toBe(false);
  });

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
