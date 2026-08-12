import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up } from '../014-semantic-asset-foundation.js';

const EXPECTED_TABLES = [
  'business_versions',
  'deployment_profiles',
  'deployment_profile_revisions',
  'version_deployment_bindings',
  'version_prd_documents',
  'version_variable_definitions',
  'page_definitions',
  'page_definition_revisions',
  'semantic_business_modules',
  'semantic_business_module_revisions',
  'semantic_functional_modules',
  'semantic_functional_module_revisions',
  'functional_scripts',
  'functional_script_revisions',
  'semantic_test_scenarios',
  'semantic_test_scenario_revisions',
];

describe('migration 014 semantic asset foundation', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE business_modules (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
      CREATE TABLE functional_modules (id TEXT PRIMARY KEY, business_module_id TEXT NOT NULL);
      CREATE TABLE test_scenarios (id TEXT PRIMARY KEY, functional_module_id TEXT NOT NULL);
    `);
  });

  afterEach(() => db.close());

  it('adds the semantic schema without changing legacy tables and is idempotent', () => {
    const legacyBefore = db
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'table' AND name IN ('business_modules','functional_modules','test_scenarios')
         ORDER BY name`
      )
      .all();
    up(db);
    expect(() => up(db)).not.toThrow();

    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String((row as { name: string }).name));
    for (const table of EXPECTED_TABLES) expect(names).toContain(table);
    const legacyAfter = db
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'table' AND name IN ('business_modules','functional_modules','test_scenarios')
         ORDER BY name`
      )
      .all();
    expect(legacyAfter).toEqual(legacyBefore);
  });

  it('enforces one current revision and immutable revision payloads', () => {
    up(db);
    db.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'P')").run();
    db.prepare(
      `INSERT INTO business_versions
        (id, project_id, version_key, name, create_request_id, request_hash, created_by,
         created_at, updated_at)
       VALUES ('version-1', 'project-1', 'v1', 'V1', 'create-1',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'user',
         '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO page_definitions (id, business_version_id, page_key, created_at)
       VALUES ('page-1', 'version-1', 'login', '2026-08-12T00:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO page_definition_revisions
        (id, business_version_id, page_definition_id, revision_no, lifecycle, schema_id, payload_json,
         content_sha256, validation_status, change_reason, created_by_type, created_at,
         page_signature_sha256)
       VALUES ('rev-1', 'version-1', 'page-1', 1, 'current', 'page/1', '{}',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'valid', 'test', 'system', '2026-08-12T00:00:00.000Z',
         'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')`
    ).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO page_definition_revisions
          (id, business_version_id, page_definition_id, revision_no, lifecycle, schema_id, payload_json,
           content_sha256, validation_status, change_reason, created_by_type, created_at,
           page_signature_sha256)
         VALUES ('rev-2', 'version-1', 'page-1', 2, 'current', 'page/1', '{}',
           'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
           'valid', 'test', 'system', '2026-08-12T00:00:00.000Z',
           'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')`
        )
        .run()
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "UPDATE page_definition_revisions SET payload_json = '{\"changed\":true}' WHERE id = 'rev-1'"
        )
        .run()
    ).toThrow();
  });
});
