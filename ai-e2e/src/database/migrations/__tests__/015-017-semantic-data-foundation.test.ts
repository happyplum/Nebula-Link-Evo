import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runTrackedMigration } from '../../migration-runner.js';
import { up as up014 } from '../014-semantic-asset-foundation.js';
import { up as up015 } from '../015-semantic-asset-governance.js';
import { up as up016 } from '../016-semantic-workflow-foundation.js';
import { up as up017 } from '../017-semantic-evidence-integration-foundation.js';

const EXPECTED_TABLES = [
  'version_decisions',
  'business_version_validations',
  'page_baseline_variants',
  'page_baseline_revisions',
  'module_requirement_revisions',
  'functional_point_coverage',
  'asset_revision_verifications',
  'asset_revision_dependencies',
  'browser_jobs',
  'authoring_jobs',
  'authoring_tasks',
  'authoring_attempts',
  'authoring_commands',
  'authoring_events',
  'test_runs',
  'run_plans',
  'run_plan_amendments',
  'run_todos',
  'run_todo_dependencies',
  'page_tasks',
  'execution_attempts',
  'run_variables',
  'decision_requests',
  'decision_answers',
  'run_commands',
  'run_events',
  'page_observations',
  'side_effect_policy_evaluations',
  'side_effect_approval_grants',
  'artifact_objects',
  'evidence_manifests',
  'evidence_items',
  'browser_operation_links',
  'integration_outbox',
  'external_task_links',
  'legacy_import_batches',
  'legacy_entity_links',
];

describe('semantic data foundation migrations 015-017', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
    up014(db);
  });

  afterEach(() => db.close());

  it('adds every semantic data domain without touching legacy tables and is idempotent', () => {
    db.exec(`CREATE TABLE execution_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL)`);
    const legacyBefore = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'execution_runs'")
      .get();

    for (const migrate of [up015, up016, up017]) {
      migrate(db);
      expect(() => migrate(db)).not.toThrow();
    }

    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String((row as { name: string }).name));
    for (const table of EXPECTED_TABLES) expect(names).toContain(table);
    expect(
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'execution_runs'")
        .get()
    ).toEqual(legacyBefore);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('tracks additive migrations by checksum and rejects changed history', () => {
    runTrackedMigration(
      db,
      { id: 15, name: 'fixture', sql: 'CREATE TABLE IF NOT EXISTS fixture (id TEXT PRIMARY KEY);' },
      'test'
    );
    expect(() =>
      runTrackedMigration(
        db,
        {
          id: 15,
          name: 'fixture',
          sql: 'CREATE TABLE IF NOT EXISTS fixture (id TEXT PRIMARY KEY);',
        },
        'test'
      )
    ).not.toThrow();
    expect(() =>
      runTrackedMigration(
        db,
        { id: 15, name: 'fixture', sql: 'CREATE TABLE fixture_changed (id TEXT);' },
        'test'
      )
    ).toThrow('checksum mismatch');
  });

  it('rolls back a failed tracked migration and records a retryable failure row', () => {
    expect(() =>
      runTrackedMigration(
        db,
        { id: 15, name: 'broken', sql: 'CREATE TABLE partial_table (id TEXT); INVALID SQL;' },
        'test'
      )
    ).toThrow();
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_table'")
        .get()
    ).toBeUndefined();
    expect(db.prepare('SELECT status FROM schema_migrations WHERE id = 15').get()).toEqual({
      status: 'failed',
    });
  });
});
