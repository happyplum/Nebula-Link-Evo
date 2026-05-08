import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS urls (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT,
      discovered_method TEXT CHECK(discovered_method IN ('seed','ai_discovered','manual')),
      page_snapshot_json TEXT,
      auth_required INTEGER NOT NULL DEFAULT 0,
      last_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_urls_project_id ON urls(project_id)
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_urls_project_id`);
  db.exec(`DROP TABLE IF EXISTS urls`);
}
