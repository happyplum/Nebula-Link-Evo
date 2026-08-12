interface MigrationDatabase {
  exec(sql: string): unknown;
}

const REVISION_LIFECYCLE = "CHECK(lifecycle IN ('draft','current','superseded','rejected'))";
const VALIDATION_STATUS = "CHECK(validation_status IN ('pending','valid','invalid'))";

export function up(db: MigrationDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployment_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      profile_key TEXT NOT NULL,
      name TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, profile_key)
    );

    CREATE TABLE IF NOT EXISTS deployment_profile_revisions (
      id TEXT PRIMARY KEY,
      deployment_profile_id TEXT NOT NULL REFERENCES deployment_profiles(id) ON DELETE RESTRICT,
      revision_no INTEGER NOT NULL CHECK(revision_no > 0),
      lifecycle TEXT NOT NULL ${REVISION_LIFECYCLE},
      schema_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
      validation_status TEXT NOT NULL ${VALIDATION_STATUS},
      validation_errors_json TEXT,
      supersedes_revision_id TEXT REFERENCES deployment_profile_revisions(id) ON DELETE RESTRICT,
      source_asset_id TEXT,
      source_revision_id TEXT,
      change_reason TEXT NOT NULL,
      created_by_type TEXT NOT NULL,
      created_by_id TEXT,
      created_at TEXT NOT NULL,
      validated_at TEXT,
      UNIQUE(deployment_profile_id, revision_no)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_profile_revision_current
      ON deployment_profile_revisions(deployment_profile_id)
      WHERE lifecycle = 'current';

    CREATE TABLE IF NOT EXISTS business_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      version_key TEXT NOT NULL,
      name TEXT NOT NULL,
      source_version_id TEXT REFERENCES business_versions(id) ON DELETE RESTRICT,
      create_request_id TEXT,
      copy_request_id TEXT,
      request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
      validation_status TEXT NOT NULL DEFAULT 'draft'
        CHECK(validation_status IN ('draft','validating','needs_recheck','valid','invalid','archived')),
      schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
      git_metadata_json TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE(project_id, version_key)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_business_versions_create_request
      ON business_versions(project_id, create_request_id)
      WHERE create_request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_business_versions_copy_request
      ON business_versions(project_id, copy_request_id)
      WHERE copy_request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_business_versions_project
      ON business_versions(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS version_deployment_bindings (
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      deployment_revision_id TEXT NOT NULL REFERENCES deployment_profile_revisions(id) ON DELETE RESTRICT,
      binding_key TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
      created_at TEXT NOT NULL,
      PRIMARY KEY(business_version_id, binding_key)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_version_default_deployment
      ON version_deployment_bindings(business_version_id)
      WHERE is_default = 1;

    CREATE TABLE IF NOT EXISTS version_prd_documents (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      document_key TEXT NOT NULL,
      format TEXT NOT NULL CHECK(format IN ('markdown','plain_text')),
      raw_content TEXT NOT NULL,
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
      parsed_json TEXT,
      source_uri TEXT,
      is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0, 1)),
      source_document_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_version_prd_current
      ON version_prd_documents(business_version_id, document_key)
      WHERE is_current = 1;

    CREATE TABLE IF NOT EXISTS version_variable_definitions (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public','sensitive','secret')),
      constraints_json TEXT,
      default_json TEXT,
      secret_ref TEXT,
      source_variable_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(business_version_id, name),
      CHECK(sensitivity != 'secret' OR (default_json IS NULL AND secret_ref IS NOT NULL))
    );

    CREATE TABLE IF NOT EXISTS page_definitions (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      page_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE(business_version_id, page_key)
    );

    CREATE TABLE IF NOT EXISTS page_definition_revisions (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      page_definition_id TEXT NOT NULL REFERENCES page_definitions(id) ON DELETE RESTRICT,
      revision_no INTEGER NOT NULL CHECK(revision_no > 0),
      lifecycle TEXT NOT NULL ${REVISION_LIFECYCLE},
      schema_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
      validation_status TEXT NOT NULL ${VALIDATION_STATUS},
      validation_errors_json TEXT,
      supersedes_revision_id TEXT REFERENCES page_definition_revisions(id) ON DELETE RESTRICT,
      source_asset_id TEXT,
      source_revision_id TEXT,
      change_reason TEXT NOT NULL,
      created_by_type TEXT NOT NULL,
      created_by_id TEXT,
      created_at TEXT NOT NULL,
      validated_at TEXT,
      page_signature_sha256 TEXT NOT NULL CHECK(length(page_signature_sha256) = 64),
      UNIQUE(page_definition_id, revision_no)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_page_definition_revision_current
      ON page_definition_revisions(page_definition_id)
      WHERE lifecycle = 'current';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_page_signature_current
      ON page_definition_revisions(business_version_id, page_signature_sha256)
      WHERE lifecycle = 'current';

    CREATE TABLE IF NOT EXISTS semantic_business_modules (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      module_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE(business_version_id, module_key)
    );

    CREATE TABLE IF NOT EXISTS semantic_business_module_revisions (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      business_module_id TEXT NOT NULL REFERENCES semantic_business_modules(id) ON DELETE RESTRICT,
      revision_no INTEGER NOT NULL CHECK(revision_no > 0),
      lifecycle TEXT NOT NULL ${REVISION_LIFECYCLE},
      schema_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
      validation_status TEXT NOT NULL ${VALIDATION_STATUS},
      validation_errors_json TEXT,
      supersedes_revision_id TEXT REFERENCES semantic_business_module_revisions(id) ON DELETE RESTRICT,
      source_asset_id TEXT,
      source_revision_id TEXT,
      change_reason TEXT NOT NULL,
      created_by_type TEXT NOT NULL,
      created_by_id TEXT,
      created_at TEXT NOT NULL,
      validated_at TEXT,
      UNIQUE(business_module_id, revision_no)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_semantic_business_module_revision_current
      ON semantic_business_module_revisions(business_module_id)
      WHERE lifecycle = 'current';

    CREATE TABLE IF NOT EXISTS semantic_functional_modules (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      business_module_id TEXT NOT NULL REFERENCES semantic_business_modules(id) ON DELETE RESTRICT,
      module_key TEXT NOT NULL,
      primary_page_definition_id TEXT NOT NULL REFERENCES page_definitions(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE(business_version_id, module_key)
    );

    CREATE TABLE IF NOT EXISTS semantic_functional_module_revisions (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      functional_module_id TEXT NOT NULL REFERENCES semantic_functional_modules(id) ON DELETE RESTRICT,
      revision_no INTEGER NOT NULL CHECK(revision_no > 0),
      lifecycle TEXT NOT NULL ${REVISION_LIFECYCLE},
      schema_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
      validation_status TEXT NOT NULL ${VALIDATION_STATUS},
      validation_errors_json TEXT,
      supersedes_revision_id TEXT REFERENCES semantic_functional_module_revisions(id) ON DELETE RESTRICT,
      source_asset_id TEXT,
      source_revision_id TEXT,
      change_reason TEXT NOT NULL,
      created_by_type TEXT NOT NULL,
      created_by_id TEXT,
      created_at TEXT NOT NULL,
      validated_at TEXT,
      UNIQUE(functional_module_id, revision_no)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_semantic_functional_module_revision_current
      ON semantic_functional_module_revisions(functional_module_id)
      WHERE lifecycle = 'current';

    CREATE TABLE IF NOT EXISTS functional_scripts (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      functional_module_id TEXT NOT NULL REFERENCES semantic_functional_modules(id) ON DELETE RESTRICT,
      script_key TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE(business_version_id, script_key)
    );

    CREATE TABLE IF NOT EXISTS functional_script_revisions (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      functional_script_id TEXT NOT NULL REFERENCES functional_scripts(id) ON DELETE RESTRICT,
      revision_no INTEGER NOT NULL CHECK(revision_no > 0),
      lifecycle TEXT NOT NULL ${REVISION_LIFECYCLE},
      schema_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
      validation_status TEXT NOT NULL ${VALIDATION_STATUS},
      validation_errors_json TEXT,
      supersedes_revision_id TEXT REFERENCES functional_script_revisions(id) ON DELETE RESTRICT,
      source_asset_id TEXT,
      source_revision_id TEXT,
      change_reason TEXT NOT NULL,
      created_by_type TEXT NOT NULL,
      created_by_id TEXT,
      created_at TEXT NOT NULL,
      validated_at TEXT,
      readiness_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK(readiness_status IN ('unverified','verified','stale')),
      requirement_revision_id TEXT,
      primary_page_revision_id TEXT REFERENCES page_definition_revisions(id) ON DELETE RESTRICT,
      change_kind TEXT NOT NULL DEFAULT 'generated'
        CHECK(change_kind IN ('generated','human_edit','ai_repair','migration','copy')),
      UNIQUE(functional_script_id, revision_no)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_functional_script_revision_current
      ON functional_script_revisions(functional_script_id)
      WHERE lifecycle = 'current';

    CREATE TABLE IF NOT EXISTS semantic_test_scenarios (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      scenario_key TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE(business_version_id, scenario_key)
    );

    CREATE TABLE IF NOT EXISTS semantic_test_scenario_revisions (
      id TEXT PRIMARY KEY,
      business_version_id TEXT NOT NULL REFERENCES business_versions(id) ON DELETE RESTRICT,
      test_scenario_id TEXT NOT NULL REFERENCES semantic_test_scenarios(id) ON DELETE RESTRICT,
      revision_no INTEGER NOT NULL CHECK(revision_no > 0),
      lifecycle TEXT NOT NULL ${REVISION_LIFECYCLE},
      schema_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
      validation_status TEXT NOT NULL ${VALIDATION_STATUS},
      validation_errors_json TEXT,
      supersedes_revision_id TEXT REFERENCES semantic_test_scenario_revisions(id) ON DELETE RESTRICT,
      source_asset_id TEXT,
      source_revision_id TEXT,
      change_reason TEXT NOT NULL,
      created_by_type TEXT NOT NULL,
      created_by_id TEXT,
      created_at TEXT NOT NULL,
      validated_at TEXT,
      readiness_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK(readiness_status IN ('unverified','verified','stale')),
      UNIQUE(test_scenario_id, revision_no)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_semantic_test_scenario_revision_current
      ON semantic_test_scenario_revisions(test_scenario_id)
      WHERE lifecycle = 'current';

    CREATE TRIGGER IF NOT EXISTS trg_deployment_profile_revision_immutable
      BEFORE UPDATE OF payload_json, content_sha256 ON deployment_profile_revisions
      BEGIN SELECT RAISE(ABORT, 'revision payload is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS trg_page_definition_revision_immutable
      BEFORE UPDATE OF payload_json, content_sha256 ON page_definition_revisions
      BEGIN SELECT RAISE(ABORT, 'revision payload is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS trg_semantic_business_module_revision_immutable
      BEFORE UPDATE OF payload_json, content_sha256 ON semantic_business_module_revisions
      BEGIN SELECT RAISE(ABORT, 'revision payload is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS trg_semantic_functional_module_revision_immutable
      BEFORE UPDATE OF payload_json, content_sha256 ON semantic_functional_module_revisions
      BEGIN SELECT RAISE(ABORT, 'revision payload is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS trg_functional_script_revision_immutable
      BEFORE UPDATE OF payload_json, content_sha256 ON functional_script_revisions
      BEGIN SELECT RAISE(ABORT, 'revision payload is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS trg_semantic_test_scenario_revision_immutable
      BEFORE UPDATE OF payload_json, content_sha256 ON semantic_test_scenario_revisions
      BEGIN SELECT RAISE(ABORT, 'revision payload is immutable'); END;
  `);
}

export function down(db: MigrationDatabase): void {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_semantic_test_scenario_revision_immutable;
    DROP TRIGGER IF EXISTS trg_functional_script_revision_immutable;
    DROP TRIGGER IF EXISTS trg_semantic_functional_module_revision_immutable;
    DROP TRIGGER IF EXISTS trg_semantic_business_module_revision_immutable;
    DROP TRIGGER IF EXISTS trg_page_definition_revision_immutable;
    DROP TRIGGER IF EXISTS trg_deployment_profile_revision_immutable;
    DROP TABLE IF EXISTS semantic_test_scenario_revisions;
    DROP TABLE IF EXISTS semantic_test_scenarios;
    DROP TABLE IF EXISTS functional_script_revisions;
    DROP TABLE IF EXISTS functional_scripts;
    DROP TABLE IF EXISTS semantic_functional_module_revisions;
    DROP TABLE IF EXISTS semantic_functional_modules;
    DROP TABLE IF EXISTS semantic_business_module_revisions;
    DROP TABLE IF EXISTS semantic_business_modules;
    DROP TABLE IF EXISTS page_definition_revisions;
    DROP TABLE IF EXISTS page_definitions;
    DROP TABLE IF EXISTS version_variable_definitions;
    DROP TABLE IF EXISTS version_prd_documents;
    DROP TABLE IF EXISTS version_deployment_bindings;
    DROP TABLE IF EXISTS business_versions;
    DROP TABLE IF EXISTS deployment_profile_revisions;
    DROP TABLE IF EXISTS deployment_profiles;
  `);
}
