import { createHash } from 'node:crypto';

interface MigrationStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
}

export interface MigrationDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): MigrationStatement;
}

export interface TrackedMigration {
  id: number;
  name: string;
  sql: string;
}

export function ensureMigrationLedger(db: MigrationDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL CHECK(length(checksum) = 64),
      status TEXT NOT NULL CHECK(status IN ('applying','applied','failed')),
      started_at TEXT NOT NULL,
      applied_at TEXT,
      app_version TEXT NOT NULL,
      error_json TEXT
    )
  `);
}

export function runTrackedMigration(
  db: MigrationDatabase,
  migration: TrackedMigration,
  appVersion: string
): void {
  ensureMigrationLedger(db);
  const checksum = createHash('sha256').update(migration.sql).digest('hex');
  const existing = db
    .prepare('SELECT name, checksum, status FROM schema_migrations WHERE id = ?')
    .get(migration.id) as
    | { name: string; checksum: string; status: 'applying' | 'applied' | 'failed' }
    | undefined;
  if (existing && (existing.name !== migration.name || existing.checksum !== checksum)) {
    throw new Error(`Migration ${migration.id} checksum mismatch`);
  }
  if (existing?.status === 'applied') return;

  const startedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO schema_migrations (
      id, name, checksum, status, started_at, applied_at, app_version, error_json
    ) VALUES (?, ?, ?, 'applying', ?, NULL, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET status = 'applying', started_at = excluded.started_at,
      applied_at = NULL, app_version = excluded.app_version, error_json = NULL`
  ).run(migration.id, migration.name, checksum, startedAt, appVersion);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration.sql);
    db.prepare(
      `UPDATE schema_migrations
       SET status = 'applied', applied_at = ?, error_json = NULL WHERE id = ?`
    ).run(new Date().toISOString(), migration.id);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the migration failure.
    }
    const summary = {
      name: error instanceof Error ? error.name : 'Error',
      message: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    };
    db.prepare(`UPDATE schema_migrations SET status = 'failed', error_json = ? WHERE id = ?`).run(
      JSON.stringify(summary),
      migration.id
    );
    throw error;
  }
}
