import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name TEXT NOT NULL,
      target_base_url TEXT,
      auth_config_json TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','configuring','analyzing','analyzed','exploring','explored','generating','ready','running','completed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC)
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_projects_created_at`);
  db.exec(`DROP INDEX IF EXISTS idx_projects_status`);
  db.exec(`DROP TABLE IF EXISTS projects`);
}
