interface MigrationDatabase {
  exec(sql: string): unknown;
}

export const migrationId = 19;
export const migrationName = 'semantic-evidence-retention';

export const migrationSql = `
  CREATE TABLE IF NOT EXISTS artifact_storage_cleanup_receipts (
    artifact_object_id TEXT PRIMARY KEY REFERENCES artifact_objects(id) ON DELETE CASCADE,
    storage_deleted_at TEXT NOT NULL
  );
`;

export function up(db: MigrationDatabase): void {
  db.exec(migrationSql);
}
