import type { BusinessVersionRepository } from './business-version-repository.js';
import type { SupportedDatabase } from './semantic-repository-utils.js';
import type {
  AuthoringSnapshotV1,
  RunSnapshotV1,
  SemanticAssetType,
  SemanticEventV1,
  SemanticRevisionHistoryV1,
  SemanticRevisionV1,
  SemanticWorkspaceV1,
  WorkspacePrdDocumentV1,
  WorkspaceValidationV1,
} from '../../types/semantic-control.js';

interface StatementLike {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface DatabaseLike {
  prepare(sql: string): StatementLike;
}

interface AssetRevisionConfig {
  assetTable: string;
  revisionTable: string;
  revisionAssetColumn: string;
}

const ASSET_REVISION_CONFIG: Record<SemanticAssetType, AssetRevisionConfig> = {
  page_definition: {
    assetTable: 'page_definitions',
    revisionTable: 'page_definition_revisions',
    revisionAssetColumn: 'page_definition_id',
  },
  business_module: {
    assetTable: 'semantic_business_modules',
    revisionTable: 'semantic_business_module_revisions',
    revisionAssetColumn: 'business_module_id',
  },
  functional_module: {
    assetTable: 'semantic_functional_modules',
    revisionTable: 'semantic_functional_module_revisions',
    revisionAssetColumn: 'functional_module_id',
  },
  functional_script: {
    assetTable: 'functional_scripts',
    revisionTable: 'functional_script_revisions',
    revisionAssetColumn: 'functional_script_id',
  },
  test_scenario: {
    assetTable: 'semantic_test_scenarios',
    revisionTable: 'semantic_test_scenario_revisions',
    revisionAssetColumn: 'test_scenario_id',
  },
  module_requirement: {
    assetTable: 'semantic_functional_modules',
    revisionTable: 'module_requirement_revisions',
    revisionAssetColumn: 'functional_module_id',
  },
  page_baseline: {
    assetTable: 'page_baseline_variants',
    revisionTable: 'page_baseline_revisions',
    revisionAssetColumn: 'page_baseline_variant_id',
  },
};

type DbRow = Record<string, unknown>;

export class SemanticQueryRepository {
  private readonly db: DatabaseLike;

  constructor(
    database: SupportedDatabase,
    private readonly versions: BusinessVersionRepository
  ) {
    this.db = database as unknown as DatabaseLike;
  }

  getWorkspace(versionId: string): SemanticWorkspaceV1 | null {
    const version = this.versions.findDetail(versionId);
    if (!version) return null;
    const graph = this.versions.getAssetGraph(versionId);
    const prdDocuments = this.db
      .prepare(
        `SELECT id, document_key, format, raw_content, content_sha256, parsed_json,
                source_uri, created_at
         FROM version_prd_documents
         WHERE business_version_id = ? AND is_current = 1
         ORDER BY document_key`
      )
      .all(versionId)
      .map(mapPrdDocument);
    const validations = this.db
      .prepare(
        `SELECT id, deployment_revision_id, asset_graph_sha256, verification_scope_sha256,
                verification_scope_json, status, validated_at, reason_json, created_at
         FROM business_version_validations
         WHERE business_version_id = ? AND is_current = 1
         ORDER BY created_at DESC`
      )
      .all(versionId)
      .map(mapWorkspaceValidation);
    return {
      schema: 'nebula.ai-e2e.workspace/1.0',
      version,
      prdDocuments,
      ...graph,
      validations,
    };
  }

  getDefaultDeployment(versionId: string): {
    revisionId: string;
    environment: 'local' | 'test' | 'staging' | 'production';
    payload: Record<string, unknown>;
  } | null {
    const row = this.db.prepare(
      `SELECT r.id, r.payload_json
       FROM version_deployment_bindings b
       JOIN deployment_profile_revisions r ON r.id = b.deployment_revision_id
       WHERE b.business_version_id = ? AND b.is_default = 1
       LIMIT 1`
    ).get(versionId) as { id: string; payload_json: string } | undefined;
    if (!row) return null;
    const payload = parseObject(row.payload_json);
    const environment = String(payload.environment);
    if (!['local', 'test', 'staging', 'production'].includes(environment)) {
      throw new Error('默认部署修订的 environment 无效');
    }
    return {
      revisionId: row.id,
      environment: environment as 'local' | 'test' | 'staging' | 'production',
      payload,
    };
  }

