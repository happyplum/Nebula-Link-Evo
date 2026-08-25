import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from './hash.js';
import { BrowserExecutionRepository } from './repository.js';

const repositories: BrowserExecutionRepository[] = [];
const tempDirectories: string[] = [];
const now = '2026-08-12T00:00:00.000Z';

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRepository(path = ':memory:'): BrowserExecutionRepository {
  const repository = new BrowserExecutionRepository(path);
  repositories.push(repository);
  repository.initialize();
  repository.insertSession({
    id: 'session-1',
    status: 'active',
    processEpoch: 1,
    viewport: { width: 1280, height: 720 },
    cdpPort: 9222,
    createdAt: now,
    activatedAt: now,
  });
  repository.insertLease({
    id: 'lease-1',
    sessionId: 'session-1',
    mode: 'control',
    sequence: 1,
    processEpoch: 1,
    status: 'active',
    policy: { tabIds: ['tab-1'], operations: ['click'] },
    tokenHash: sha256('lease-token'),
    expiresAt: '2026-08-12T01:00:00.000Z',
    createdAt: now,
  });
  repository.insertOperation({
    requestHash: sha256('operation-request'),
    input: {
      sessionId: 'session-1',
      leaseId: 'lease-1',
      tabId: 'tab-1',
      request: {
        schema: 'nebula.browser.operation/1.0',
        operationId: 'operation-1',
        leaseSequence: 1,
        deadlineAt: '2026-08-12T01:00:00.000Z',
        kind: 'act',
        operation: 'click',
        capture: { beforeScreenshot: true, afterScreenshot: true, domSnapshot: true },
      },
    },
    acceptedAt: now,
  });
  return repository;
}

