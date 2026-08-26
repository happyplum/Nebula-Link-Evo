import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseManager } from '../db.js';

describe('DatabaseManager runtime invariants', () => {
  const roots: string[] = [];

  afterEach(() => {
    DatabaseManager.resetInstance();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
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
});
