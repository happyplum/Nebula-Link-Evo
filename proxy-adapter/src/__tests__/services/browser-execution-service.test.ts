import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserExecutionError } from '../../browser-execution/errors.js';
import { LocalBrowserArtifactStore } from '../../browser-execution/artifact-store.js';
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
  readonly captureScreenshot = vi.fn(async () => ({
    kind: 'screenshot' as const,
    mimeType: 'image/png' as const,
    bytes: Buffer.from('fake-png'),
  }));
  readonly captureDomSnapshot = vi.fn(async () => ({
    kind: 'dom_snapshot' as const,
    mimeType: 'application/json' as const,
    bytes: Buffer.from(JSON.stringify({ snapshot_id: 'snapshot-1', simplified_dom: [] })),
    snapshotId: 'snapshot-1',
  }));
}

function makeService(browser: BrowserExecutionBrowser = new FakeBrowser()) {
  const repository = new BrowserExecutionRepository(':memory:');
  const directory = mkdtempSync(join(tmpdir(), 'nebula-browser-artifacts-'));
  tempDirectories.push(directory);
  const service = new BrowserExecutionService({
    repository,
    browser,
    artifactStore: new LocalBrowserArtifactStore(directory),
  });
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
  it('shuts down its initialized repository', async () => {
    const { service } = makeService();

    await service.shutdown();

    await expect(service.createSession('after-dispose', {})).rejects.toThrow(
      'Browser execution service is not initialized'
    );
  });

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

  it('captures real screenshot and DOM bytes, verifies downloads, and persists ordered events', async () => {
    const browser = new FakeBrowser();
    const { service, repository } = makeService(browser);
    const { session, lease, token } = await createSessionAndLease(service);
    const request = operationRequest(lease.sequence, {
      capture: {
        beforeScreenshot: true,
        afterScreenshot: true,
        domSnapshot: true,
      },
    });

    const operation = await service.executeOperation({
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
      tabId: 'tab-1',
      request,
    });

    expect(operation.status).toBe('succeeded');
    expect(operation.artifacts.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
      'screenshot',
      'dom_snapshot',
    ]);
    const artifactRecords = repository.listOperationArtifacts(operation.operationId);
    expect(artifactRecords).toHaveLength(3);
    expect(artifactRecords.every((artifact) => artifact.status === 'available')).toBe(true);
    const capture = repository.getCapture(artifactRecords[0]!.captureId!);
    expect(capture).toMatchObject({
      status: 'completed',
      completeness: 'complete',
      expectedItemCount: 3,
      actualItemCount: 3,
    });

    const domRef = operation.artifacts.find((artifact) => artifact.kind === 'dom_snapshot')!;
    expect(domRef).toMatchObject({
      mimeType: 'application/json',
      sizeBytes: expect.any(Number),
      snapshotId: 'snapshot-1',
    });
    const domDownload = await service.getArtifactDownload(session.id, domRef.id);
    expect(JSON.parse(domDownload.bytes.toString('utf8'))).toMatchObject({
      snapshot_id: 'snapshot-1',
    });
    const events = service.listSessionEvents(session.id, 0, 1000);
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1)
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'operation.queued',
        'capture.started',
        'artifact.created',
        'capture.completed',
        'operation.completed',
      ])
    );
    expect(await service.getSessionEventSnapshot(session.id)).toMatchObject({
      type: 'browser_session.snapshot',
      seq: events.at(-1)!.seq,
    });
  });

  it('always keeps a failure screenshot and rejects tampered artifact bytes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nebula-browser-failure-artifacts-'));
    tempDirectories.push(directory);
    const browser = new FakeBrowser();
    browser.execute.mockRejectedValueOnce(
      new BrowserExecutionError('state_conflict', 'Expected target was not present')
    );
    const repository = new BrowserExecutionRepository(':memory:');
    const service = new BrowserExecutionService({
      repository,
      browser,
      artifactStore: new LocalBrowserArtifactStore(directory),
    });
    service.initialize();
    const { session, lease, token } = await createSessionAndLease(service);

    const operation = await service.executeOperation({
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
      tabId: 'tab-1',
      request: operationRequest(lease.sequence),
    });

    expect(operation.status).toBe('failed');
    expect(operation.artifacts).toHaveLength(1);
    const artifact = repository.getArtifact(operation.artifacts[0]!.id)!;
    expect(artifact).toMatchObject({
      kind: 'screenshot',
      capturePhase: 'failure',
      retentionClass: 'failure_30d',
      status: 'available',
    });
    writeFileSync(join(directory, artifact.storageRef!), 'tampered');
    await expect(service.getArtifactDownload(session.id, artifact.id)).rejects.toMatchObject({
      code: 'state_conflict',
    });
  });

  it('deletes expired artifacts without removing bytes referenced by an active hold', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nebula-browser-cleanup-artifacts-'));
    tempDirectories.push(directory);
    const repository = new BrowserExecutionRepository(':memory:');
    let currentTime = '2026-08-12T00:00:00.000Z';
    const service = new BrowserExecutionService({
      repository,
      browser: new FakeBrowser(),
      artifactStore: new LocalBrowserArtifactStore(directory),
      clock: { now: () => new Date(currentTime) },
    });
    service.initialize();
    const { session, lease, token } = await createSessionAndLease(service);
    const executeCapture = () =>
      service.executeOperation({
        sessionId: session.id,
        leaseId: lease.id,
        leaseToken: token,
        tabId: 'tab-1',
        request: operationRequest(lease.sequence, { capture: { afterScreenshot: true } }),
    });
    const first = await executeCapture();
    const second = await executeCapture();
    const firstRef = first.artifacts.at(0);
    const secondRef = second.artifacts.at(0);
    if (!firstRef || !secondRef) throw new Error('Expected both captured artifact references');
    const firstArtifact = repository.getArtifact(firstRef.id);
    const secondArtifact = repository.getArtifact(secondRef.id);
    if (!firstArtifact || !secondArtifact) throw new Error('Expected both captured artifacts');
    if (!secondArtifact.storageRef) throw new Error('Expected a stored artifact reference');
    expect(firstArtifact.storageRef).toBe(secondArtifact.storageRef);
    repository.createArtifactHold({
      id: 'cleanup-hold',
      artifactId: secondArtifact.id,
      ownerService: 'ai-e2e',
      ownerRef: 'evidence-item-1',
      requestHash: sha256('cleanup-hold'),
      createdAt: currentTime,
    });

    currentTime = '2026-08-20T00:00:00.000Z';
    await expect(service.cleanupExpiredArtifacts()).resolves.toEqual({
      recordsDeleted: 1,
      filesDeleted: 0,
    });
    expect(repository.getArtifact(firstArtifact.id)?.status).toBe('deleted');
    expect(repository.getArtifact(secondArtifact.id)?.status).toBe('available');
    expect(existsSync(join(directory, secondArtifact.storageRef))).toBe(true);
    await expect(service.getArtifactDownload(session.id, secondArtifact.id)).resolves.toMatchObject({
      artifact: { id: secondArtifact.id },
    });

    repository.releaseArtifactHold('cleanup-hold', currentTime);
    await expect(service.cleanupExpiredArtifacts()).resolves.toEqual({
      recordsDeleted: 1,
      filesDeleted: 1,
    });
    expect(repository.getArtifact(secondArtifact.id)?.status).toBe('deleted');
    expect(existsSync(join(directory, secondArtifact.storageRef))).toBe(false);
    expect(
      service.listSessionEvents(session.id, 0, 1000).filter((event) => event.type === 'artifact.deleted')
    ).toHaveLength(2);
  });

  it('leaves a failed artifact deletion retryable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nebula-browser-cleanup-retry-'));
    tempDirectories.push(directory);
    const repository = new BrowserExecutionRepository(':memory:');
    const artifactStore = new LocalBrowserArtifactStore(directory);
    let currentTime = '2026-08-12T00:00:00.000Z';
    const service = new BrowserExecutionService({
      repository,
      browser: new FakeBrowser(),
      artifactStore,
      clock: { now: () => new Date(currentTime) },
    });
    service.initialize();
    const { session, lease, token } = await createSessionAndLease(service);
    const operation = await service.executeOperation({
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
      tabId: 'tab-1',
      request: operationRequest(lease.sequence, { capture: { afterScreenshot: true } }),
    });
    const artifactRef = operation.artifacts.at(0);
    if (!artifactRef) throw new Error('Expected a captured artifact reference');

    currentTime = '2026-08-20T00:00:00.000Z';
    const deleteSpy = vi.spyOn(artifactStore, 'delete').mockRejectedValueOnce(new Error('locked'));
    await expect(service.cleanupExpiredArtifacts()).rejects.toThrow('locked');
    expect(repository.getArtifact(artifactRef.id)?.status).toBe('expired');

    deleteSpy.mockRestore();
    await expect(service.cleanupExpiredArtifacts()).resolves.toEqual({
      recordsDeleted: 1,
      filesDeleted: 1,
    });
    expect(repository.getArtifact(artifactRef.id)?.status).toBe('deleted');
  });

  it('cleans terminal operation and resource idempotency records after seven days', async () => {
    let currentTime = '2026-08-12T00:00:00.000Z';
    const repository = new BrowserExecutionRepository(':memory:');
    const service = new BrowserExecutionService({
      repository,
      browser: new FakeBrowser(),
      clock: { now: () => new Date(currentTime) },
    });
    service.initialize();
    const { session, lease, token } = await createSessionAndLease(service);
    const request = operationRequest(lease.sequence);
    await service.executeOperation({
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
      tabId: 'tab-1',
      request,
    });
    await service.closeSession(session.id, 'close-session', {
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
    });

    currentTime = '2026-08-20T00:00:00.000Z';
    await expect(service.cleanupExpiredLedger()).resolves.toEqual({
      operationsDeleted: 1,
      idempotencyDeleted: 3,
    });
    expect(repository.getOperation(request.operationId)).toBeUndefined();
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

  it('blocks direct writes and direct capture only while a controlled session is active', async () => {
    const { service } = makeService();
    expect(() => service.assertDirectBrowserAccess('write')).not.toThrow();
    const { session, lease, token } = await createSessionAndLease(service);

    expect(() => service.assertDirectBrowserAccess('read')).not.toThrow();
    expect(() => service.assertDirectBrowserAccess('write')).toThrowError(BrowserExecutionError);
    expect(() => service.assertDirectBrowserAccess('capture')).toThrowError(BrowserExecutionError);

    await service.closeSession(session.id, 'close-1', {
      sessionId: session.id,
      leaseId: lease.id,
      leaseToken: token,
    });
    expect(() => service.assertDirectBrowserAccess('write')).not.toThrow();
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
