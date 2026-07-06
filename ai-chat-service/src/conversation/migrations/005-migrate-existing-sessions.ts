import { DatabaseSync } from 'node:sqlite';

interface SessionIdRow {
  readonly id: string;
}

interface SessionStateIdRow {
  readonly session_id: string;
}

export function up(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const sessions = db.prepare('SELECT id FROM sessions').all() as unknown as SessionIdRow[];
  const existingRows = db.prepare('SELECT session_id FROM sessions_state').all() as unknown as SessionStateIdRow[];
  const existing = new Set(existingRows.map((row) => row.session_id));
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO sessions_state (
       session_id, status, last_active_at, agent_state, job_id,
       version, created_at, updated_at
     ) VALUES (?, 'idle', ?, NULL, NULL, 1, ?, ?)`
  );

  for (const session of sessions) {
    if (!existing.has(session.id)) {
      insertStmt.run(session.id, now, now, now);
    }
  }
}

export function down(_db: DatabaseSync): void {}