  getRevisionHistory(
    assetType: SemanticAssetType,
    assetId: string
  ): SemanticRevisionHistoryV1 | null {
    const config = ASSET_REVISION_CONFIG[assetType];
    const asset = this.db.prepare(`SELECT id FROM ${config.assetTable} WHERE id = ?`).get(assetId);
    if (!asset) return null;
    const revisions = this.db
      .prepare(
        `SELECT * FROM ${config.revisionTable}
         WHERE ${config.revisionAssetColumn} = ?
         ORDER BY revision_no DESC`
      )
      .all(assetId)
      .map((row) => this.mapRevision(assetType, assetId, row as DbRow));
    return {
      schema: 'nebula.ai-e2e.asset-revisions/1.0',
      assetType,
      assetId,
      ...(revisions.find((revision) => revision.lifecycle === 'current')?.id
        ? { currentRevisionId: revisions.find((revision) => revision.lifecycle === 'current')?.id }
        : {}),
      revisions,
    };
  }

  getRevision(
    assetType: SemanticAssetType,
    assetId: string,
    revisionId: string
  ): SemanticRevisionV1 | null {
    return (
      this.getRevisionHistory(assetType, assetId)?.revisions.find(
        (revision) => revision.id === revisionId
      ) ?? null
    );
  }

  getAuthoringSnapshot(jobId: string): AuthoringSnapshotV1 | null {
    const row = this.db.prepare('SELECT * FROM authoring_jobs WHERE id = ?').get(jobId) as
      | DbRow
      | undefined;
    if (!row) return null;
    const job = mapDatabaseRow(row);
    const tasks = this.selectRows(
      'SELECT * FROM authoring_tasks WHERE job_id = ? ORDER BY created_at, task_key',
      jobId
    );
    const attempts = this.selectRows(
      'SELECT * FROM authoring_attempts WHERE job_id = ? ORDER BY started_at, attempt_no',
      jobId
    );
    const decisions = this.getDecisions('authoring', jobId);
    const contextThreads = this.selectRows(
      `SELECT * FROM authoring_context_threads
       WHERE job_id = ? ORDER BY created_at`,
      jobId
    );
    const amendmentRows = this.selectRows(
      `SELECT * FROM authoring_amendments
       WHERE job_id = ? ORDER BY created_at`,
      jobId
    );
    const amendments = amendmentRows.map((amendment) => ({
      ...amendment,
      changes: this.selectRows(
        `SELECT * FROM authoring_amendment_changes
         WHERE amendment_id = ? ORDER BY sequence`,
        String(amendment.id)
      ),
    }));
    return {
      schema: 'nebula.ai-e2e.authoring-snapshot/1.0',
      job,
      tasks,
      attempts,
      decisions,
      contextThreads,
      amendments,
      ...this.getLinkedControlState('authoring', jobId, row),
      seq: Number(row.next_event_seq) - 1,
      stateVersion: Number(row.state_version),
    };
  }

  getRunSnapshot(runId: string): RunSnapshotV1 | null {
    const row = this.db.prepare('SELECT * FROM test_runs WHERE id = ?').get(runId) as
      | DbRow
      | undefined;
    if (!row) return null;
    const plan = this.db.prepare('SELECT * FROM run_plans WHERE run_id = ?').get(runId) as
      | DbRow
      | undefined;
    return {
      schema: 'nebula.ai-e2e.run-snapshot/1.0',
      run: mapDatabaseRow(row),
      ...(plan ? { plan: mapDatabaseRow(plan) } : {}),
      amendments: this.selectRows(
        'SELECT * FROM run_plan_amendments WHERE run_id = ? ORDER BY sequence',
        runId
      ),
      todos: this.selectRows('SELECT * FROM run_todos WHERE run_id = ? ORDER BY rowid', runId),
      dependencies: this.selectRows(
        'SELECT * FROM run_todo_dependencies WHERE run_id = ? ORDER BY rowid',
        runId
      ),
      pageTasks: this.selectRows(
        'SELECT * FROM page_tasks WHERE run_id = ? ORDER BY task_no',
        runId
      ),
      attempts: this.selectRows(
        'SELECT * FROM execution_attempts WHERE run_id = ? ORDER BY started_at, attempt_no',
        runId
      ),
      decisions: this.getDecisions('run', runId),
      evidence: this.getEvidence('run', runId),
      ...this.getLinkedControlState('run', runId, row),
      seq: Number(row.next_event_seq) - 1,
      stateVersion: Number(row.state_version),
    };
  }

