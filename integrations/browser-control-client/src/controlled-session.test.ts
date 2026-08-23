import { describe, expect, it, vi } from 'vitest';
import type {
  BrowserExecutionCapabilities,
  BrowserOperationRecord,
  BrowserSessionView,
  IssuedBrowserLease,
} from '@nebula-link-evo/shared/types/browser-execution';
import { ControlledBrowserSession } from './controlled-session.js';
import { BrowserControlError, BrowserOutcomeUnknownError } from './errors.js';

function capabilities(): BrowserExecutionCapabilities {
  return {
    schema: 'nebula.service-capabilities/1.0',
    service: 'proxy-adapter',
    serviceVersion: '1.0.0',
    protocols: {
      browserExecution: { major: 1, minor: 0 },
      browserOperation: { major: 1, minor: 0 },
    },
    features: { localControlPlane: true },
    limits: {},
    generatedAt: new Date().toISOString(),
  };
}

function session(activeLeases: BrowserSessionView['activeLeases'] = []): BrowserSessionView {
  return {
    id: 'session-1',
    status: 'active',
    processEpoch: 1,
    viewport: { width: 1280, height: 720 },
    cdpPort: 9222,
    createdAt: new Date().toISOString(),
    tabs: [{ id: 'tab-1', url: 'about:blank', title: '', isActive: true }],
    activeLeases,
    liveView: { available: true, controlAllowed: false },
  };
}

function lease(
  id = 'lease-1',
  expiresAt = new Date(Date.now() + 300_000).toISOString()
): IssuedBrowserLease {
  return {
    lease: {
      id,
      sessionId: 'session-1',
      mode: 'control',
      sequence: Number(id.split('-')[1] ?? 1),
      processEpoch: 1,
      status: 'active',
      policy: { tabIds: ['tab-1'], operations: ['url', 'navigate'] },
      expiresAt,
      createdAt: new Date().toISOString(),
    },
    token: `token-${id}`,
    tokenIssued: true,
  };
}

