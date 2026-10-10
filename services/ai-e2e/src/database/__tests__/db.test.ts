import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseManager } from '../db.js';
import { afterImmediateTransactionCommit } from '../repositories/semantic-repository-utils.js';
import { createServer, bindAfterCommitErrorLogging } from '../../server/index.js';

describe('DatabaseManager runtime invariants', () => {
  const roots: string[] = [];

  afterEach(() => {
    DatabaseManager.resetInstance();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('migrates an empty database through the unchanged 017 policy tables and reopens with matching checksums', () => {
    const temporaryRoot = resolve('..', '..', '.tmp');
    mkdirSync(temporaryRoot, { recursive: true });
    const root = mkdtempSync(join(temporaryRoot, 't8-policy-migrations-'));
    roots.push(root);
    const dbPath = join(root, 'semantic.sqlite');
    const manager = DatabaseManager.getInstance();
    manager.init(dbPath);
    const db = manager.getDatabase();
    const migrations = db
      .prepare('SELECT id, checksum, status FROM schema_migrations ORDER BY id')
      .all();
    expect(migrations).toEqual(
      [15, 16, 17, 18, 19, 20].map((id) => ({
        id,
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        status: 'applied',
      }))
    );
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM side_effect_policy_evaluations').get()
    ).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM side_effect_approval_grants').get()).toEqual({
      count: 0,
    });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    DatabaseManager.resetInstance();
    const reopened = DatabaseManager.getInstance();
    reopened.init(dbPath);
    expect(
      reopened
        .getDatabase()
        .prepare('SELECT id, checksum, status FROM schema_migrations ORDER BY id')
        .all()
    ).toEqual(migrations);
  });

  it('restores a missing global browser queue cursor without deleting persisted data', () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-e2e-db-invariant-'));
    roots.push(root);
    const dbPath = join(root, 'semantic.sqlite');
    const manager = DatabaseManager.getInstance();
    manager.init(dbPath);
    manager
      .getDatabase()
      .prepare(
        `INSERT INTO browser_jobs
          (id, root_context_type, root_context_id, queue_seq, state, created_at)
         VALUES ('persisted-job', 'authoring', 'persisted-context', 7, 'completed', ?)`
      )
      .run(new Date().toISOString());
    manager.getDatabase().prepare("DELETE FROM browser_job_queue_meta WHERE key = 'global'").run();
    DatabaseManager.resetInstance();

    const reopened = DatabaseManager.getInstance();
    reopened.init(dbPath);

    expect(
      reopened
        .getDatabase()
        .prepare("SELECT next_queue_seq FROM browser_job_queue_meta WHERE key = 'global'")
        .get()
    ).toEqual({ next_queue_seq: 8 });
  });

  it('binds callback failures to the application logger and unbinds before database close', async () => {
    const temporaryRoot = resolve('..', '..', '.tmp');
    mkdirSync(temporaryRoot, { recursive: true });
    const root = mkdtempSync(join(temporaryRoot, 't8-after-commit-logger-'));
    roots.push(root);
    const manager = DatabaseManager.getInstance();
    manager.init(join(root, 'semantic.sqlite'));
    const database = manager.getDatabase();
    const app = createServer({ logger: false });
    const warning = vi.spyOn(app.log, 'warn');
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    bindAfterCommitErrorLogging(database, app.log);

    afterImmediateTransactionCommit(database, () => {
      throw new Error('private callback payload');
    });

    expect(warning).toHaveBeenCalledWith(
      {
        code: 'after_commit_callback_failed',
        phase: 'no-transaction',
        callbackIndex: 0,
        errorName: 'Error',
        errorConstructor: 'Error',
      },
      'After-commit notification callback failed'
    );
    expect(stderr).not.toHaveBeenCalled();

    manager.close();
    afterImmediateTransactionCommit(database, () => {
      throw new Error('private callback payload');
    });

    expect(warning).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledWith(
      {
        code: 'after_commit_callback_failed',
        phase: 'no-transaction',
        callbackIndex: 0,
        errorName: 'Error',
        errorConstructor: 'Error',
      },
      'After-commit notification callback failed'
    );
    await app.close();
  });
});
