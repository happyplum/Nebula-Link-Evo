import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { generateId } from '../../database/db.js';
import { up as migrate001, down as down001 } from '../../database/migrations/001-projects.js';
import { up as migrate002, down as down002 } from '../../database/migrations/002-prd-documents.js';
import { up as migrate003, down as down003 } from '../../database/migrations/003-business-modules.js';
import { up as migrate004, down as down004 } from '../../database/migrations/004-functional-modules.js';
import { up as migrate005, down as down005 } from '../../database/migrations/005-urls.js';
import { up as migrate006, down as down006 } from '../../database/migrations/006-url-module-bindings.js';
import { up as migrate007, down as down007 } from '../../database/migrations/007-test-scenarios.js';
import { up as migrate008, down as down008 } from '../../database/migrations/008-scripts.js';
import { up as migrate009, down as down009 } from '../../database/migrations/009-execution-runs.js';
import { up as migrate010, down as down010 } from '../../database/migrations/010-ai-intervention-logs.js';
import { up as migrate011, down as down011 } from '../../database/migrations/011-exploration-sessions.js';
import { up as migrate012, down as down012 } from '../../database/migrations/012-login-scripts.js';
import { up as migrate013 } from '../../database/migrations/013-add-failure-type-to-intervention-logs.js';

const EXPECTED_TABLES = [
  'projects',
  'prd_documents',
  'business_modules',
  'functional_modules',
  'urls',
  'url_module_bindings',
  'test_scenarios',
  'scripts',
  'execution_runs',
  'ai_intervention_logs',
  'exploration_sessions',
  'login_scripts',
];

function runAllMigrations(db: Database.Database): void {
  migrate001(db);
  migrate002(db);
  migrate003(db);
  // 004 depends on urls (005), so create urls first
  migrate005(db);
  migrate004(db);
  migrate006(db);
  migrate007(db);
  migrate008(db);
  migrate009(db);
  migrate010(db);
  migrate011(db);
  migrate012(db);
  migrate013(db);
}

function getTableNames(db: Database.Database): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  return rows.map((r) => r.name);
}

describe('Database Migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('should create all 12 tables when migrations run', () => {
    runAllMigrations(db);

    const tables = getTableNames(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
    expect(tables).toHaveLength(EXPECTED_TABLES.length);
  });

  it('should be idempotent — running migrations twice does not error', () => {
    runAllMigrations(db);
    // Run again — should not throw
    expect(() => runAllMigrations(db)).not.toThrow();

    const tables = getTableNames(db);
    expect(tables).toHaveLength(EXPECTED_TABLES.length);
  });

  it('should create indexes for projects table', () => {
    runAllMigrations(db);

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='projects'").all() as { name: string }[];
    const indexNames = indexes.map((r) => r.name);
    expect(indexNames).toContain('idx_projects_status');
    expect(indexNames).toContain('idx_projects_created_at');
  });

  it('should enforce project status enum constraint', () => {
    migrate001(db);

    expect(() => {
      db.prepare("INSERT INTO projects (name, status) VALUES ('test', 'draft')").run();
    }).not.toThrow();

    expect(() => {
      db.prepare("INSERT INTO projects (name, status) VALUES ('test2', 'invalid_status')").run();
    }).toThrow();
  });

  it('should enforce script status enum constraint', () => {
    runAllMigrations(db);

    // Need a full chain: project -> business_module -> functional_module -> test_scenario -> script
    const projectId = generateId();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, 'p')").run(projectId);
    const bmId = generateId();
    db.prepare("INSERT INTO business_modules (id, project_id, name) VALUES (?, ?, 'bm')").run(bmId, projectId);
    const fmId = generateId();
    db.prepare("INSERT INTO functional_modules (id, business_module_id, name) VALUES (?, ?, 'fm')").run(fmId, bmId);
    const tsId = generateId();
    db.prepare("INSERT INTO test_scenarios (id, functional_module_id, name) VALUES (?, ?, 'ts')").run(tsId, fmId);

    expect(() => {
      db.prepare("INSERT INTO scripts (id, test_scenario_id, content, status) VALUES (?, ?, 'code', 'generated')").run(generateId(), tsId);
    }).not.toThrow();

    expect(() => {
      db.prepare("INSERT INTO scripts (id, test_scenario_id, content, status) VALUES (?, ?, 'code', 'bad_status')").run(generateId(), tsId);
    }).toThrow();
  });

  it('should enforce foreign key cascades', () => {
    runAllMigrations(db);

    const projectId = generateId();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, 'p')").run(projectId);

    db.prepare("INSERT INTO prd_documents (id, project_id, raw_content) VALUES (?, ?, 'content')").run(generateId(), projectId);
    db.prepare("INSERT INTO business_modules (id, project_id, name) VALUES (?, ?, 'bm')").run(generateId(), projectId);
    db.prepare("INSERT INTO login_scripts (id, project_id, name, steps_json) VALUES (?, ?, 'ls', '[]')").run(generateId(), projectId);

    // Delete project — cascades should remove children
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

    const prdCount = (db.prepare('SELECT COUNT(*) as c FROM prd_documents').get() as { c: number }).c;
    const bmCount = (db.prepare('SELECT COUNT(*) as c FROM business_modules').get() as { c: number }).c;
    const lsCount = (db.prepare('SELECT COUNT(*) as c FROM login_scripts').get() as { c: number }).c;

    expect(prdCount).toBe(0);
    expect(bmCount).toBe(0);
    expect(lsCount).toBe(0);
  });

  it('should enforce unique constraint on url_module_bindings', () => {
    runAllMigrations(db);

    const projectId = generateId();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, 'p')").run(projectId);
    const bmId = generateId();
    db.prepare("INSERT INTO business_modules (id, project_id, name) VALUES (?, ?, 'bm')").run(bmId, projectId);
    const fmId = generateId();
    db.prepare("INSERT INTO functional_modules (id, business_module_id, name) VALUES (?, ?, 'fm')").run(fmId, bmId);
    const urlId = generateId();
    db.prepare("INSERT INTO urls (id, project_id, url) VALUES (?, ?, '/page')").run(urlId, projectId);

    db.prepare("INSERT INTO url_module_bindings (id, url_id, functional_module_id) VALUES (?, ?, ?)").run(generateId(), urlId, fmId);

    // Duplicate binding should fail
    expect(() => {
      db.prepare("INSERT INTO url_module_bindings (id, url_id, functional_module_id) VALUES (?, ?, ?)").run(generateId(), urlId, fmId);
    }).toThrow();
  });

  it('should down() all migrations cleanly', () => {
    runAllMigrations(db);

    // Down in reverse order
    down012(db);
    down011(db);
    down010(db);
    down009(db);
    down008(db);
    down007(db);
    down006(db);
    down004(db);
    down005(db);
    down003(db);
    down002(db);
    down001(db);

    const tables = getTableNames(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables).not.toContain(table);
    }
  });

  it('should add failure_type column to ai_intervention_logs table', () => {
    runAllMigrations(db);

    const columns = db.prepare("PRAGMA table_info(ai_intervention_logs)").all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('failure_type');
  });

  it('migration 013 should be idempotent — running twice does not error', () => {
    runAllMigrations(db);

    // Run migration 013 again — should not throw
    expect(() => migrate013(db)).not.toThrow();

    const columns = db.prepare("PRAGMA table_info(ai_intervention_logs)").all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('failure_type');
  });
});