  listAuthoringEvents(jobId: string, afterSeq = 0, limit = 100): SemanticEventV1[] | null {
    if (!this.db.prepare('SELECT id FROM authoring_jobs WHERE id = ?').get(jobId)) return null;
    return this.mapEvents(
      this.db
        .prepare(
          `SELECT * FROM authoring_events
           WHERE job_id = ? AND seq > ? ORDER BY seq LIMIT ?`
        )
        .all(jobId, afterSeq, limit)
    );
  }

  listRunEvents(runId: string, afterSeq = 0, limit = 100): SemanticEventV1[] | null {
    if (!this.db.prepare('SELECT id FROM test_runs WHERE id = ?').get(runId)) return null;
    return this.mapEvents(
      this.db
        .prepare('SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?')
        .all(runId, afterSeq, limit)
    );
  }

  private mapRevision(
    assetType: SemanticAssetType,
    assetId: string,
    row: DbRow
  ): SemanticRevisionV1 {
    const verifications = this.selectRows(
      `SELECT * FROM asset_revision_verifications
       WHERE asset_revision_id = ? ORDER BY created_at DESC`,
      String(row.id)
    );
    const dependencies = this.selectRows(
      `SELECT * FROM asset_revision_dependencies
       WHERE from_revision_id = ? ORDER BY relation, source_pointer`,
      String(row.id)
    );
    return {
      id: String(row.id),
      assetType,
      assetId,
      revisionNo: Number(row.revision_no),
      lifecycle: row.lifecycle as SemanticRevisionV1['lifecycle'],
      schemaId: String(row.schema_id),
      payload: parseObject(row.payload_json),
      contentSha256: String(row.content_sha256),
      validationStatus: row.validation_status as SemanticRevisionV1['validationStatus'],
      ...(row.validation_errors_json
        ? { validationErrors: parseArray(row.validation_errors_json) }
        : {}),
      ...(row.readiness_status
        ? { readinessStatus: row.readiness_status as SemanticRevisionV1['readinessStatus'] }
        : {}),
      ...(row.supersedes_revision_id
        ? { supersedesRevisionId: String(row.supersedes_revision_id) }
        : {}),
      ...(row.source_asset_id ? { sourceAssetId: String(row.source_asset_id) } : {}),
      ...(row.source_revision_id ? { sourceRevisionId: String(row.source_revision_id) } : {}),
      changeReason: String(row.change_reason),
      createdByType: String(row.created_by_type),
      ...(row.created_by_id ? { createdById: String(row.created_by_id) } : {}),
      createdAt: String(row.created_at),
      ...(row.validated_at ? { validatedAt: String(row.validated_at) } : {}),
      verifications,
      dependencies,
    };
  }

  private getDecisions(contextType: 'run' | 'authoring', contextId: string) {
    return this.selectRows(
      `SELECT requests.*, answers.id AS answer_id, answers.answer_key,
              answers.custom_answer, answers.reason AS answer_reason,
              answers.answered_by_type, answers.answered_by_id,
              answers.created_at AS answer_created_at
       FROM decision_requests AS requests
       LEFT JOIN decision_answers AS answers ON answers.decision_request_id = requests.id
       WHERE requests.context_type = ? AND requests.context_id = ?
       ORDER BY requests.created_at`,
      contextType,
      contextId
    );
  }

  private getEvidence(contextType: 'run' | 'authoring', contextId: string) {
    const manifests = this.selectRows(
      `SELECT * FROM evidence_manifests
       WHERE context_type = ? AND context_id = ? ORDER BY created_at`,
      contextType,
      contextId
    );
    return manifests.map((manifest) => ({
      ...manifest,
      items: this.selectRows(
        'SELECT * FROM evidence_items WHERE manifest_id = ? ORDER BY captured_at',
        String(manifest.id)
      ),
    }));
  }

