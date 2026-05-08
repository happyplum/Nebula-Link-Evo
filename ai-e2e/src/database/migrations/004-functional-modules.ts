import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS functional_modules (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      business_module_id TEXT NOT NULL REFERENCES business_modules(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      bound_url_id TEXT REFERENCES urls(id) ON DELETE SET NULL,
      source TEXT NOT NULL DEFAULT 'ai_generated' CHECK(source IN ('ai_generated','human_created','human_modified')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_functional_modules_business_module_id ON functional_modules(business_module_id)
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_functional_modules_business_module_id`);
  db.exec(`DROP TABLE IF EXISTS functional_modules`);
}