describe('BrowserExecutionRepository artifact foundation', () => {
  it('persists capture completeness and operation-linked artifact metadata', () => {
    const repository = createRepository();
    const capture = repository.createCapture({
      id: 'capture-1',
      operationId: 'operation-1',
      requestHash: sha256('capture-request'),
      requested: { beforeScreenshot: true, afterScreenshot: true, domSnapshot: true },
      expectedItemCount: 3,
      createdAt: now,
    });
    expect(capture).toMatchObject({ status: 'pending', expectedItemCount: 3, actualItemCount: 0 });

    repository.insertArtifact({
      id: 'artifact-1',
      sessionId: 'session-1',
      operationId: 'operation-1',
      captureId: 'capture-1',
      tabId: 'tab-1',
      kind: 'screenshot',
      capturePhase: 'failure',
      status: 'available',
      completeness: 'complete',
      mimeType: 'image/png',
      sha256: sha256('image-bytes'),
      sizeBytes: 128,
      storageBackend: 'local_file',
      storageRef: 'artifacts/raw/artifact-1.png',
      redactionStatus: 'pending',
      retentionClass: 'failure_30d',
      expiresAt: '2026-08-13T00:00:00.000Z',
      createdAt: now,
      availableAt: now,
    });
    repository.completeCapture('capture-1', {
      status: 'completed',
      completeness: 'partial',
      actualItemCount: 1,
      completedAt: now,
    });

    expect(repository.getCapture('capture-1')).toMatchObject({
      status: 'completed',
      completeness: 'partial',
      actualItemCount: 1,
    });
    expect(repository.listOperationArtifacts('operation-1')).toEqual([
      expect.objectContaining({ id: 'artifact-1', capturePhase: 'failure' }),
    ]);
  });

  it('keeps active upstream holds out of retention cleanup and rejects changed replays', () => {
    const repository = createRepository();
    repository.insertArtifact({
      id: 'artifact-1',
      sessionId: 'session-1',
      operationId: 'operation-1',
      tabId: 'tab-1',
      kind: 'dom_snapshot',
      capturePhase: 'after',
      status: 'available',
      completeness: 'complete',
      mimeType: 'application/json',
      sha256: sha256('dom'),
      sizeBytes: 42,
      storageBackend: 'local_file',
      storageRef: 'artifacts/raw/artifact-1.json',
      redactionStatus: 'redacted',
      retentionClass: 'upstream_held',
      expiresAt: '2026-08-12T00:01:00.000Z',
      createdAt: now,
      availableAt: now,
    });
    const hold = {
      id: 'hold-1',
      artifactId: 'artifact-1',
      ownerService: 'ai-e2e',
      ownerRef: 'opaque-evidence-item-1',
      requestHash: sha256('hold-request'),
      createdAt: now,
    };
    repository.createArtifactHold(hold);
    expect(repository.createArtifactHold({ ...hold, id: 'hold-replay' })).toEqual(hold);
    expect(() =>
      repository.createArtifactHold({
        ...hold,
        id: 'hold-conflict',
        requestHash: sha256('different-request'),
      })
    ).toThrow('different request');
    expect(repository.listArtifactsEligibleForDeletion('2026-08-12T00:02:00.000Z')).toEqual([]);

    repository.releaseArtifactHold('hold-1', '2026-08-12T00:02:00.000Z');
    expect(repository.listArtifactsEligibleForDeletion('2026-08-12T00:02:00.000Z')).toEqual([
      expect.objectContaining({ id: 'artifact-1' }),
    ]);
  });

  it('allocates monotonic session event seq and rolls the cursor back on insert failure', () => {
    const repository = createRepository();
    const first = repository.appendSessionEvent({
      id: 'event-1',
      sessionId: 'session-1',
      type: 'operation.accepted',
      entityType: 'operation',
      entityId: 'operation-1',
      payload: { operationId: 'operation-1' },
      occurredAt: now,
    });
    expect(first.seq).toBe(1);
    expect(() =>
      repository.appendSessionEvent({
        id: 'event-1',
        sessionId: 'session-1',
        type: 'operation.failed',
        entityType: 'operation',
        entityId: 'operation-1',
        payload: {},
        occurredAt: now,
      })
    ).toThrow();
    const second = repository.appendSessionEvent({
      id: 'event-2',
      sessionId: 'session-1',
      type: 'operation.completed',
      entityType: 'operation',
      entityId: 'operation-1',
      payload: { status: 'succeeded' },
      occurredAt: now,
    });
    expect(second.seq).toBe(2);
    expect(() =>
      repository.appendSessionEvent({
        id: 'event-secret',
        sessionId: 'session-1',
        type: 'invalid',
        entityType: 'session',
        entityId: 'session-1',
        payload: { password: 'plain-text' },
        occurredAt: now,
      })
    ).toThrow('opaque reference');
  });

  it('purges terminal operations and session or lease idempotency after seven days', () => {
    const repository = createRepository();
    repository.completeOperation('operation-1', 'succeeded', now, { actual: { title: 'done' } });
    repository.insertIdempotency(
      'session.create',
      'session-key',
      sha256('session-create'),
      'session',
      'session-1',
      now
    );
    repository.insertIdempotency(
      'lease.create:session-1',
      'lease-key',
      sha256('lease-create'),
      'lease',
      'lease-1',
      now
    );
    repository.closeSessionResources('session-1', now);

    expect(
      repository.cleanupExpiredLedger(
        '2026-08-20T00:00:00.000Z',
        '2026-08-13T00:00:00.000Z'
      )
    ).toEqual({ operationsDeleted: 1, idempotencyDeleted: 2 });
    expect(repository.getOperation('operation-1')).toBeUndefined();
    expect(repository.findIdempotency('session.create', 'session-key')).toBeUndefined();
    expect(repository.findIdempotency('lease.create:session-1', 'lease-key')).toBeUndefined();
  });

  it('keeps outcome-unknown operations and their owning resource idempotency', () => {
    const repository = createRepository();
    repository.completeOperation('operation-1', 'outcome_unknown', now, {
      error: {
        code: 'outcome_unknown',
        message: 'side effect requires a decision',
        retryable: false,
        correlationId: 'operation-1',
      },
    });
    repository.insertIdempotency(
      'session.create',
      'session-key',
      sha256('session-create'),
      'session',
      'session-1',
      now
    );
    repository.closeSessionResources('session-1', now);

    expect(
      repository.cleanupExpiredLedger(
        '2026-08-20T00:00:00.000Z',
        '2026-08-13T00:00:00.000Z'
      )
    ).toEqual({ operationsDeleted: 0, idempotencyDeleted: 0 });
    expect(repository.getOperation('operation-1')?.status).toBe('outcome_unknown');
    expect(repository.findIdempotency('session.create', 'session-key')).toBeDefined();
  });

  it('waits for artifact cleanup before purging capture and operation metadata', () => {
    const repository = createRepository();
    repository.createCapture({
      id: 'capture-1',
      operationId: 'operation-1',
      requestHash: sha256('capture-request'),
      requested: { afterScreenshot: true },
      expectedItemCount: 1,
      createdAt: now,
    });
    repository.insertArtifact({
      id: 'artifact-1',
      sessionId: 'session-1',
      operationId: 'operation-1',
      captureId: 'capture-1',
      tabId: 'tab-1',
      kind: 'screenshot',
      capturePhase: 'after',
      status: 'available',
      completeness: 'complete',
      mimeType: 'image/png',
      sha256: sha256('image'),
      sizeBytes: 5,
      storageBackend: 'local_file',
      storageRef: 'artifacts/raw/artifact-1.png',
      redactionStatus: 'pending',
      retentionClass: 'success_7d',
      expiresAt: '2026-08-13T00:00:00.000Z',
      createdAt: now,
      availableAt: now,
    });
    repository.completeCapture('capture-1', {
      status: 'completed',
      completeness: 'complete',
      actualItemCount: 1,
      completedAt: now,
    });
    repository.completeOperation('operation-1', 'succeeded', now);
    repository.closeSessionResources('session-1', now);

    expect(
      repository.cleanupExpiredLedger(
        '2026-08-20T00:00:00.000Z',
        '2026-08-13T00:00:00.000Z'
      )
    ).toEqual({ operationsDeleted: 0, idempotencyDeleted: 0 });

    repository.claimArtifactDeletion('artifact-1');
    repository.markArtifactDeleted('artifact-1', '2026-08-20T00:00:00.000Z');
    expect(
      repository.cleanupExpiredLedger(
        '2026-08-20T00:00:00.000Z',
        '2026-08-13T00:00:00.000Z'
      )
    ).toEqual({ operationsDeleted: 1, idempotencyDeleted: 0 });
    expect(repository.getArtifact('artifact-1')).toBeUndefined();
    expect(repository.getCapture('capture-1')).toBeUndefined();
    expect(repository.getOperation('operation-1')).toBeUndefined();
  });

  it('reopens an existing database without reapplying schema migrations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nebula-proxy-artifact-'));
    tempDirectories.push(directory);
    const path = join(directory, 'browser.sqlite');
    const repository = createRepository(path);
    repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = new BrowserExecutionRepository(path);
    repositories.push(reopened);
    expect(() => reopened.initialize()).not.toThrow();
    expect(reopened.getSession('session-1')).toMatchObject({ id: 'session-1' });
  });
});