  private getLinkedControlState(
    contextType: 'run' | 'authoring',
    contextId: string,
    rootRow: DbRow
  ) {
    const browserJob = rootRow.browser_job_id
      ? (this.db.prepare('SELECT * FROM browser_jobs WHERE id = ?').get(rootRow.browser_job_id) as
          | DbRow
          | undefined)
      : undefined;
    const policyEvaluation = rootRow.current_policy_evaluation_id
      ? (this.db
          .prepare('SELECT * FROM side_effect_policy_evaluations WHERE id = ?')
          .get(rootRow.current_policy_evaluation_id) as DbRow | undefined)
      : (this.db
          .prepare(
            `SELECT * FROM side_effect_policy_evaluations
             WHERE context_type = ? AND context_id = ? ORDER BY created_at DESC LIMIT 1`
          )
          .get(contextType, contextId) as DbRow | undefined);
    const activeApprovalGrant = rootRow.active_approval_grant_id
      ? (this.db
          .prepare('SELECT * FROM side_effect_approval_grants WHERE id = ?')
          .get(rootRow.active_approval_grant_id) as DbRow | undefined)
      : undefined;
    return {
      ...(browserJob ? { browserJob: mapDatabaseRow(browserJob) } : {}),
      ...(policyEvaluation ? { policyEvaluation: mapDatabaseRow(policyEvaluation) } : {}),
      ...(activeApprovalGrant ? { activeApprovalGrant: mapDatabaseRow(activeApprovalGrant) } : {}),
    };
  }

  private selectRows(sql: string, ...params: unknown[]): Array<Record<string, unknown>> {
    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => mapDatabaseRow(row as DbRow));
  }

  private mapEvents(rows: unknown[]): SemanticEventV1[] {
    return rows.map((value) => {
      const row = value as DbRow;
      return {
        id: String(row.id),
        seq: Number(row.seq),
        schemaVersion: 1,
        type: String(row.type),
        entityType: String(row.entity_type),
        entityId: String(row.entity_id),
        ...(row.state_version ? { stateVersion: Number(row.state_version) } : {}),
        ...(row.correlation_id ? { correlationId: String(row.correlation_id) } : {}),
        ...(row.causation_id ? { causationId: String(row.causation_id) } : {}),
        payload: parseObject(row.payload_json),
        occurredAt: String(row.occurred_at),
      };
    });
  }
}

function mapPrdDocument(value: unknown): WorkspacePrdDocumentV1 {
  const row = value as DbRow;
  return {
    id: String(row.id),
    documentKey: String(row.document_key),
    format: row.format as WorkspacePrdDocumentV1['format'],
    rawContent: String(row.raw_content),
    contentSha256: String(row.content_sha256),
    ...(row.parsed_json ? { parsed: parseObject(row.parsed_json) } : {}),
    ...(row.source_uri ? { sourceUri: String(row.source_uri) } : {}),
    createdAt: String(row.created_at),
  };
}

function mapWorkspaceValidation(value: unknown): WorkspaceValidationV1 {
  const row = value as DbRow;
  return {
    id: String(row.id),
    deploymentRevisionId: String(row.deployment_revision_id),
    assetGraphSha256: String(row.asset_graph_sha256),
    verificationScopeSha256: String(row.verification_scope_sha256),
    verificationScope: parseObject(row.verification_scope_json),
    status: row.status as WorkspaceValidationV1['status'],
    ...(row.validated_at ? { validatedAt: String(row.validated_at) } : {}),
    ...(row.reason_json ? { reason: parseObject(row.reason_json) } : {}),
    createdAt: String(row.created_at),
  };
}

function mapDatabaseRow(row: DbRow): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (key.endsWith('_json_redacted')) {
        return [toCamelCase(key.slice(0, -14) + '_redacted'), parseJson(value)];
      }
      if (key.endsWith('_json')) return [toCamelCase(key.slice(0, -5)), parseJson(value)];
      if (key.startsWith('is_') && (typeof value === 'number' || typeof value === 'bigint')) {
        return [toCamelCase(key), Number(value) === 1];
      }
      return [toCamelCase(key), value];
    })
  );
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseArray(value: unknown): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}
