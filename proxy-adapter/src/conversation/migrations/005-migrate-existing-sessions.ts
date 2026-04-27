import { DatabaseSync } from 'node:sqlite';
import { createWorkerLogger } from '../../services/logger.js';

const logger = createWorkerLogger('migration-005');

export function up(db: DatabaseSync): void {
  const now = new Date().toISOString();

  const sessionsStmt = db.prepare('SELECT id FROM sessions');
  const sessions = sessionsStmt.all() as { id: string }[];

  const existingStmt = db.prepare('SELECT session_id FROM sessions_state');
  const existing = new Set(existingStmt.all().map((row: { session_id: string }) => row.session_id));

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO sessions_state (
       session_id, status, last_active_at, agent_state, job_id,
       version, created_at, updated_at
     ) VALUES (?, 'idle', ?, NULL, NULL, 1, ?, ?)`
  );

  let migrated = 0;
  for (const session of sessions) {
    if (!existing.has(session.id)) {
      insertStmt.run(session.id, now, now, now);
      migrated++;
    }
  }

  if (migrated > 0) {
    logger.info({ migrated }, 'Migrated existing sessions to sessions_state');
  }
}

export function down(_db: DatabaseSync): void {
}
