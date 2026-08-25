import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up as up017 } from '../../database/migrations/017-semantic-evidence-integration-foundation.js';
import { up as up019 } from '../../database/migrations/019-semantic-evidence-retention.js';
import { SemanticEvidenceRepository } from '../../database/repositories/semantic-evidence-repository.js';
import { SemanticArtifactStore } from '../../infrastructure/semantic-artifact-store.js';
import { SemanticEvidenceRetentionService } from '../semantic-evidence-retention-service.js';

const HASH = 'a'.repeat(64);

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('SemanticEvidenceRetentionService', () => {
  let db: DatabaseSync;
  let temporaryRoot: string;
  let storageRoot: string;
  let store: SemanticArtifactStore;
  let repository: SemanticEvidenceRepository;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE test_runs (id TEXT PRIMARY KEY);
      CREATE TABLE authoring_jobs (id TEXT PRIMARY KEY);
      CREATE TABLE run_todos (id TEXT PRIMARY KEY);
      INSERT INTO test_runs (id) VALUES ('run-1');
    `);
    up017(db);
    up019(db);
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'nebula-evidence-retention-'));
    storageRoot = path.join(temporaryRoot, 'store');
    store = new SemanticArtifactStore(storageRoot);
    repository = new SemanticEvidenceRepository(db);
  });

  afterEach(async () => {
    db.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it('keeps shared bytes until every manifest retention window has expired', async () => {
    const bytes = Buffer.from('shared evidence');
    const sha256 = digest(bytes);
    const persisted = await store.persist(sha256, bytes);
    insertArtifact('artifact-1', sha256, persisted.storageKey, '2026-07-01T00:00:00.000Z');
    insertManifest('success-manifest', 'success_7d', '2026-08-01T00:00:00.000Z');
    insertManifest('failure-manifest', 'failure_30d', '2026-08-01T00:00:00.000Z');
    insertItem('success-item', 'success-manifest', 'artifact-1');
    insertItem('failure-item', 'failure-manifest', 'artifact-1');
    const retention = createRetention();

    await expect(
      retention.cleanupExpiredArtifacts(new Date('2026-08-16T00:00:00.000Z'))
    ).resolves.toEqual({
      recordsDeleted: 0,
      filesDeleted: 0,
      storageFailures: 0,
    });
    await expect(readFile(persisted.storageKey)).resolves.toEqual(bytes);

    await expect(
      retention.cleanupExpiredArtifacts(new Date('2026-09-01T00:00:00.000Z'))
    ).resolves.toEqual({
      recordsDeleted: 1,
      filesDeleted: 1,
      storageFailures: 0,
    });
    expect(readArtifact('artifact-1').deleted_at).toBe('2026-09-01T00:00:00.000Z');
    expect(readCleanupReceipt('artifact-1')).toBe('2026-09-01T00:00:00.000Z');
    await expect(readFile(persisted.storageKey)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves open, pinned, custom, and explicitly pinned evidence', async () => {
    for (const [id, retentionClass, status, pinnedAt] of [
      ['open-artifact', 'success_7d', 'open', null],
      ['pinned-manifest-artifact', 'pinned', 'sealed', null],
      ['custom-artifact', 'custom', 'sealed', null],
      ['pinned-object-artifact', 'success_7d', 'sealed', '2026-07-02T00:00:00.000Z'],
    ] as const) {
      const bytes = Buffer.from(id);
      const sha256 = digest(bytes);
      const persisted = await store.persist(sha256, bytes);
      insertArtifact(id, sha256, persisted.storageKey, '2026-07-01T00:00:00.000Z', pinnedAt);
      insertManifest(`${id}-manifest`, retentionClass, '2026-07-01T00:00:00.000Z', status);
      insertItem(`${id}-item`, `${id}-manifest`, id);
    }

    await expect(
      createRetention().cleanupExpiredArtifacts(new Date('2026-09-01T00:00:00.000Z'))
    ).resolves.toEqual({
      recordsDeleted: 0,
      filesDeleted: 0,
      storageFailures: 0,
    });
    for (const id of [
      'open-artifact',
      'pinned-manifest-artifact',
      'custom-artifact',
      'pinned-object-artifact',
    ]) {
      expect(readArtifact(id).deleted_at).toBeNull();
    }
  });

  it('cleans expired orphan objects and resumes physical cleanup after a restart', async () => {
    const orphanBytes = Buffer.from('orphan');
    const orphanSha = digest(orphanBytes);
    const orphan = await store.persist(orphanSha, orphanBytes);
    insertArtifact(
      'orphan-artifact',
      orphanSha,
      orphan.storageKey,
      '2026-08-01T00:00:00.000Z',
      null,
      '2026-08-02T00:00:00.000Z'
    );

    const restartBytes = Buffer.from('restart');
    const restartSha = digest(restartBytes);
    const restart = await store.persist(restartSha, restartBytes);
    insertArtifact(
      'restart-artifact',
      restartSha,
      restart.storageKey,
      '2026-07-01T00:00:00.000Z',
      null,
      null,
      '2026-08-01T00:00:00.000Z'
    );

    await expect(
      createRetention().cleanupExpiredArtifacts(new Date('2026-09-01T00:00:00.000Z'))
    ).resolves.toEqual({
      recordsDeleted: 1,
      filesDeleted: 2,
      storageFailures: 0,
    });
    expect(readCleanupReceipt('orphan-artifact')).toBe('2026-09-01T00:00:00.000Z');
    expect(readCleanupReceipt('restart-artifact')).toBe('2026-09-01T00:00:00.000Z');
  });

  it('does not delete a shared file while another live object row references it', async () => {
    const bytes = Buffer.from('cross-sensitivity shared bytes');
    const sha256 = digest(bytes);
    const persisted = await store.persist(sha256, bytes);
    insertArtifact(
      'deleted-object',
      sha256,
      persisted.storageKey,
      '2026-07-01T00:00:00.000Z',
      null,
      null,
      '2026-08-01T00:00:00.000Z',
      'restricted'
    );
    insertArtifact(
      'live-object',
      sha256,
      persisted.storageKey,
      '2026-08-31T00:00:00.000Z',
      null,
      null,
      null,
      'sensitive'
    );

    await expect(
      createRetention().cleanupExpiredArtifacts(new Date('2026-09-01T00:00:00.000Z'))
    ).resolves.toEqual({
      recordsDeleted: 0,
      filesDeleted: 0,
      storageFailures: 0,
    });
    await expect(readFile(persisted.storageKey)).resolves.toEqual(bytes);
    expect(readCleanupReceipt('deleted-object')).toBeNull();
  });

  it('rejects storage paths outside the configured root and leaves them retryable', async () => {
    const outsidePath = path.join(temporaryRoot, 'outside-evidence');
    await writeFile(outsidePath, 'do not delete');
    insertArtifact(
      'outside-artifact',
      HASH,
      outsidePath,
      '2026-07-01T00:00:00.000Z',
      null,
      null,
      '2026-08-01T00:00:00.000Z'
    );

    await expect(
      createRetention().cleanupExpiredArtifacts(new Date('2026-09-01T00:00:00.000Z'))
    ).resolves.toEqual({
      recordsDeleted: 0,
      filesDeleted: 0,
      storageFailures: 1,
    });
    await expect(readFile(outsidePath, 'utf8')).resolves.toBe('do not delete');
    expect(readCleanupReceipt('outside-artifact')).toBeNull();
  });

  function createRetention() {
    return new SemanticEvidenceRetentionService({ repository, artifactStore: store });
  }

  function insertArtifact(
    id: string,
    sha256: string,
    storageKey: string,
    createdAt: string,
    pinnedAt: string | null = null,
    expiresAt: string | null = null,
    deletedAt: string | null = null,
    sensitivity: 'sensitive' | 'restricted' = 'sensitive'
  ): void {
    db.prepare(
      `INSERT INTO artifact_objects
        (id, sha256, size_bytes, media_type, storage_backend, storage_key, sensitivity,
         redaction_status, ref_count, created_at, expires_at, pinned_at, deleted_at)
       VALUES (?, ?, 1, 'application/octet-stream', 'local_file', ?, ?, 'pending', 0, ?, ?, ?, ?)`
    ).run(id, sha256, storageKey, sensitivity, createdAt, expiresAt, pinnedAt, deletedAt);
  }

  function insertManifest(
    id: string,
    retentionClass: 'success_7d' | 'failure_30d' | 'pinned' | 'custom',
    createdAt: string,
    status: 'open' | 'sealed' = 'sealed'
  ): void {
    db.prepare(
      `INSERT INTO evidence_manifests
        (id, context_type, context_id, run_id, schema_id, status, completeness,
         manifest_json, manifest_sha256, retention_class, sealed_at, created_at)
       VALUES (?, 'run', 'run-1', 'run-1', 'schema/1', ?, 'complete', '{}', ?, ?, ?, ?)`
    ).run(id, status, HASH, retentionClass, status === 'sealed' ? createdAt : null, createdAt);
  }

  function insertItem(id: string, manifestId: string, artifactId: string): void {
    db.prepare(
      `INSERT INTO evidence_items
        (id, manifest_id, item_type, artifact_object_id, captured_at, source_service,
         redaction_status, integrity_sha256, metadata_json)
       VALUES (?, ?, 'screenshot', ?, '2026-07-01T00:00:00.000Z', 'proxy-adapter',
               'pending', ?, '{}')`
    ).run(id, manifestId, artifactId, HASH);
  }

  function readArtifact(id: string): { deleted_at: string | null } {
    return db.prepare('SELECT deleted_at FROM artifact_objects WHERE id = ?').get(id) as {
      deleted_at: string | null;
    };
  }

  function readCleanupReceipt(id: string): string | null {
    const row = db
      .prepare(
        'SELECT storage_deleted_at FROM artifact_storage_cleanup_receipts WHERE artifact_object_id = ?'
      )
      .get(id) as { storage_deleted_at: string } | undefined;
    return row?.storage_deleted_at ?? null;
  }
});
