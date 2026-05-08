import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prd_documents (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      raw_content TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'markdown' CHECK(format IN ('markdown','plain_text')),
      parsed_content_json TEXT,
      ai_model_used TEXT,
      token_count INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prd_documents_project_id ON prd_documents(project_id)
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_prd_documents_project_id`);
  db.exec(`DROP TABLE IF EXISTS prd_documents`);
}
