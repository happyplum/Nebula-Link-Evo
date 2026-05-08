import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      test_scenario_id TEXT NOT NULL REFERENCES test_scenarios(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ts' CHECK(language IN ('ts','js')),
      generated_by TEXT NOT NULL DEFAULT 'ai_generated' CHECK(generated_by IN ('ai_generated','human_edited','ai_auto_fix')),
      status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated','editing','edited','executing','passed','failed','pending_review')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scripts_test_scenario_id ON scripts(test_scenario_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scripts_status ON scripts(status)
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_scripts_status`);
  db.exec(`DROP INDEX IF EXISTS idx_scripts_test_scenario_id`);
  db.exec(`DROP TABLE IF EXISTS scripts`);
}
