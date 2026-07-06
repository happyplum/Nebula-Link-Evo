import { DatabaseSync } from 'node:sqlite';

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions_state (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('idle', 'running', 'paused', 'blocked', 'completed')),
      last_active_at TEXT,
      agent_state TEXT,
      version INTEGER DEFAULT 1,
      job_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_state_status ON sessions_state(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_state_last_active ON sessions_state(last_active_at)');
}

export function down(db: DatabaseSync): void {
  db.exec('DROP INDEX IF EXISTS idx_sessions_state_last_active');
  db.exec('DROP INDEX IF EXISTS idx_sessions_state_status');
  db.exec('DROP TABLE IF EXISTS sessions_state');
}
