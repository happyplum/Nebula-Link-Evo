interface MigrationDatabase {
  exec(sql: string): unknown;
}

export const migrationId = 15;
export const migrationName = 'semantic-asset-governance';

export const migrationSql = `
  CREATE TABLE IF NOT EXISTS version_decisions (
    id TEXT PRIMARY KEY,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    decision_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','superseded','withdrawn')),
    question TEXT NOT NULL,
    category TEXT NOT NULL,
    answer TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence_refs_json TEXT NOT NULL DEFAULT '[]',
    supersedes_decision_id TEXT REFERENCES version_decisions(id) ON DELETE RESTRICT,
    decided_by_type TEXT NOT NULL CHECK(decided_by_type IN ('user','main_agent')),
    decided_by_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_version_decision_active
    ON version_decisions(business_version_id, decision_key) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS business_version_validations (
    id TEXT PRIMARY KEY,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    deployment_revision_id TEXT NOT NULL REFERENCES deployment_profile_revisions(id) ON DELETE RESTRICT,
    asset_graph_sha256 TEXT NOT NULL CHECK(length(asset_graph_sha256) = 64),
    verification_scope_sha256 TEXT NOT NULL CHECK(length(verification_scope_sha256) = 64),
    verification_scope_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('validating','valid','needs_recheck','invalid')),
    is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
    authoring_job_id TEXT,
    validated_at TEXT,
    invalidated_at TEXT,
    reason_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_business_version_validation_current
    ON business_version_validations(business_version_id, deployment_revision_id)
    WHERE is_current = 1;

  CREATE TABLE IF NOT EXISTS page_baseline_variants (
    id TEXT PRIMARY KEY,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    page_definition_id TEXT NOT NULL REFERENCES page_definitions(id) ON DELETE RESTRICT,
    variant_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    archived_at TEXT,
    UNIQUE(page_definition_id, variant_key)
  );

  CREATE TABLE IF NOT EXISTS page_baseline_revisions (
    id TEXT PRIMARY KEY,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    page_baseline_variant_id TEXT NOT NULL REFERENCES page_baseline_variants(id) ON DELETE RESTRICT,
    revision_no INTEGER NOT NULL CHECK(revision_no > 0),
    lifecycle TEXT NOT NULL CHECK(lifecycle IN ('draft','current','superseded','rejected')),
    schema_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
    validation_status TEXT NOT NULL CHECK(validation_status IN ('pending','valid','invalid')),
    validation_errors_json TEXT,
    supersedes_revision_id TEXT REFERENCES page_baseline_revisions(id) ON DELETE RESTRICT,
    source_asset_id TEXT,
    source_revision_id TEXT,
    change_reason TEXT NOT NULL,
    created_by_type TEXT NOT NULL CHECK(created_by_type IN ('user','main_agent','child_agent','system','migration')),
    created_by_id TEXT,
    created_at TEXT NOT NULL,
    validated_at TEXT,
    UNIQUE(page_baseline_variant_id, revision_no)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_page_baseline_revision_current
    ON page_baseline_revisions(page_baseline_variant_id) WHERE lifecycle = 'current';

  CREATE TABLE IF NOT EXISTS module_requirement_revisions (
    id TEXT PRIMARY KEY,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    functional_module_id TEXT NOT NULL REFERENCES semantic_functional_modules(id) ON DELETE RESTRICT,
    revision_no INTEGER NOT NULL CHECK(revision_no > 0),
    lifecycle TEXT NOT NULL CHECK(lifecycle IN ('draft','current','superseded','rejected')),
    schema_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
    validation_status TEXT NOT NULL CHECK(validation_status IN ('pending','valid','invalid')),
    validation_errors_json TEXT,
    supersedes_revision_id TEXT REFERENCES module_requirement_revisions(id) ON DELETE RESTRICT,
    source_asset_id TEXT,
    source_revision_id TEXT,
    change_reason TEXT NOT NULL,
    created_by_type TEXT NOT NULL CHECK(created_by_type IN ('user','main_agent','child_agent','system','migration')),
    created_by_id TEXT,
    created_at TEXT NOT NULL,
    validated_at TEXT,
    UNIQUE(functional_module_id, revision_no)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_module_requirement_revision_current
    ON module_requirement_revisions(functional_module_id) WHERE lifecycle = 'current';

  CREATE TABLE IF NOT EXISTS functional_point_coverage (
    id TEXT PRIMARY KEY,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    functional_module_id TEXT NOT NULL REFERENCES semantic_functional_modules(id) ON DELETE RESTRICT,
    module_requirement_revision_id TEXT NOT NULL REFERENCES module_requirement_revisions(id) ON DELETE RESTRICT,
    functional_point_key TEXT NOT NULL,
    required INTEGER NOT NULL CHECK(required IN (0,1)),
    disposition TEXT NOT NULL CHECK(disposition IN ('covered_by_script','manual','out_of_scope','blocked')),
    functional_script_id TEXT REFERENCES functional_scripts(id) ON DELETE RESTRICT,
    functional_script_revision_id TEXT REFERENCES functional_script_revisions(id) ON DELETE RESTRICT,
    decision_id TEXT REFERENCES version_decisions(id) ON DELETE RESTRICT,
    lifecycle TEXT NOT NULL CHECK(lifecycle IN ('current','superseded')),
    source_authoring_job_id TEXT,
    reason_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK(
      (disposition = 'covered_by_script' AND functional_script_id IS NOT NULL AND functional_script_revision_id IS NOT NULL)
      OR (disposition != 'covered_by_script' AND functional_script_id IS NULL AND functional_script_revision_id IS NULL)
    ),
    CHECK(required = 0 OR disposition NOT IN ('manual','out_of_scope') OR decision_id IS NOT NULL)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_functional_point_coverage_current
    ON functional_point_coverage(business_version_id, module_requirement_revision_id, functional_point_key)
    WHERE lifecycle = 'current';

  CREATE TABLE IF NOT EXISTS asset_revision_verifications (
    id TEXT PRIMARY KEY,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    asset_type TEXT NOT NULL CHECK(asset_type IN ('functional_script','test_scenario')),
    asset_id TEXT NOT NULL,
    asset_revision_id TEXT NOT NULL,
    deployment_revision_id TEXT NOT NULL REFERENCES deployment_profile_revisions(id) ON DELETE RESTRICT,
    verification_scope_sha256 TEXT NOT NULL CHECK(length(verification_scope_sha256) = 64),
    verification_scope_json TEXT NOT NULL,
    dependency_closure_sha256 TEXT NOT NULL CHECK(length(dependency_closure_sha256) = 64),
    status TEXT NOT NULL CHECK(status IN ('verified','stale','revoked')),
    is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
    verification_run_id TEXT,
    authoring_job_id TEXT,
    evidence_manifest_id TEXT,
    verified_at TEXT,
    stale_at TEXT,
    stale_reason_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_revision_verification_current
    ON asset_revision_verifications(asset_revision_id, verification_scope_sha256)
    WHERE is_current = 1;
  CREATE INDEX IF NOT EXISTS idx_asset_revision_verifications_lookup
    ON asset_revision_verifications(business_version_id, asset_type, asset_id, status);

  CREATE TABLE IF NOT EXISTS asset_revision_dependencies (
    id TEXT PRIMARY KEY,
    business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
    from_asset_type TEXT NOT NULL,
    from_asset_id TEXT NOT NULL,
    from_revision_id TEXT NOT NULL,
    to_asset_type TEXT NOT NULL,
    to_asset_id TEXT NOT NULL,
    to_revision_id TEXT,
    relation TEXT NOT NULL CHECK(relation IN ('page_scope','requirement_source','scenario_call','output_binding','assertion_input','baseline_target','decision_source')),
    source_pointer TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(from_revision_id, relation, to_asset_type, to_asset_id, source_pointer)
  );
  CREATE INDEX IF NOT EXISTS idx_asset_revision_dependencies_target
    ON asset_revision_dependencies(business_version_id, to_asset_type, to_asset_id, to_revision_id);

  CREATE TRIGGER IF NOT EXISTS trg_page_baseline_revision_immutable
    BEFORE UPDATE OF payload_json, content_sha256 ON page_baseline_revisions
    BEGIN SELECT RAISE(ABORT, 'revision payload is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_module_requirement_revision_immutable
    BEFORE UPDATE OF payload_json, content_sha256 ON module_requirement_revisions
    BEGIN SELECT RAISE(ABORT, 'revision payload is immutable'); END;
`;

export function up(db: MigrationDatabase): void {
  db.exec(migrationSql);
}
