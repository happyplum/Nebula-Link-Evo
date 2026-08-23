import type { DatabaseSync } from 'node:sqlite';

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS harness_session_projection (
      session_id TEXT PRIMARY KEY,
      projected_dsh_seq INTEGER NOT NULL DEFAULT 0,
      durable_dsh_seq INTEGER NOT NULL DEFAULT 0,
      durable_revision TEXT,
      deleted_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS harness_projected_events (
      session_id TEXT NOT NULL,
      dsh_seq INTEGER NOT NULL,
      dsh_event_type TEXT NOT NULL,
      public_seq INTEGER,
      PRIMARY KEY (session_id, dsh_seq),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_harness_projected_events_public ON harness_projected_events(session_id, public_seq)'
  );
}

export function down(db: DatabaseSync): void {
  db.exec('DROP TABLE IF EXISTS harness_projected_events');
  db.exec('DROP TABLE IF EXISTS harness_session_projection');
}