function operation(operationId: string, status = 'succeeded'): BrowserOperationRecord {
  return {
    schema: 'nebula.browser.operation-result/1.0',
    operationId,
    requestHash: 'hash',
    sessionId: 'session-1',
    leaseId: 'lease-1',
    leaseSequence: 1,
    tabId: 'tab-1',
    kind: 'observe',
    operation: 'url',
    status: status as BrowserOperationRecord['status'],
    queueSequence: 1,
    acceptedAt: new Date().toISOString(),
    artifacts: [],
  };
}

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    getCapabilities: vi.fn(async () => capabilities()),
    createSession: vi.fn(async () => session()),
    getSession: vi.fn(async () => session()),
    createLease: vi.fn(async () => lease()),
    revokeLease: vi.fn(async () => undefined),
    executeOperation: vi.fn(async (_credentials, _tabId, request) =>
      operation((request as { operationId: string }).operationId)
    ),
    getOperation: vi.fn(async (operationId) => operation(String(operationId))),
    cancelOperation: vi.fn(async (operationId) => operation(String(operationId), 'cancelled')),
    closeSession: vi.fn(async () => session()),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('ControlledBrowserSession', () => {
  it('hides lease tokens from public state and requires authorization for acts', async () => {
    const client = fakeClient();
    const controlled = new ControlledBrowserSession(client as never, { ownerId: 'owner-1' });

    await controlled.start();
    expect(JSON.stringify(controlled.getState())).not.toContain('token-lease-1');
    await expect(
      controlled.execute({
        key: 'one',
        kind: 'act',
        operation: 'navigate',
        args: { url: 'https://example.test' },
      })
    ).rejects.toMatchObject({ code: 'permission_denied' });
    expect(client.executeOperation).not.toHaveBeenCalled();

    await controlled.execute(
      { key: 'one', kind: 'act', operation: 'navigate', args: { url: 'https://example.test' } },
      async () => true
    );
    expect(client.executeOperation).toHaveBeenCalledOnce();
  });

  it('uses a stable operation id and recovers from transport failure through the ledger', async () => {
    const executeOperation = vi.fn(async () => {
      throw new Error('transport closed');
    });
    const client = fakeClient({ executeOperation });
    const controlled = new ControlledBrowserSession(client as never, { ownerId: 'owner-1' });

    const result = await controlled.execute({ key: 'step-1', kind: 'observe', operation: 'url' });
    expect(result.status).toBe('succeeded');
    const recoveredId = client.getOperation.mock.calls[0]?.[0];
    expect(recoveredId).toMatch(/^[0-9a-f-]{36}$/);
    expect(executeOperation).toHaveBeenCalledOnce();
  });

  it('returns outcome_unknown without replay when the ledger is non-terminal', async () => {
    const client = fakeClient({
      executeOperation: vi.fn(async () => {
        throw new Error('transport closed');
      }),
      getOperation: vi.fn(async (operationId) => operation(String(operationId), 'running')),
    });
    const controlled = new ControlledBrowserSession(client as never, { ownerId: 'owner-1' });

    await expect(
      controlled.execute({ key: 'step-1', kind: 'observe', operation: 'url' })
    ).rejects.toBeInstanceOf(BrowserOutcomeUnknownError);
    expect(client.executeOperation).toHaveBeenCalledOnce();
  });

  it('preserves a proven domain failure instead of converting it to outcome_unknown', async () => {
    const domainError = new BrowserControlError(
      'permission_denied',
      'The lease cannot perform this operation'
    );
    const client = fakeClient({
      executeOperation: vi.fn(async () => {
        throw domainError;
      }),
    });
    const controlled = new ControlledBrowserSession(client as never, { ownerId: 'owner-1' });

    await expect(
      controlled.execute({ key: 'step-1', kind: 'observe', operation: 'url' })
    ).rejects.toBe(domainError);
    expect(client.getOperation).not.toHaveBeenCalled();
  });

  it('rotates an expiring lease at the serialized operation boundary', async () => {
    const createLease = vi
      .fn()
      .mockResolvedValueOnce(lease('lease-1', new Date(Date.now() + 5_000).toISOString()))
      .mockResolvedValueOnce(lease('lease-2'));
    const client = fakeClient({ createLease });
    const controlled = new ControlledBrowserSession(client as never, {
      ownerId: 'owner-1',
      leaseRefreshSkewSeconds: 30,
    });

    await controlled.execute({ key: 'step-1', kind: 'observe', operation: 'url' });
    expect(client.revokeLease).toHaveBeenCalledOnce();
    expect(createLease).toHaveBeenCalledTimes(2);
    expect(controlled.getState()).toMatchObject({ leaseId: 'lease-2', leaseSequence: 2 });
  });

  it('does not issue a replacement lease when revocation cannot be proven', async () => {
    const createLease = vi.fn(async () =>
      lease('lease-1', new Date(Date.now() + 5_000).toISOString())
    );
    const client = fakeClient({
      createLease,
      revokeLease: vi.fn(async () => {
        throw new BrowserControlError('dependency_unavailable', 'network closed', true);
      }),
    });
    const controlled = new ControlledBrowserSession(client as never, {
      ownerId: 'owner-1',
      leaseRefreshSkewSeconds: 30,
    });

    await expect(
      controlled.execute({ key: 'step-1', kind: 'observe', operation: 'url' })
    ).rejects.toMatchObject({ code: 'dependency_unavailable' });
    expect(createLease).toHaveBeenCalledOnce();
    expect(client.executeOperation).not.toHaveBeenCalled();
  });

  it('does not attach when another control lease owns the requested session', async () => {
    const existing = lease().lease;
    const client = fakeClient({ getSession: vi.fn(async () => session([existing])) });
    const controlled = new ControlledBrowserSession(client as never, {
      attachSessionId: 'session-1',
    });

    await expect(controlled.start()).rejects.toMatchObject({ code: 'browser_busy' });
    expect(client.createLease).not.toHaveBeenCalled();
  });

  it('closes owned sessions but only revokes leases for attached sessions', async () => {
    const ownedClient = fakeClient();
    const owned = new ControlledBrowserSession(ownedClient as never);
    await owned.start();
    await owned.close();
    expect(ownedClient.closeSession).toHaveBeenCalledOnce();
    expect(ownedClient.revokeLease).not.toHaveBeenCalled();

    const attachedClient = fakeClient();
    const attached = new ControlledBrowserSession(attachedClient as never, {
      attachSessionId: 'session-1',
    });
    await attached.start();
    await attached.close();
    expect(attachedClient.revokeLease).toHaveBeenCalledOnce();
    expect(attachedClient.closeSession).not.toHaveBeenCalled();
  });

  it('keeps the hidden binding when cleanup fails so close can be retried', async () => {
    const closeSession = vi
      .fn()
      .mockRejectedValueOnce(new BrowserControlError('dependency_unavailable', 'network closed'))
      .mockResolvedValueOnce(session());
    const client = fakeClient({ closeSession });
    const controlled = new ControlledBrowserSession(client as never);
    await controlled.start();

    await expect(controlled.close()).rejects.toMatchObject({ code: 'dependency_unavailable' });
    expect(controlled.getState()).toBeDefined();
    await controlled.close();
    expect(controlled.getState()).toBeUndefined();
    expect(closeSession).toHaveBeenCalledTimes(2);
  });
});
