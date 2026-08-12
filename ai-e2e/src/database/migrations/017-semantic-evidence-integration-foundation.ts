interface MigrationDatabase {
  exec(sql: string): unknown;
}

export const migrationId = 17;
export const migrationName = 'semantic-evidence-integration-foundation';

export const migrationSql = `
  CREATE TABLE IF NOT EXISTS side_effect_policy_evaluations (
    id TEXT PRIMARY KEY,
    context_type TEXT NOT NULL CHECK(context_type IN ('run','authoring')),
    context_id TEXT NOT NULL,
    run_id TEXT REFERENCES test_runs(id) ON DELETE RESTRICT,
    authoring_job_id TEXT REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    deployment_revision_id TEXT NOT NULL REFERENCES deployment_profile_revisions(id) ON DELETE RESTRICT,
    environment TEXT NOT NULL CHECK(environment IN ('local','test','staging','production')),
    policy_version TEXT NOT NULL,
    source_plan_sha256 TEXT NOT NULL CHECK(length(source_plan_sha256) = 64),
    projection_json_redacted TEXT NOT NULL,
    projection_sha256 TEXT NOT NULL CHECK(length(projection_sha256) = 64),
    result TEXT NOT NULL CHECK(result IN ('auto_allowed','approval_required','denied')),
    reason_codes_json TEXT NOT NULL DEFAULT '[]',
    supersedes_evaluation_id TEXT REFERENCES side_effect_policy_evaluations(id) ON DELETE RESTRICT,
    decision_request_id TEXT REFERENCES decision_requests(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    UNIQUE(context_type, context_id, source_plan_sha256, projection_sha256, policy_version),
    CHECK((context_type = 'run' AND context_id = run_id AND run_id IS NOT NULL AND authoring_job_id IS NULL) OR (context_type = 'authoring' AND context_id = authoring_job_id AND authoring_job_id IS NOT NULL AND run_id IS NULL))
  );

  CREATE TABLE IF NOT EXISTS side_effect_approval_grants (
    id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES side_effect_policy_evaluations(id) ON DELETE RESTRICT,
    context_type TEXT NOT NULL CHECK(context_type IN ('run','authoring')),
    context_id TEXT NOT NULL,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    deployment_revision_id TEXT NOT NULL REFERENCES deployment_profile_revisions(id) ON DELETE RESTRICT,
    policy_version TEXT NOT NULL,
    approved_projection_json_redacted TEXT NOT NULL,
    approved_projection_sha256 TEXT NOT NULL CHECK(length(approved_projection_sha256) = 64),
    decision_request_id TEXT NOT NULL REFERENCES decision_requests(id) ON DELETE RESTRICT,
    decision_answer_id TEXT NOT NULL REFERENCES decision_answers(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK(status IN ('active','revoked','expired')),
    approved_by TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    revoked_at TEXT,
    expired_at TEXT,
    reason_json TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_side_effect_grant_active
    ON side_effect_approval_grants(context_type, context_id) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS artifact_objects (
    id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
    size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
    media_type TEXT NOT NULL,
    storage_backend TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','sensitive','restricted')),
    redaction_status TEXT NOT NULL CHECK(redaction_status IN ('not_required','pending','redacted','failed')),
    encryption_key_ref TEXT,
    ref_count INTEGER NOT NULL DEFAULT 0 CHECK(ref_count >= 0),
    created_at TEXT NOT NULL,
    expires_at TEXT,
    pinned_at TEXT,
    deleted_at TEXT,
    UNIQUE(sha256, storage_backend, sensitivity)
  );

  CREATE TABLE IF NOT EXISTS evidence_manifests (
    id TEXT PRIMARY KEY,
    context_type TEXT NOT NULL CHECK(context_type IN ('run','authoring')),
    context_id TEXT NOT NULL,
    run_id TEXT REFERENCES test_runs(id) ON DELETE RESTRICT,
    authoring_job_id TEXT REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    todo_id TEXT REFERENCES run_todos(id) ON DELETE RESTRICT,
    attempt_id TEXT,
    schema_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','sealed')),
    supersedes_manifest_id TEXT REFERENCES evidence_manifests(id) ON DELETE RESTRICT,
    completeness TEXT NOT NULL CHECK(completeness IN ('complete','partial','failed')),
    manifest_json TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256) = 64),
    retention_class TEXT NOT NULL CHECK(retention_class IN ('success_7d','failure_30d','pinned','custom')),
    sealed_at TEXT,
    created_at TEXT NOT NULL,
    CHECK((context_type = 'run' AND context_id = run_id AND run_id IS NOT NULL AND authoring_job_id IS NULL) OR (context_type = 'authoring' AND context_id = authoring_job_id AND authoring_job_id IS NOT NULL AND run_id IS NULL))
  );

  CREATE TABLE IF NOT EXISTS evidence_items (
    id TEXT PRIMARY KEY,
    manifest_id TEXT NOT NULL REFERENCES evidence_manifests(id) ON DELETE RESTRICT,
    item_type TEXT NOT NULL CHECK(item_type IN ('screenshot','annotated_screenshot','dom_snapshot','operation_result','assertion_result','console_meta','network_meta','video_segment','trace','agent_audit','decision')),
    artifact_object_id TEXT REFERENCES artifact_objects(id) ON DELETE RESTRICT,
    inline_json TEXT,
    step_id TEXT,
    browser_operation_id TEXT,
    captured_at TEXT NOT NULL,
    source_service TEXT NOT NULL CHECK(source_service IN ('ai-e2e','ai-chat-service','proxy-adapter')),
    redaction_status TEXT NOT NULL CHECK(redaction_status IN ('not_required','pending','redacted','failed')),
    integrity_sha256 TEXT NOT NULL CHECK(length(integrity_sha256) = 64),
    metadata_json TEXT NOT NULL,
    CHECK((artifact_object_id IS NOT NULL AND inline_json IS NULL) OR (artifact_object_id IS NULL AND inline_json IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_evidence_items_manifest ON evidence_items(manifest_id, captured_at);

  CREATE TABLE IF NOT EXISTS browser_operation_links (
    operation_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
    page_task_id TEXT NOT NULL REFERENCES page_tasks(id) ON DELETE RESTRICT,
    todo_id TEXT NOT NULL REFERENCES run_todos(id) ON DELETE RESTRICT,
    attempt_id TEXT NOT NULL REFERENCES execution_attempts(id) ON DELETE RESTRICT,
    step_id TEXT NOT NULL,
    proxy_result_status TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64),
    result_ref TEXT,
    evidence_item_id TEXT REFERENCES evidence_items(id) ON DELETE RESTRICT,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS integration_outbox (
    id TEXT PRIMARY KEY,
    context_type TEXT NOT NULL CHECK(context_type IN ('run','authoring')),
    context_id TEXT NOT NULL,
    run_id TEXT REFERENCES test_runs(id) ON DELETE RESTRICT,
    page_task_id TEXT REFERENCES page_tasks(id) ON DELETE RESTRICT,
    attempt_id TEXT REFERENCES execution_attempts(id) ON DELETE RESTRICT,
    authoring_job_id TEXT REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    authoring_task_id TEXT REFERENCES authoring_tasks(id) ON DELETE RESTRICT,
    authoring_attempt_id TEXT REFERENCES authoring_attempts(id) ON DELETE RESTRICT,
    target_service TEXT NOT NULL CHECK(target_service IN ('ai_chat_service','proxy_adapter')),
    command_type TEXT NOT NULL,
    endpoint_or_tool TEXT NOT NULL,
    request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64),
    payload_json_redacted TEXT NOT NULL,
    secret_binding_ref TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','dispatching','confirmed','retryable_failed','terminal_failed','cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    next_attempt_at TEXT,
    last_error_json TEXT,
    result_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    confirmed_at TEXT,
    CHECK((context_type = 'run' AND context_id = run_id AND run_id IS NOT NULL AND authoring_job_id IS NULL) OR (context_type = 'authoring' AND context_id = authoring_job_id AND authoring_job_id IS NOT NULL AND run_id IS NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_integration_outbox_dispatch
    ON integration_outbox(status, next_attempt_at, created_at);

  CREATE TABLE IF NOT EXISTS external_task_links (
    id TEXT PRIMARY KEY,
    context_type TEXT NOT NULL CHECK(context_type IN ('run','authoring')),
    context_id TEXT NOT NULL,
    run_id TEXT REFERENCES test_runs(id) ON DELETE RESTRICT,
    page_task_id TEXT REFERENCES page_tasks(id) ON DELETE RESTRICT,
    attempt_id TEXT REFERENCES execution_attempts(id) ON DELETE RESTRICT,
    authoring_job_id TEXT REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    authoring_task_id TEXT REFERENCES authoring_tasks(id) ON DELETE RESTRICT,
    authoring_attempt_id TEXT REFERENCES authoring_attempts(id) ON DELETE RESTRICT,
    service TEXT NOT NULL CHECK(service IN ('ai_chat_service','proxy_adapter')),
    kind TEXT NOT NULL CHECK(kind IN ('agent_task','browser_session','browser_lease','browser_operation','artifact')),
    external_id TEXT NOT NULL,
    external_state TEXT,
    last_external_seq INTEGER,
    request_sha256 TEXT CHECK(request_sha256 IS NULL OR length(request_sha256) = 64),
    result_sha256 TEXT CHECK(result_sha256 IS NULL OR length(result_sha256) = 64),
    result_ref TEXT,
    token_hash TEXT CHECK(token_hash IS NULL OR length(token_hash) = 64),
    secret_ref TEXT,
    created_at TEXT NOT NULL,
    last_reconciled_at TEXT,
    terminal_at TEXT,
    UNIQUE(service, kind, external_id),
    CHECK((context_type = 'run' AND context_id = run_id AND run_id IS NOT NULL AND authoring_job_id IS NULL) OR (context_type = 'authoring' AND context_id = authoring_job_id AND authoring_job_id IS NOT NULL AND run_id IS NULL))
  );

  CREATE TABLE IF NOT EXISTS legacy_import_batches (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    source_schema_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','running','needs_review','completed','failed')),
    source_fingerprint TEXT NOT NULL,
    counts_json TEXT NOT NULL,
    issues_json TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, source_fingerprint)
  );

  CREATE TABLE IF NOT EXISTS legacy_entity_links (
    batch_id TEXT NOT NULL REFERENCES legacy_import_batches(id) ON DELETE RESTRICT,
    source_table TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    target_revision_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('imported','candidate','skipped','blocked')),
    reason_json TEXT,
    PRIMARY KEY(batch_id, source_table, source_id)
  );

  CREATE TRIGGER IF NOT EXISTS trg_artifact_object_content_immutable
    BEFORE UPDATE OF sha256, size_bytes, media_type, storage_backend, storage_key, sensitivity
    ON artifact_objects BEGIN SELECT RAISE(ABORT, 'artifact object content is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_evidence_manifest_sealed_immutable
    BEFORE UPDATE ON evidence_manifests WHEN OLD.status = 'sealed'
    BEGIN SELECT RAISE(ABORT, 'sealed evidence manifest is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_evidence_item_immutable
    BEFORE UPDATE ON evidence_items BEGIN SELECT RAISE(ABORT, 'evidence item is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_policy_evaluation_immutable
    BEFORE UPDATE ON side_effect_policy_evaluations
    BEGIN SELECT RAISE(ABORT, 'policy evaluation is immutable'); END;
`;

export function up(db: MigrationDatabase): void {
  db.exec(migrationSql);
}
