import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_runs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
      script_version INTEGER NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','pass','fail','error','timeout')),
      logs TEXT,
      screenshot_paths_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_execution_runs_script_id ON execution_runs(script_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_execution_runs_status ON execution_runs(status)
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_execution_runs_status`);
  db.exec(`DROP INDEX IF EXISTS idx_execution_runs_script_id`);
  db.exec(`DROP TABLE IF EXISTS execution_runs`);
}
