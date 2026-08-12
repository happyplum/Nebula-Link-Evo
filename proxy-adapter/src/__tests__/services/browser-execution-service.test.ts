import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserExecutionError } from '../../browser-execution/errors.js';
import { hashOpaqueToken, sha256 } from '../../browser-execution/hash.js';
import { BrowserExecutionRepository } from '../../browser-execution/repository.js';
import {
  BrowserExecutionService,
  type BrowserExecutionBrowser,
} from '../../browser-execution/service.js';
import type {
  BrowserLeaseRecord,
  BrowserOperationExecutionResult,
  BrowserOperationRequestV1,
  BrowserSessionRecord,
  BrowserTabSummary,
  ExecuteBrowserOperationInput,
} from '../../browser-execution/types.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class FakeBrowser implements BrowserExecutionBrowser {
  readonly open = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly getTabs = vi.fn(
    async (): Promise<BrowserTabSummary[]> => [
      { id: 'tab-1', url: 'https://example.test', title: 'Example', isActive: true },
    ]
  );
  readonly execute = vi.fn(
    async (_input: ExecuteBrowserOperationInput): Promise<BrowserOperationExecutionResult> => ({
      actual: { ok: true },
    })
  );
}

function makeService(browser: BrowserExecutionBrowser = new FakeBrowser()) {
  const repository = new BrowserExecutionRepository(':memory:');
  const service = new BrowserExecutionService({ repository, browser });
  service.initialize();
  return { service, repository, browser };
}

function operationRequest(
  leaseSequence: number,
  overrides: Partial<BrowserOperationRequestV1> = {}
): BrowserOperationRequestV1 {
  return {
    schema: 'nebula.browser.operation/1.0',
    operationId: randomUUID(),
    leaseSequence,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    kind: 'observe',
    operation: 'url',
    ...overrides,
  };
}

async function createSessionAndLease(
  service: BrowserExecutionService,
  mode: 'observe' | 'control' = 'control'
) {
  const session = await service.createSession('session-create', {});
  const issued = await service.createLease(session.id, `lease-${mode}`, { mode });
  if (!issued.token) {
    throw new Error('Expected a newly issued token');
  }
  return { session, lease: issued.lease, token: issued.token };
}

