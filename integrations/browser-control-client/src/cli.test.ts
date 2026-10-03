import { describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';
import { BrowserControlError, BrowserOutcomeUnknownError } from './errors.js';

function testIo(stdin = '') {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
      readStdin: async () => stdin,
      env: {},
    },
    stdout,
    stderr,
  };
}

describe('nebula-browser CLI', () => {
  it('allows inactive session close without credentials and leaves active-session authority to proxy', async () => {
    const closeSession = vi
      .fn()
      .mockResolvedValueOnce({ id: 'session-1', status: 'closed' })
      .mockRejectedValueOnce(
        new BrowserControlError('permission_denied', 'control lease required')
      );
    const client = { closeSession, close: vi.fn(async () => undefined) };
    const args = ['session', 'close', 'session-1', '--idempotency-key', 'close-inactive'];
    const first = testIo();
    expect(await runCli(args, first.io, { createClient: () => client as never })).toBe(0);
    expect(closeSession).toHaveBeenCalledWith('session-1', 'close-inactive', undefined);
    const second = testIo();
    expect(await runCli(args, second.io, { createClient: () => client as never })).toBe(4);
    expect(second.stdout).toEqual([]);
    expect(second.stderr.join('\n')).toContain('permission_denied');
  });

  it('rejects explicit credential input without a lease ID', async () => {
    const { io } = testIo('test-token');
    const closeSession = vi.fn();
    expect(
      await runCli(
        ['session', 'close', 's', '--lease-token-stdin', '--idempotency-key', 'close-1'],
        io,
        { createClient: () => ({ closeSession, close: vi.fn(async () => undefined) }) as never }
      )
    ).toBe(2);
    expect(closeSession).not.toHaveBeenCalled();
  });
  it('passes the session close idempotency key before hidden lease credentials', async () => {
    const { io, stdout } = testIo();
    const closeSession = vi.fn(async () => ({ id: 'session-1', status: 'closed' }));
    const client = { closeSession, close: vi.fn(async () => undefined) };
    const code = await runCli(
      ['session', 'close', 'session-1', '--lease-id', 'lease-1', '--idempotency-key', 'close-1'],
      { ...io, env: { NEBULA_BROWSER_LEASE_TOKEN: 'test-hidden-token' } },
      { createClient: () => client as never }
    );
    expect(code).toBe(0);
    expect(closeSession).toHaveBeenCalledWith('session-1', 'close-1', {
      sessionId: 'session-1',
      leaseId: 'lease-1',
      leaseToken: 'test-hidden-token',
    });
    expect(stdout.join('\n')).not.toContain('test-hidden-token');
  });
  it('prints structured capability output', async () => {
    const { io, stdout } = testIo();
    const client = {
      getCapabilities: vi.fn(async () => ({ service: 'proxy-adapter' })),
      close: vi.fn(async () => undefined),
    };

    const code = await runCli(['capabilities'], io, {
      createClient: () => client as never,
    });

    expect(code).toBe(0);
    expect(JSON.parse(stdout[0])).toEqual({ service: 'proxy-adapter' });
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('redacts newly issued lease tokens unless token output is explicit', async () => {
    const { io, stdout } = testIo('{}');
    const client = {
      createLease: vi.fn(async () => ({
        token: 'top-secret',
        tokenIssued: true,
        lease: { id: 'lease-1' },
      })),
      close: vi.fn(async () => undefined),
    };

    const code = await runCli(
      ['lease', 'create', 'session-1', '--input', '-', '--idempotency-key', 'idem-1'],
      io,
      { createClient: () => client as never }
    );

    expect(code).toBe(0);
    expect(stdout.join('\n')).not.toContain('top-secret');
  });

  it('fails closed when batch automation contains acts without --allow-act', async () => {
    const { io, stdout } = testIo(
      JSON.stringify({
        id: 'step-1',
        kind: 'act',
        operation: 'navigate',
        args: { url: 'https://example.test' },
      })
    );
    const createClient = vi.fn();

    const code = await runCli(['run', '--input', '-'], io, { createClient });

    expect(code).toBe(4);
    expect(createClient).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
  });

  it('accepts id-based NDJSON and emits one structured result per line', async () => {
    const { io, stdout } = testIo(
      [
        { id: 'step-1', kind: 'observe', operation: 'title' },
        { id: 'step-2', kind: 'observe', operation: 'url' },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n')
    );
    const executeOperation = vi.fn(async (_credentials, _tabId, request) => ({
      schema: 'nebula.browser.operation-result/1.0',
      operationId: request.operationId,
      requestHash: 'hash',
      sessionId: 'session-1',
      leaseId: 'lease-1',
      leaseSequence: 1,
      tabId: 'tab-1',
      kind: request.kind,
      operation: request.operation,
      status: 'succeeded',
      queueSequence: 1,
      acceptedAt: new Date().toISOString(),
      artifacts: [],
    }));
    const client = {
      getCapabilities: vi.fn(async () => ({
        protocols: {
          browserExecution: { major: 1, minor: 0 },
          browserOperation: { major: 1, minor: 0 },
        },
        features: { localControlPlane: true },
      })),
      createSession: vi.fn(async () => ({
        id: 'session-1',
        status: 'active',
        tabs: [{ id: 'tab-1', isActive: true }],
      })),
      createLease: vi.fn(async () => ({
        token: 'hidden-token',
        lease: {
          id: 'lease-1',
          sequence: 1,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      })),
      executeOperation,
      closeSession: vi.fn(async () => ({})),
      close: vi.fn(async () => undefined),
    };

    const code = await runCli(['run', '--input', '-'], io, {
      createClient: () => client as never,
    });

    expect(code).toBe(0);
    expect(stdout.map((line) => JSON.parse(line).id)).toEqual(['step-1', 'step-2']);
    expect(executeOperation).toHaveBeenCalledTimes(2);
    expect(stdout.join('\n')).not.toContain('hidden-token');
  });

  it('uses distinct exit code 5 for outcome_unknown errors', async () => {
    const { io, stderr } = testIo();
    const client = {
      getOperation: vi.fn(async () => {
        throw new BrowserOutcomeUnknownError('op-1');
      }),
      close: vi.fn(async () => undefined),
    };
    const code = await runCli(['operation', 'get', 'op-1'], io, {
      createClient: () => client as never,
    });

    expect(code).toBe(5);
    expect(stderr).toHaveLength(1);
  });

  it('marks a failed operation as not ok and stops before the next NDJSON line', async () => {
    const { io, stdout } = testIo(
      [
        { id: 'failed-step', kind: 'observe', operation: 'title' },
        { id: 'must-not-run', kind: 'observe', operation: 'url' },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n')
    );
    const executeOperation = vi.fn(async (_credentials, _tabId, request) => ({
      schema: 'nebula.browser.operation-result/1.0',
      operationId: request.operationId,
      requestHash: 'hash',
      sessionId: 'session-1',
      leaseId: 'lease-1',
      leaseSequence: 1,
      tabId: 'tab-1',
      kind: request.kind,
      operation: request.operation,
      status: 'failed',
      queueSequence: 1,
      acceptedAt: new Date().toISOString(),
      artifacts: [],
    }));
    const client = {
      getCapabilities: vi.fn(async () => ({
        protocols: {
          browserExecution: { major: 1, minor: 0 },
          browserOperation: { major: 1, minor: 0 },
        },
        features: { localControlPlane: true },
      })),
      createSession: vi.fn(async () => ({
        id: 'session-1',
        status: 'active',
        tabs: [{ id: 'tab-1', isActive: true }],
      })),
      createLease: vi.fn(async () => ({
        token: 'hidden-token',
        lease: {
          id: 'lease-1',
          sequence: 1,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      })),
      executeOperation,
      closeSession: vi.fn(async () => ({})),
      close: vi.fn(async () => undefined),
    };

    const code = await runCli(['run', '--input', '-'], io, {
      createClient: () => client as never,
    });

    expect(code).toBe(4);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toMatchObject({ id: 'failed-step', ok: false });
    expect(executeOperation).toHaveBeenCalledOnce();
  });

  it('reports cleanup failure and returns a connection exit code after successful work', async () => {
    const { io, stderr } = testIo(
      JSON.stringify({ id: 'step-1', kind: 'observe', operation: 'title' })
    );
    const client = {
      getCapabilities: vi.fn(async () => ({
        protocols: {
          browserExecution: { major: 1, minor: 0 },
          browserOperation: { major: 1, minor: 0 },
        },
        features: { localControlPlane: true },
      })),
      createSession: vi.fn(async () => ({
        id: 'session-1',
        status: 'active',
        tabs: [{ id: 'tab-1', isActive: true }],
      })),
      createLease: vi.fn(async () => ({
        token: 'hidden-token',
        lease: {
          id: 'lease-1',
          sequence: 1,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      })),
      executeOperation: vi.fn(async (_credentials, _tabId, request) => ({
        schema: 'nebula.browser.operation-result/1.0',
        operationId: request.operationId,
        requestHash: 'hash',
        sessionId: 'session-1',
        leaseId: 'lease-1',
        leaseSequence: 1,
        tabId: 'tab-1',
        kind: request.kind,
        operation: request.operation,
        status: 'succeeded',
        queueSequence: 1,
        acceptedAt: new Date().toISOString(),
        artifacts: [],
      })),
      closeSession: vi.fn(async () => {
        throw new BrowserControlError('dependency_unavailable', 'cleanup failed', true);
      }),
      close: vi.fn(async () => undefined),
    };

    const code = await runCli(['run', '--input', '-'], io, {
      createClient: () => client as never,
    });

    expect(code).toBe(3);
    expect(stderr).toHaveLength(1);
    expect(JSON.parse(stderr[0])).toMatchObject({
      code: 'dependency_unavailable',
      message: 'cleanup failed',
    });
  });
});
