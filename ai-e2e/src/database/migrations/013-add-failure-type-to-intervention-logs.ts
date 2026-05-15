import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  try {
    db.exec(`ALTER TABLE ai_intervention_logs ADD COLUMN failure_type TEXT DEFAULT NULL`);
  } catch (error) {
    // Column may already exist from a previous run — ignore the error
    const sqliteError = error as { code?: string };
    if (sqliteError.code !== 'SQLITE_ERROR') {
      throw error;
    }
  }
}

export function down(db: Database.Database): void {
  // SQLite doesn't support DROP COLUMN directly
  // We would need to recreate the table, but for this migration
  // we'll accept that rollback is not perfect
  // This is acceptable for additive migrations
}