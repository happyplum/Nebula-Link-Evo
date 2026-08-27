interface MigrationDatabase {
  exec(sql: string): unknown;
}

export const migrationId = 20;
export const migrationName = 'agent-activity';

export const migrationSql = `
  CREATE TABLE IF NOT EXISTS semantic_agent_activity_events (
    context_type TEXT NOT NULL CHECK(context_type IN ('authoring','run')),
    context_id TEXT NOT NULL,
    seq INTEGER NOT NULL CHECK(seq >= 1),
    source_task_id TEXT NOT NULL,
    source_seq INTEGER NOT NULL CHECK(source_seq >= 0),
    event_json TEXT NOT NULL,
    page_task_id TEXT,
    authoring_task_id TEXT,
    todo_id TEXT,
    page_definition_id TEXT,
    functional_module_id TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(context_type, context_id, seq),
    UNIQUE(context_type, context_id, source_task_id, source_seq)
  );

  CREATE INDEX IF NOT EXISTS idx_semantic_agent_activity_source
    ON semantic_agent_activity_events(context_type, context_id, source_task_id, source_seq);

  CREATE TABLE IF NOT EXISTS semantic_agent_activity_cursors (
    context_type TEXT NOT NULL CHECK(context_type IN ('authoring','run')),
    context_id TEXT NOT NULL,
    source_task_id TEXT NOT NULL,
    last_activity_seq INTEGER NOT NULL DEFAULT 0 CHECK(last_activity_seq >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(context_type, context_id, source_task_id)
  );
`;

export function up(db: MigrationDatabase): void {
  db.exec(migrationSql);
}
