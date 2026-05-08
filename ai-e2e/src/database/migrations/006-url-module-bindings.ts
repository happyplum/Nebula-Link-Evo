import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS url_module_bindings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      url_id TEXT NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
      functional_module_id TEXT NOT NULL REFERENCES functional_modules(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'ai_proposed' CHECK(status IN ('ai_proposed','human_confirmed','human_modified','rejected')),
      confidence_score REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(url_id, functional_module_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_url_module_bindings_url_id ON url_module_bindings(url_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_url_module_bindings_functional_module_id ON url_module_bindings(functional_module_id)
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_url_module_bindings_functional_module_id`);
  db.exec(`DROP INDEX IF EXISTS idx_url_module_bindings_url_id`);
  db.exec(`DROP TABLE IF EXISTS url_module_bindings`);
}
