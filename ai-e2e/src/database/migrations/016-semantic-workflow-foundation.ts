interface MigrationDatabase {
  exec(sql: string): unknown;
}

export const migrationId = 16;
export const migrationName = 'semantic-workflow-foundation';

export const migrationSql = `
  CREATE TABLE IF NOT EXISTS browser_job_queue_meta (
    key TEXT PRIMARY KEY,
    next_queue_seq INTEGER NOT NULL CHECK(next_queue_seq > 0)
  );
  INSERT INTO browser_job_queue_meta (key, next_queue_seq)
    VALUES ('global', 1) ON CONFLICT(key) DO NOTHING;

  CREATE TABLE IF NOT EXISTS browser_jobs (
    id TEXT PRIMARY KEY,
    root_context_type TEXT NOT NULL CHECK(root_context_type IN ('run','authoring')),
    root_context_id TEXT NOT NULL,
    queue_seq INTEGER NOT NULL UNIQUE CHECK(queue_seq > 0),
    state TEXT NOT NULL CHECK(state IN ('queued','acquiring','active','releasing','completed','cancelled','failed')),
    browser_session_id TEXT,
    capability_snapshot_sha256 TEXT CHECK(capability_snapshot_sha256 IS NULL OR length(capability_snapshot_sha256) = 64),
    created_at TEXT NOT NULL,
    acquired_at TEXT,
    released_at TEXT,
    error_json TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_browser_job_single_active
    ON browser_jobs ((1)) WHERE state IN ('acquiring','active','releasing');
  CREATE INDEX IF NOT EXISTS idx_browser_jobs_queue ON browser_jobs(state, queue_seq);

  CREATE TABLE IF NOT EXISTS authoring_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    mode TEXT NOT NULL CHECK(mode IN ('bootstrap','recheck','repair','import_conversion')),
    idempotency_key TEXT NOT NULL,
    request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64),
    parent_run_id TEXT,
    browser_job_id TEXT REFERENCES browser_jobs(id) ON DELETE RESTRICT,
    lifecycle TEXT NOT NULL CHECK(lifecycle IN ('created','planning','running','paused','waiting_decision','completing','completed','cancelling','cancelled','failed')),
    outcome TEXT CHECK(outcome IS NULL OR outcome IN ('succeeded','partial','failed','cancelled')),
    stage TEXT NOT NULL,
    strategy_version TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    input_sha256 TEXT NOT NULL CHECK(length(input_sha256) = 64),
    state_version INTEGER NOT NULL DEFAULT 1 CHECK(state_version > 0),
    next_event_seq INTEGER NOT NULL DEFAULT 1 CHECK(next_event_seq > 0),
    active_task_id TEXT,
    coverage_summary_json TEXT,
    result_json TEXT,
    pause_reason_json TEXT,
    current_policy_evaluation_id TEXT,
    active_approval_grant_id TEXT,
    created_by TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(business_version_id, idempotency_key)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_authoring_job_single_writer
    ON authoring_jobs(business_version_id)
    WHERE lifecycle IN ('created','planning','running','paused','waiting_decision','completing','cancelling');

  CREATE TABLE IF NOT EXISTS authoring_tasks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    task_key TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('ingest_prd','extract_requirements','discover_page','model_page','specify_module','generate_script','generate_scenario','verify_script','verify_scenario','analyze_impact','validate_version','activate_assets')),
    state TEXT NOT NULL CHECK(state IN ('pending','ready','running','waiting_decision','blocked','succeeded','failed','skipped','cancelled')),
    dependencies_json TEXT NOT NULL DEFAULT '[]',
    target_type TEXT,
    target_id TEXT,
    input_sha256 TEXT NOT NULL CHECK(length(input_sha256) = 64),
    input_json_redacted TEXT NOT NULL,
    tool_policy_hash TEXT NOT NULL CHECK(length(tool_policy_hash) = 64),
    skill_policy_hash TEXT NOT NULL CHECK(length(skill_policy_hash) = 64),
    budget_json TEXT NOT NULL,
    current_attempt_id TEXT,
    decision_id TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(job_id, task_key)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_authoring_task_single_running
    ON authoring_tasks(job_id) WHERE state = 'running';

  CREATE TABLE IF NOT EXISTS authoring_attempts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    task_id TEXT NOT NULL REFERENCES authoring_tasks(id) ON DELETE RESTRICT,
    attempt_no INTEGER NOT NULL CHECK(attempt_no > 0),
    agent_task_id TEXT,
    page_task_ref TEXT,
    status TEXT NOT NULL CHECK(status IN ('succeeded','failed','blocked','interrupted','decision_required','cancelled')),
    candidate_asset_type TEXT,
    candidate_asset_id TEXT,
    candidate_revision_id TEXT,
    input_sha256 TEXT NOT NULL CHECK(length(input_sha256) = 64),
    result_json TEXT,
    evidence_manifest_id TEXT,
    error_json TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    UNIQUE(task_id, attempt_no)
  );

  CREATE TABLE IF NOT EXISTS authoring_commands (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK(type IN ('start','pause','resume','cancel','answer_decision')),
    expected_state_version INTEGER NOT NULL CHECK(expected_state_version > 0),
    request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64),
    status TEXT NOT NULL CHECK(status IN ('accepted','completed','rejected')),
    result_json TEXT,
    error_json TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS authoring_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    seq INTEGER NOT NULL CHECK(seq > 0),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
    type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    state_version INTEGER,
    correlation_id TEXT,
    causation_id TEXT,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(job_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_authoring_events_entity
    ON authoring_events(job_id, entity_type, entity_id, seq);

  CREATE TABLE IF NOT EXISTS test_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    client_run_id TEXT NOT NULL,
    request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64),
    engine TEXT NOT NULL DEFAULT 'semantic_v1' CHECK(engine = 'semantic_v1'),
    purpose TEXT NOT NULL CHECK(purpose IN ('formal','authoring_verification')),
    authoring_job_id TEXT REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    browser_job_id TEXT NOT NULL REFERENCES browser_jobs(id) ON DELETE RESTRICT,
    scenario_revision_id TEXT NOT NULL REFERENCES semantic_test_scenario_revisions(id) ON DELETE RESTRICT,
    deployment_revision_id TEXT NOT NULL REFERENCES deployment_profile_revisions(id) ON DELETE RESTRICT,
    lifecycle TEXT NOT NULL CHECK(lifecycle IN ('created','planning','ready','running','paused','completing','completed','cancelling','cancelled')),
    outcome TEXT CHECK(outcome IS NULL OR outcome IN ('passed','failed','cancelled')),
    state_version INTEGER NOT NULL DEFAULT 1 CHECK(state_version > 0),
    next_event_seq INTEGER NOT NULL DEFAULT 1 CHECK(next_event_seq > 0),
    browser_session_id TEXT,
    active_page_task_id TEXT,
    auth_context_state TEXT NOT NULL DEFAULT 'unknown' CHECK(auth_context_state IN ('anonymous','authenticated','unknown')),
    active_actor_key TEXT,
    side_effect_policy_version TEXT NOT NULL,
    side_effect_projection_sha256 TEXT NOT NULL CHECK(length(side_effect_projection_sha256) = 64),
    current_policy_evaluation_id TEXT,
    active_approval_grant_id TEXT,
    pause_reason_json TEXT,
    termination_reason_json TEXT,
    summary_json TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, client_run_id),
    CHECK((purpose = 'formal' AND authoring_job_id IS NULL) OR (purpose = 'authoring_verification' AND authoring_job_id IS NOT NULL)),
    CHECK((auth_context_state = 'authenticated' AND active_actor_key IS NOT NULL) OR (auth_context_state != 'authenticated' AND active_actor_key IS NULL))
  );

  CREATE TABLE IF NOT EXISTS run_plans (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE REFERENCES test_runs(id) ON DELETE RESTRICT,
    schema_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS run_plan_amendments (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    reason TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('script_repair','recovery','login','cleanup','operator_decision')),
    decision_id TEXT,
    payload_json TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
    side_effect_projection_sha256 TEXT NOT NULL CHECK(length(side_effect_projection_sha256) = 64),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS run_todos (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
    todo_key TEXT NOT NULL,
    origin_call_key TEXT NOT NULL,
    repeat_index INTEGER NOT NULL DEFAULT 0 CHECK(repeat_index >= 0),
    functional_script_revision_id TEXT NOT NULL REFERENCES functional_script_revisions(id) ON DELETE RESTRICT,
    page_definition_revision_id TEXT NOT NULL REFERENCES page_definition_revisions(id) ON DELETE RESTRICT,
    state TEXT NOT NULL CHECK(state IN ('waiting_dependencies','ready','running','waiting_decision','blocked','interrupted','passed','failed','skipped','cancelled')),
    state_version INTEGER NOT NULL DEFAULT 1 CHECK(state_version > 0),
    input_json_redacted TEXT NOT NULL,
    input_secret_refs_json TEXT NOT NULL DEFAULT '[]',
    auth_context_json TEXT NOT NULL,
    published_outputs_json TEXT,
    partial_outputs_json TEXT,
    side_effect_summary_json TEXT,
    block_reason_json TEXT,
    skip_reason_json TEXT,
    current_attempt_id TEXT,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE(run_id, todo_key)
  );
  CREATE INDEX IF NOT EXISTS idx_run_todos_state ON run_todos(run_id, state);

  CREATE TABLE IF NOT EXISTS run_todo_dependencies (
    run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
    from_todo_id TEXT NOT NULL REFERENCES run_todos(id) ON DELETE RESTRICT,
    to_todo_id TEXT NOT NULL REFERENCES run_todos(id) ON DELETE RESTRICT,
    mode TEXT NOT NULL CHECK(mode IN ('requires_success','requires_completion')),
    requires_outputs_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY(run_id, from_todo_id, to_todo_id),
    CHECK(from_todo_id != to_todo_id)
  );

  CREATE TABLE IF NOT EXISTS page_tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
    task_no INTEGER NOT NULL CHECK(task_no > 0),
    state TEXT NOT NULL CHECK(state IN ('created','running','paused','completed','failed','interrupted','cancelled')),
    todo_ids_json TEXT NOT NULL,
    page_definition_revision_id TEXT NOT NULL REFERENCES page_definition_revisions(id) ON DELETE RESTRICT,
    browser_session_id TEXT NOT NULL,
    tab_id TEXT NOT NULL,
    required_auth_context_json TEXT NOT NULL,
    side_effect_authorization_json TEXT NOT NULL,
    browser_lease_ref_hash TEXT NOT NULL CHECK(length(browser_lease_ref_hash) = 64),
    ai_task_id TEXT,
    ai_session_id TEXT,
    tool_policy_hash TEXT NOT NULL CHECK(length(tool_policy_hash) = 64),
    task_payload_sha256 TEXT NOT NULL CHECK(length(task_payload_sha256) = 64),
    budget_json TEXT NOT NULL,
    checkpoint_json TEXT,
    result_json TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, task_no)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_page_task_single_active
    ON page_tasks(run_id) WHERE state IN ('created','running','paused');

  CREATE TABLE IF NOT EXISTS execution_attempts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
    todo_id TEXT NOT NULL REFERENCES run_todos(id) ON DELETE RESTRICT,
    page_task_id TEXT NOT NULL REFERENCES page_tasks(id) ON DELETE RESTRICT,
    attempt_no INTEGER NOT NULL CHECK(attempt_no > 0),
    script_revision_id TEXT NOT NULL REFERENCES functional_script_revisions(id) ON DELETE RESTRICT,
    result TEXT NOT NULL CHECK(result IN ('succeeded','assertion_failed','execution_failed','precondition_blocked','recoverable_interruption','decision_required','outcome_unknown','cancelled')),
    reason_class TEXT NOT NULL,
    last_checkpoint_json TEXT,
    actual_page_json TEXT,
    actual_auth_before_json TEXT,
    actual_auth_after_json TEXT,
    confirmed_outputs_json TEXT,
    partial_outputs_json TEXT,
    side_effects_json TEXT,
    downstream_impact_json TEXT,
    policy_evaluation_id TEXT,
    approval_grant_id TEXT,
    evidence_manifest_id TEXT,
    agent_task_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    UNIQUE(todo_id, attempt_no)
  );

  CREATE TABLE IF NOT EXISTS run_variables (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','sensitive','secret')),
    status TEXT NOT NULL CHECK(status IN ('confirmed','unconfirmed','revoked')),
    value_json TEXT,
    secret_ref TEXT,
    source_todo_id TEXT REFERENCES run_todos(id) ON DELETE RESTRICT,
    source_attempt_id TEXT REFERENCES execution_attempts(id) ON DELETE RESTRICT,
    source_output_id TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    CHECK((sensitivity = 'secret' AND value_json IS NULL AND secret_ref IS NOT NULL) OR (sensitivity != 'secret' AND secret_ref IS NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_run_variable_confirmed
    ON run_variables(run_id, namespace, name) WHERE status = 'confirmed';

  CREATE TABLE IF NOT EXISTS decision_requests (
    id TEXT PRIMARY KEY,
    context_type TEXT NOT NULL CHECK(context_type IN ('run','authoring')),
    context_id TEXT NOT NULL,
    run_id TEXT REFERENCES test_runs(id) ON DELETE RESTRICT,
    authoring_job_id TEXT REFERENCES authoring_jobs(id) ON DELETE RESTRICT,
    todo_id TEXT REFERENCES run_todos(id) ON DELETE RESTRICT,
    attempt_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('open','answered','applied','withdrawn','expired')),
    category TEXT NOT NULL,
    required_authority TEXT NOT NULL,
    question TEXT NOT NULL,
    facts_json TEXT NOT NULL,
    evidence_refs_json TEXT NOT NULL DEFAULT '[]',
    options_json TEXT NOT NULL,
    recommendation_key TEXT,
    impact_json TEXT NOT NULL,
    state_version INTEGER NOT NULL DEFAULT 1 CHECK(state_version > 0),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    answered_at TEXT,
    applied_at TEXT,
    CHECK((context_type = 'run' AND context_id = run_id AND run_id IS NOT NULL AND authoring_job_id IS NULL) OR (context_type = 'authoring' AND context_id = authoring_job_id AND authoring_job_id IS NOT NULL AND run_id IS NULL))
  );

  CREATE TABLE IF NOT EXISTS decision_answers (
    id TEXT PRIMARY KEY,
    decision_request_id TEXT NOT NULL UNIQUE REFERENCES decision_requests(id) ON DELETE RESTRICT,
    answer_key TEXT,
    custom_answer TEXT,
    reason TEXT NOT NULL,
    answered_by_type TEXT NOT NULL,
    answered_by_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK(answer_key IS NOT NULL OR custom_answer IS NOT NULL)
  );

  CREATE TABLE IF NOT EXISTS run_commands (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK(type IN ('create','start','pause','resume','cancel','answer','apply')),
    expected_state_version INTEGER NOT NULL CHECK(expected_state_version > 0),
    request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64),
    status TEXT NOT NULL CHECK(status IN ('accepted','completed','rejected')),
    result_json TEXT,
    error_json TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
    seq INTEGER NOT NULL CHECK(seq > 0),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
    type TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('run','todo','attempt','page_task','decision','side_effect_approval','evidence','browser_operation')),
    entity_id TEXT NOT NULL,
    state_version INTEGER,
    correlation_id TEXT,
    causation_id TEXT,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_run_events_entity
    ON run_events(run_id, entity_type, entity_id, seq);

  CREATE TABLE IF NOT EXISTS page_observations (
    id TEXT PRIMARY KEY,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    run_id TEXT REFERENCES test_runs(id) ON DELETE RESTRICT,
    observed_url_redacted TEXT NOT NULL,
    title TEXT NOT NULL,
    deployment_revision_id TEXT NOT NULL REFERENCES deployment_profile_revisions(id) ON DELETE RESTRICT,
    matched_page_definition_id TEXT REFERENCES page_definitions(id) ON DELETE RESTRICT,
    match_status TEXT NOT NULL CHECK(match_status IN ('exact','ambiguous','unmatched','abnormal')),
    snapshot_artifact_id TEXT,
    screenshot_artifact_id TEXT,
    observed_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('exploration','run','manual'))
  );

  CREATE TRIGGER IF NOT EXISTS trg_run_plan_immutable
    BEFORE UPDATE ON run_plans BEGIN SELECT RAISE(ABORT, 'run plan is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_run_plan_amendment_immutable
    BEFORE UPDATE ON run_plan_amendments BEGIN SELECT RAISE(ABORT, 'run plan amendment is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_execution_attempt_immutable
    BEFORE UPDATE ON execution_attempts BEGIN SELECT RAISE(ABORT, 'execution attempt is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_authoring_attempt_immutable
    BEFORE UPDATE ON authoring_attempts BEGIN SELECT RAISE(ABORT, 'authoring attempt is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_run_event_immutable
    BEFORE UPDATE ON run_events BEGIN SELECT RAISE(ABORT, 'run event is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_authoring_event_immutable
    BEFORE UPDATE ON authoring_events BEGIN SELECT RAISE(ABORT, 'authoring event is immutable'); END;
`;

export function up(db: MigrationDatabase): void {
  db.exec(migrationSql);
}
