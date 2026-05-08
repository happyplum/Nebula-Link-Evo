import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_scenarios (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      functional_module_id TEXT NOT NULL REFERENCES functional_modules(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      test_data_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'ai_generated' CHECK(source IN ('ai_generated','human_created','human_modified')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_test_scenarios_functional_module_id ON test_scenarios(functional_module_id)
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_test_scenarios_functional_module_id`);
  db.exec(`DROP TABLE IF EXISTS test_scenarios`);
}
