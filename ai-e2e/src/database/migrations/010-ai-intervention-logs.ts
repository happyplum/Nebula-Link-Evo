import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_intervention_logs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      execution_run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
      diagnosis TEXT,
      action_taken TEXT CHECK(action_taken IN ('diagnose_only','auto_fix_applied','pending_human_review','human_approved','human_rejected')),
      original_script_snapshot TEXT,
      modified_script_snapshot TEXT,
      diagnosis_tokens INTEGER,
      outcome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_intervention_logs_execution_run_id ON ai_intervention_logs(execution_run_id)
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_ai_intervention_logs_execution_run_id`);
  db.exec(`DROP TABLE IF EXISTS ai_intervention_logs`);
}
