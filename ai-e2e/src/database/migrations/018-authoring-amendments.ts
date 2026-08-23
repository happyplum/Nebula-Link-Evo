interface MigrationDatabase {
  exec(sql: string): unknown;
}

export const migrationId = 18;
export const migrationName = 'authoring-amendments';

export const migrationSql = `
  CREATE TABLE IF NOT EXISTS authoring_context_threads (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    scope_key TEXT NOT NULL,
    current_url_redacted TEXT NOT NULL,
    current_page_definition_id TEXT NOT NULL REFERENCES page_definitions(id) ON DELETE RESTRICT,
    current_functional_module_id TEXT NOT NULL REFERENCES semantic_functional_modules(id) ON DELETE RESTRICT,
    base_revision_sha256 TEXT NOT NULL CHECK(length(base_revision_sha256) = 64),
    state TEXT NOT NULL CHECK(state IN ('active','stale','closed')),
    context_json_redacted TEXT NOT NULL,
    stale_reason_json TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(job_id, scope_key)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_authoring_thread_active
    ON authoring_context_threads(job_id) WHERE state = 'active';

  CREATE TABLE IF NOT EXISTS authoring_amendments (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    thread_id TEXT NOT NULL REFERENCES authoring_context_threads(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL,
    request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64),
    state TEXT NOT NULL CHECK(state IN (
      'draft','candidate_ready','waiting_decision','queued_at_safe_boundary','verifying',
      'activated','rejected','failed','stale'
    )),
    reason TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN (
      'requirement','script','acceptance','scenario_add','scenario_remove',
      'scenario_reorder','module_call','repair'
    )),
    impact_json TEXT NOT NULL,
    validation_plan_json TEXT NOT NULL,
    decision_ids_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL,
    queued_at TEXT,
    verification_started_at TEXT,
    completed_at TEXT,
    failure_json TEXT,
    stale_reason_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(job_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS idx_authoring_amendments_state
    ON authoring_amendments(job_id, state, created_at);

  CREATE TABLE IF NOT EXISTS authoring_amendment_decisions (
    amendment_id TEXT NOT NULL REFERENCES authoring_amendments(id) ON DELETE RESTRICT,
    decision_id TEXT NOT NULL UNIQUE REFERENCES decision_requests(id) ON DELETE RESTRICT,
    scope_kind TEXT NOT NULL CHECK(scope_kind IN ('same_page_other_module','cross_url')),
    PRIMARY KEY(amendment_id, decision_id)
  );

  CREATE TABLE IF NOT EXISTS authoring_amendment_changes (
    id TEXT PRIMARY KEY,
    amendment_id TEXT NOT NULL REFERENCES authoring_amendments(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    asset_type TEXT NOT NULL CHECK(asset_type IN (
      'page_definition','business_module','functional_module','functional_script',
      'test_scenario','page_baseline','module_requirement'
    )),
    asset_id TEXT NOT NULL,
    base_revision_id TEXT NOT NULL,
    base_revision_sha256 TEXT NOT NULL CHECK(length(base_revision_sha256) = 64),
    candidate_revision_id TEXT NOT NULL,
    target_page_definition_id TEXT NOT NULL REFERENCES page_definitions(id) ON DELETE RESTRICT,
    target_functional_module_id TEXT REFERENCES semantic_functional_modules(id) ON DELETE RESTRICT,
    target_url_redacted TEXT NOT NULL,
    category TEXT NOT NULL,
    diff_json TEXT NOT NULL,
    dependencies_json TEXT NOT NULL DEFAULT '[]',
    verification_scope_sha256 TEXT CHECK(verification_scope_sha256 IS NULL OR length(verification_scope_sha256) = 64),
    dependency_closure_sha256 TEXT CHECK(dependency_closure_sha256 IS NULL OR length(dependency_closure_sha256) = 64),
    created_at TEXT NOT NULL,
    UNIQUE(amendment_id, sequence),
    UNIQUE(amendment_id, asset_type, asset_id)
  );

  CREATE TABLE IF NOT EXISTS authoring_chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES authoring_context_threads(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    amendment_id TEXT REFERENCES authoring_amendments(id) ON DELETE RESTRICT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_authoring_chat_messages_thread
    ON authoring_chat_messages(thread_id, created_at);

  CREATE TRIGGER IF NOT EXISTS trg_authoring_amendment_change_immutable
    BEFORE UPDATE OF asset_type, asset_id, base_revision_id, base_revision_sha256,
      candidate_revision_id, target_page_definition_id, target_functional_module_id,
      target_url_redacted, category, diff_json, dependencies_json
    ON authoring_amendment_changes
    BEGIN SELECT RAISE(ABORT, 'authoring amendment change is immutable'); END;
`;

export function up(db: MigrationDatabase): void {
  db.exec(migrationSql);
}
