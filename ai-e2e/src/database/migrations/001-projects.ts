import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      create_request_id TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC)
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_projects_created_at`);
  db.exec(`DROP TABLE IF EXISTS projects`);
}
