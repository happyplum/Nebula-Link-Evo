import { DatabaseSync } from 'node:sqlite';

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      ttl_expires_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, seq)
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_session_events_seq ON session_events(session_id, seq)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_session_events_ttl ON session_events(ttl_expires_at)');
}

export function down(db: DatabaseSync): void {
  db.exec('DROP INDEX IF EXISTS idx_session_events_ttl');
  db.exec('DROP INDEX IF EXISTS idx_session_events_seq');
  db.exec('DROP TABLE IF EXISTS session_events');
}