describe('BrowserExecutionService', () => {
  it('enforces one active visual session and idempotent create semantics', async () => {
    const { service, browser } = makeService();
    const first = await service.createSession('create-1', {
      viewport: { width: 1440, height: 900 },
    });
    const replay = await service.createSession('create-1', {
      viewport: { width: 1440, height: 900 },
    });

    expect(replay.id).toBe(first.id);
    expect(browser.open).toHaveBeenCalledOnce();
    expect(browser.open).toHaveBeenCalledWith({
      viewport: { width: 1440, height: 900 },
      cdpPort: 9222,
    });
    await expect(service.createSession('create-2', {})).rejects.toMatchObject({
      code: 'browser_busy',
    });
    await expect(
      service.createSession('create-1', { viewport: { width: 1280, height: 720 } })
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('returns a lease token once, stores only its hash, and limits control leases', async () => {
    const { service, repository } = makeService();
    const session = await service.createSession('create-1', {});
    const issued = await service.createLease(session.id, 'lease-1', { mode: 'control' });
    const replay = await service.createLease(session.id, 'lease-1', { mode: 'control' });

    expect(issued.token).toHaveLength(43);
    expect(issued.tokenIssued).toBe(true);
    expect(replay.token).toBeUndefined();
    expect(replay.tokenIssued).toBe(false);
    expect(repository.getLease(issued.lease.id)?.tokenHash).toBe(hashOpaqueToken(issued.token!));
    expect(JSON.stringify(issued.lease)).not.toContain(issued.token!);
    await expect(
      service.createLease(session.id, 'lease-2', { mode: 'control' })
    ).rejects.toMatchObject({ code: 'browser_busy' });
  });

  it('rejects actions through an observe lease', async () => {
    const { service } = makeService();
    const { session, lease, token } = await createSessionAndLease(service, 'observe');
    const request = operationRequest(lease.sequence, {
      kind: 'act',
      operation: 'navigate',
      args: { url: 'https://example.test/next' },
    });

    await expect(
      service.executeOperation({
        sessionId: session.id,
        leaseId: lease.id,
        leaseToken: token,
        tabId: 'tab-1',
        request,
      })
    ).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('rejects unknown request fields and non-HTTP navigation before execution', async () => {
    const browser = new FakeBrowser();
    const { service } = makeService(browser);
    const { session, lease, token } = await createSessionAndLease(service);
    const base = {
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
      tabId: 'tab-1',
    };

    await expect(
      service.executeOperation({
        ...base,
        request: {
          ...operationRequest(lease.sequence),
          unexpected: true,
        } as BrowserOperationRequestV1,
      })
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      service.executeOperation({
        ...base,
        request: operationRequest(lease.sequence, {
          kind: 'act',
          operation: 'navigate',
          args: { url: 'javascript:alert(1)' },
        }),
      })
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      service.executeOperation({
        ...base,
        request: operationRequest(lease.sequence, {
          kind: 'act',
          operation: 'press',
        }),
      })
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      service.executeOperation({
        ...base,
        request: operationRequest(lease.sequence, {
          kind: 'act',
          operation: 'scroll',
        }),
      })
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(browser.execute).not.toHaveBeenCalled();
  });

  it('disables the unauthenticated control plane for non-loopback bindings', async () => {
    const service = new BrowserExecutionService({
      repository: new BrowserExecutionRepository(':memory:'),
      browser: new FakeBrowser(),
      controlPlaneEnabled: false,
    });
    service.initialize();

    expect(service.getCapabilities().features.localControlPlane).toBe(false);
    await expect(service.createSession('remote-create', {})).rejects.toMatchObject({
      code: 'permission_denied',
    });
    service.close();
  });

  it('executes an operation once and rejects an operation ID hash conflict', async () => {
    const browser = new FakeBrowser();
    const { service } = makeService(browser);
    const { session, lease, token } = await createSessionAndLease(service);
    const request = operationRequest(lease.sequence);
    const input: ExecuteBrowserOperationInput = {
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
      tabId: 'tab-1',
      request,
    };

    const first = await service.executeOperation(input);
    const replay = await service.executeOperation(input);

    expect(first.status).toBe('succeeded');
    expect(replay).toEqual(first);
    expect(browser.execute).toHaveBeenCalledOnce();
    await expect(
      service.executeOperation({
        ...input,
        request: { ...request, operation: 'title' },
      })
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('marks an action outcome unknown when execution fails after start', async () => {
    const browser = new FakeBrowser();
    browser.execute.mockRejectedValueOnce(new Error('connection dropped'));
    const { service } = makeService(browser);
    const { session, lease, token } = await createSessionAndLease(service);
    const request = operationRequest(lease.sequence, {
      kind: 'act',
      operation: 'navigate',
      args: { url: 'https://example.test/next' },
    });

    const result = await service.executeOperation({
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
      tabId: 'tab-1',
      request,
    });

    expect(result.status).toBe('outcome_unknown');
    expect(result.error?.code).toBe('outcome_unknown');
  });

  it('cancels only queued operations while another operation owns the browser boundary', async () => {
    let releaseFirst!: () => void;
    const firstExecution = new Promise<BrowserOperationExecutionResult>((resolve) => {
      releaseFirst = () => resolve({ actual: 'first-complete' });
    });
    const browser = new FakeBrowser();
    browser.execute
      .mockImplementationOnce(async () => firstExecution)
      .mockResolvedValueOnce({ actual: 'second-complete' });
    const { service } = makeService(browser);
    const { session, lease, token } = await createSessionAndLease(service);
    const credentials = { sessionId: session.id, leaseId: lease.id, leaseToken: token };
    const firstRequest = operationRequest(lease.sequence);
    const secondRequest = operationRequest(lease.sequence, { operation: 'title' });

    const firstPromise = service.executeOperation({
      ...credentials,
      tabId: 'tab-1',
      request: firstRequest,
    });
    await vi.waitFor(() =>
      expect(service.getOperation(firstRequest.operationId).status).toBe('running')
    );
    const secondPromise = service.executeOperation({
      ...credentials,
      tabId: 'tab-1',
      request: secondRequest,
    });
    await vi.waitFor(() =>
      expect(service.getOperation(secondRequest.operationId).status).toBe('queued')
    );

    expect(() => service.cancelOperation(firstRequest.operationId, credentials)).toThrowError(
      /cannot be cancelled after it has started/
    );
    expect(service.cancelOperation(secondRequest.operationId, credentials).status).toBe(
      'cancelled'
    );
    releaseFirst();

    expect((await firstPromise).status).toBe('succeeded');
    expect((await secondPromise).status).toBe('cancelled');
    expect(browser.execute).toHaveBeenCalledOnce();
  });

  it('issues observe leases only between atomic browser operations', async () => {
    let releaseExecution!: () => void;
    const execution = new Promise<BrowserOperationExecutionResult>((resolve) => {
      releaseExecution = () => resolve({ actual: 'complete' });
    });
    const browser = new FakeBrowser();
    browser.execute.mockImplementationOnce(async () => execution);
    const { service } = makeService(browser);
    const { session, lease, token } = await createSessionAndLease(service);
    const request = operationRequest(lease.sequence);

    const operation = service.executeOperation({
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
      tabId: 'tab-1',
      request,
    });
    await vi.waitFor(() =>
      expect(service.getOperation(request.operationId).status).toBe('running')
    );

    await expect(
      service.createLease(session.id, 'observe-at-busy-boundary', { mode: 'observe' })
    ).rejects.toMatchObject({ code: 'browser_busy' });
    releaseExecution();
    await operation;

    await expect(
      service.createLease(session.id, 'observe-after-boundary', { mode: 'observe' })
    ).resolves.toMatchObject({ tokenIssued: true });
  });

  it('consumes an observe lease after its one bounded operation', async () => {
    const { service, repository } = makeService();
    const { session, lease, token } = await createSessionAndLease(service, 'observe');
    await service.executeOperation({
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
      tabId: 'tab-1',
      request: operationRequest(lease.sequence),
    });

    expect(repository.getLease(lease.id)?.status).toBe('revoked');
    await expect(
      service.executeOperation({
        sessionId: session.id,
        leaseId: lease.id,
        leaseToken: token,
        tabId: 'tab-1',
        request: operationRequest(lease.sequence),
      })
    ).rejects.toMatchObject({ code: 'lease_expired' });
  });

  it('persists a redacted request and never stores the lease token plaintext', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nebula-browser-redaction-'));
    tempDirectories.push(directory);
    const dbPath = join(directory, 'ledger.sqlite');
    const repository = new BrowserExecutionRepository(dbPath);
    const service = new BrowserExecutionService({ repository, browser: new FakeBrowser() });
    service.initialize();
    const { session, lease, token } = await createSessionAndLease(service);
    const secretValue = 'correct-horse-battery-staple';
    const request = operationRequest(lease.sequence, {
      kind: 'act',
      operation: 'fill',
      target: {
        semantic: '密码输入框',
        candidates: [{ strategy: 'label', value: 'Password', exact: true }],
        expected: { cardinality: 'exactly_one' },
      },
      args: { value: secretValue },
    });
    await service.executeOperation({
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
      tabId: 'tab-1',
      request,
    });
    service.close();

    const db = new DatabaseSync(dbPath);
    const operationRow = db
      .prepare('SELECT request_json FROM browser_operations WHERE id = ?')
      .get(request.operationId) as { request_json: string };
    const leaseRow = db
      .prepare('SELECT token_hash FROM browser_leases WHERE id = ?')
      .get(lease.id) as { token_hash: string };
    db.close();

    expect(operationRow.request_json).not.toContain(secretValue);
    expect(operationRow.request_json).not.toContain('Password');
    expect(operationRow.request_json).toContain('"redacted":true');
    expect(leaseRow.token_hash).not.toBe(token);
  });

  it('blocks legacy writes and direct capture only while a controlled session is active', async () => {
    const { service } = makeService();
    expect(() => service.assertLegacyBrowserAccess('write')).not.toThrow();
    const { session, lease, token } = await createSessionAndLease(service);

    expect(() => service.assertLegacyBrowserAccess('read')).not.toThrow();
    expect(() => service.assertLegacyBrowserAccess('write')).toThrowError(BrowserExecutionError);
    expect(() => service.assertLegacyBrowserAccess('capture')).toThrowError(BrowserExecutionError);

    await service.closeSession(session.id, 'close-1', {
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
    });
    expect(() => service.assertLegacyBrowserAccess('write')).not.toThrow();
  });
});

describe('BrowserExecutionRepository restart recovery', () => {
  it('increments the process epoch and converges running operations to outcome_unknown', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nebula-browser-execution-'));
    tempDirectories.push(directory);
    const dbPath = join(directory, 'ledger.sqlite');
    const repository = new BrowserExecutionRepository(dbPath);
    const epoch = repository.initialize();
    const now = new Date().toISOString();
    const session: BrowserSessionRecord = {
      id: randomUUID(),
      status: 'active',
      processEpoch: epoch,
      viewport: { width: 1280, height: 720 },
      cdpPort: 9222,
      createdAt: now,
      activatedAt: now,
    };
    repository.insertSession(session);
    const lease: BrowserLeaseRecord = {
      id: randomUUID(),
      sessionId: session.id,
      mode: 'control',
      sequence: 1,
      processEpoch: epoch,
      status: 'active',
      policy: { tabIds: ['tab-1'], operations: ['url'] },
      tokenHash: hashOpaqueToken('secret-token'),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: now,
    };
    repository.insertLease(lease);
    const request = operationRequest(lease.sequence);
    repository.insertOperation({
      requestHash: sha256({ request }),
      input: { sessionId: session.id, leaseId: lease.id, tabId: 'tab-1', request },
      acceptedAt: now,
    });
    repository.markOperationRunning(request.operationId, now);
    repository.close();

    const recovered = new BrowserExecutionRepository(dbPath);
    expect(recovered.initialize()).toBe(epoch + 1);
    recovered.recoverAfterRestart(new Date().toISOString());

    expect(recovered.getSession(session.id)?.status).toBe('interrupted');
    expect(recovered.getLease(lease.id)?.status).toBe('expired');
    expect(recovered.getOperation(request.operationId)?.status).toBe('outcome_unknown');
    expect(recovered.getOperation(request.operationId)?.error?.code).toBe('outcome_unknown');
    recovered.close();
  });
});
