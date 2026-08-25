import { randomUUID } from 'node:crypto';
import {
  assertNoInlineSecrets,
  collectArtifactObjectIds,
  inImmediateTransaction,
  requireSha256,
  sha256,
  stableStringify,
  type DatabaseLike,
  type SupportedDatabase,
} from './semantic-repository-utils.js';
import { validateFunctionalScriptV1 } from '../../validation/functional-script-validator.js';

export type SemanticAssetType =
  | 'page_definition'
  | 'business_module'
  | 'functional_module'
  | 'functional_script'
  | 'test_scenario'
  | 'page_baseline'
  | 'module_requirement';

export type SemanticActorType = 'user' | 'main_agent' | 'child_agent' | 'system' | 'migration';

export interface CreateSemanticRevisionParams {
  id?: string;
  assetType: SemanticAssetType;
  assetId: string;
  businessVersionId: string;
  schemaId: string;
  payload: unknown;
  validationStatus?: 'pending' | 'valid' | 'invalid';
  validationErrors?: unknown;
  changeReason: string;
  createdByType: SemanticActorType;
  createdById?: string;
  sourceAssetId?: string;
  sourceRevisionId?: string;
  supersedesRevisionId?: string;
  pageSignatureSha256?: string;
  requirementRevisionId?: string;
  primaryPageRevisionId?: string;
  changeKind?: 'generated' | 'human_edit' | 'ai_repair' | 'migration' | 'copy';
}

export interface SemanticRevisionRecord {
  id: string;
  assetType: SemanticAssetType;
  assetId: string;
  businessVersionId: string;
  revisionNo: number;
  lifecycle: 'draft' | 'current' | 'superseded' | 'rejected';
  contentSha256: string;
  validationStatus: 'pending' | 'valid' | 'invalid';
}

export interface SemanticDependencyEdge {
  toAssetType: string;
  toAssetId: string;
  toRevisionId?: string;
  relation:
    | 'page_scope'
    | 'requirement_source'
    | 'scenario_call'
    | 'output_binding'
    | 'assertion_input'
    | 'baseline_target'
    | 'decision_source';
  sourcePointer: string;
}

export interface ActivateSemanticRevisionParams {
  assetType: SemanticAssetType;
  revisionId: string;
  verificationScopeSha256?: string;
  dependencyClosureSha256?: string;
  dependencies: readonly SemanticDependencyEdge[];
  authoringJobId?: string;
  correlationId?: string;
}

export interface ActivateSemanticRevisionsResult {
  activatedRevisionIds: string[];
  unchangedRevisionIds: string[];
}

export interface RecordAssetVerificationParams {
  id?: string;
  businessVersionId: string;
  assetType: 'functional_script' | 'test_scenario';
  assetId: string;
  assetRevisionId: string;
  deploymentRevisionId: string;
  verificationScope: unknown;
  dependencyClosureSha256: string;
  status: 'verified' | 'stale' | 'revoked';
  verificationRunId?: string;
  authoringJobId?: string;
  evidenceManifestId?: string;
  staleReason?: unknown;
}

export interface RecordBusinessVersionValidationParams {
  id?: string;
  businessVersionId: string;
  deploymentRevisionId: string;
  assetGraphSha256: string;
  verificationScope: unknown;
  status: 'validating' | 'valid' | 'needs_recheck' | 'invalid';
  authoringJobId?: string;
  reason?: unknown;
}

interface RevisionSpec {
  table: string;
  assetTable: string;
  assetColumn: string;
  executable: boolean;
}

const REVISION_SPECS: Record<SemanticAssetType, RevisionSpec> = {
  page_definition: {
    table: 'page_definition_revisions',
    assetTable: 'page_definitions',
    assetColumn: 'page_definition_id',
    executable: false,
  },
  business_module: {
    table: 'semantic_business_module_revisions',
    assetTable: 'semantic_business_modules',
    assetColumn: 'business_module_id',
    executable: false,
  },
  functional_module: {
    table: 'semantic_functional_module_revisions',
    assetTable: 'semantic_functional_modules',
    assetColumn: 'functional_module_id',
    executable: false,
  },
  functional_script: {
    table: 'functional_script_revisions',
    assetTable: 'functional_scripts',
    assetColumn: 'functional_script_id',
    executable: true,
  },
  test_scenario: {
    table: 'semantic_test_scenario_revisions',
    assetTable: 'semantic_test_scenarios',
    assetColumn: 'test_scenario_id',
    executable: true,
  },
  page_baseline: {
    table: 'page_baseline_revisions',
    assetTable: 'page_baseline_variants',
    assetColumn: 'page_baseline_variant_id',
    executable: false,
  },
  module_requirement: {
    table: 'module_requirement_revisions',
    assetTable: 'semantic_functional_modules',
    assetColumn: 'functional_module_id',
    executable: false,
  },
};

export class SemanticAssetRepository {
  private readonly db: DatabaseLike;

  constructor(db: SupportedDatabase) {
    this.db = db as unknown as DatabaseLike;
  }

  createRevision(params: CreateSemanticRevisionParams): SemanticRevisionRecord {
    assertNoInlineSecrets(params.payload);
    if (params.assetType === 'functional_script' && params.validationStatus === 'valid') {
      validateFunctionalScriptV1(params.payload);
    }
    if (params.validationErrors !== undefined) assertNoInlineSecrets(params.validationErrors);
    if (params.assetType === 'page_definition') {
      if (!params.pageSignatureSha256) throw new Error('pageSignatureSha256 is required');
      requireSha256(params.pageSignatureSha256, 'pageSignatureSha256');
    }
    const spec = REVISION_SPECS[params.assetType];
    return inImmediateTransaction(this.db, () => {
      this.requireWritableVersion(params.businessVersionId);
      const asset = this.db
        .prepare(`SELECT business_version_id FROM ${spec.assetTable} WHERE id = ?`)
        .get(params.assetId) as { business_version_id: string } | undefined;
      if (!asset || asset.business_version_id !== params.businessVersionId) {
        throw new Error(`${params.assetType} does not belong to the business version`);
      }
      const payloadJson = stableStringify(params.payload);
      const contentSha256 = sha256(payloadJson);
      if (params.id) {
        const existing = this.db
          .prepare(
            `SELECT business_version_id, ${spec.assetColumn} AS asset_id, revision_no,
                    lifecycle, content_sha256, validation_status
             FROM ${spec.table} WHERE id = ?`
          )
          .get(params.id) as Record<string, unknown> | undefined;
        if (existing) {
          if (
            existing.business_version_id !== params.businessVersionId ||
            existing.asset_id !== params.assetId ||
            existing.content_sha256 !== contentSha256
          ) {
            throw new Error('Semantic revision id was reused with different content');
          }
          return {
            id: params.id,
            assetType: params.assetType,
            assetId: params.assetId,
            businessVersionId: params.businessVersionId,
            revisionNo: Number(existing.revision_no),
            lifecycle: existing.lifecycle as SemanticRevisionRecord['lifecycle'],
            contentSha256,
            validationStatus: existing.validation_status as SemanticRevisionRecord['validationStatus'],
          };
        }
      }
      if (params.supersedesRevisionId) {
        const superseded = this.db
          .prepare(`SELECT ${spec.assetColumn} AS asset_id FROM ${spec.table} WHERE id = ?`)
          .get(params.supersedesRevisionId) as { asset_id: string } | undefined;
        if (!superseded || superseded.asset_id !== params.assetId) {
          throw new Error('supersedesRevisionId does not belong to the asset');
        }
      }
      const next = this.db
        .prepare(
          `SELECT COALESCE(MAX(revision_no), 0) + 1 AS revision_no
           FROM ${spec.table} WHERE ${spec.assetColumn} = ?`
        )
        .get(params.assetId) as { revision_no: number | bigint };
      const id = params.id ?? randomUUID();
      const revisionNo = Number(next.revision_no);
      const validationStatus = params.validationStatus ?? 'pending';
      const now = new Date().toISOString();
      const columns = [
        'id',
        'business_version_id',
        spec.assetColumn,
        'revision_no',
        'lifecycle',
        'schema_id',
        'payload_json',
        'content_sha256',
        'validation_status',
        'validation_errors_json',
        'supersedes_revision_id',
        'source_asset_id',
        'source_revision_id',
        'change_reason',
        'created_by_type',
        'created_by_id',
        'created_at',
        'validated_at',
      ];
      const values: unknown[] = [
        id,
        params.businessVersionId,
        params.assetId,
        revisionNo,
        'draft',
        params.schemaId,
        payloadJson,
        contentSha256,
        validationStatus,
        params.validationErrors === undefined ? null : stableStringify(params.validationErrors),
        params.supersedesRevisionId ?? null,
        params.sourceAssetId ?? null,
        params.sourceRevisionId ?? null,
        params.changeReason,
        params.createdByType,
        params.createdById ?? null,
        now,
        validationStatus === 'pending' ? null : now,
      ];
      if (params.assetType === 'page_definition') {
        columns.push('page_signature_sha256');
        values.push(params.pageSignatureSha256);
      } else if (params.assetType === 'functional_script') {
        columns.push(
          'readiness_status',
          'requirement_revision_id',
          'primary_page_revision_id',
          'change_kind'
        );
        values.push(
          'unverified',
          params.requirementRevisionId ?? null,
          params.primaryPageRevisionId ?? null,
          params.changeKind ?? 'generated'
        );
      } else if (params.assetType === 'test_scenario') {
        columns.push('readiness_status');
        values.push('unverified');
      }
      this.db
        .prepare(
          `INSERT INTO ${spec.table} (${columns.join(', ')})
           VALUES (${columns.map(() => '?').join(', ')})`
        )
        .run(...values);
      if (params.assetType === 'page_baseline') {
        this.incrementArtifactReferences(collectArtifactObjectIds(params.payload));
      }
      return {
        id,
        assetType: params.assetType,
        assetId: params.assetId,
        businessVersionId: params.businessVersionId,
        revisionNo,
        lifecycle: 'draft',
        contentSha256: sha256(payloadJson),
        validationStatus,
      };
    });
  }

  recordVerification(params: RecordAssetVerificationParams): { id: string; created: boolean } {
    assertNoInlineSecrets(params.verificationScope);
    if (params.staleReason !== undefined) assertNoInlineSecrets(params.staleReason);
    requireSha256(params.dependencyClosureSha256, 'dependencyClosureSha256');
    const scopeJson = stableStringify(params.verificationScope);
    const scopeSha256 = sha256(scopeJson);
    const id = params.id ?? randomUUID();
    return inImmediateTransaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT * FROM asset_revision_verifications WHERE id = ?')
        .get(id) as Record<string, unknown> | undefined;
      if (existing) {
        if (
          existing.asset_revision_id !== params.assetRevisionId ||
          existing.verification_scope_sha256 !== scopeSha256 ||
          existing.dependency_closure_sha256 !== params.dependencyClosureSha256 ||
          existing.status !== params.status
        ) {
          throw new Error('Verification id was already used with different content');
        }
        return { id, created: false };
      }
      const spec = REVISION_SPECS[params.assetType];
      const revision = this.db
        .prepare(
          `SELECT business_version_id, ${spec.assetColumn} AS asset_id
           FROM ${spec.table} WHERE id = ?`
        )
        .get(params.assetRevisionId) as
        | { business_version_id: string; asset_id: string }
        | undefined;
      if (
        !revision ||
        revision.business_version_id !== params.businessVersionId ||
        revision.asset_id !== params.assetId
      ) {
        throw new Error('Verification target does not match the executable revision');
      }
      if (
        !this.db
          .prepare(
            `SELECT 1 FROM version_deployment_bindings
             WHERE business_version_id = ? AND deployment_revision_id = ?`
          )
          .get(params.businessVersionId, params.deploymentRevisionId)
      ) {
        throw new Error('Verification deployment revision is not bound to the business version');
      }
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE asset_revision_verifications
           SET is_current = 0, status = CASE WHEN status = 'verified' THEN 'stale' ELSE status END,
               stale_at = CASE WHEN status = 'verified' THEN ? ELSE stale_at END,
               stale_reason_json = CASE WHEN status = 'verified' THEN ? ELSE stale_reason_json END
           WHERE asset_revision_id = ? AND verification_scope_sha256 = ? AND is_current = 1`
        )
        .run(
          now,
          stableStringify({ reason: 'superseded_by_new_verification' }),
          params.assetRevisionId,
          scopeSha256
        );
      this.db
        .prepare(
          `INSERT INTO asset_revision_verifications
            (id, business_version_id, asset_type, asset_id, asset_revision_id,
             deployment_revision_id, verification_scope_sha256, verification_scope_json,
             dependency_closure_sha256, status, is_current, verification_run_id,
             authoring_job_id, evidence_manifest_id, verified_at, stale_at,
             stale_reason_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.businessVersionId,
          params.assetType,
          params.assetId,
          params.assetRevisionId,
          params.deploymentRevisionId,
          scopeSha256,
          scopeJson,
          params.dependencyClosureSha256,
          params.status,
          params.verificationRunId ?? null,
          params.authoringJobId ?? null,
          params.evidenceManifestId ?? null,
          params.status === 'verified' ? now : null,
          params.status === 'stale' ? now : null,
          params.staleReason === undefined ? null : stableStringify(params.staleReason),
          now
        );
      return { id, created: true };
    });
  }

  activateRevision(params: ActivateSemanticRevisionParams): { activated: boolean } {
    const result = this.activateRevisions([params]);
    return { activated: result.activatedRevisionIds.includes(params.revisionId) };
  }

  activateRevisions(
    paramsList: readonly ActivateSemanticRevisionParams[]
  ): ActivateSemanticRevisionsResult {
    if (paramsList.length === 0) throw new Error('At least one revision is required');
    const targets = new Set<string>();
    for (const params of paramsList) {
      const targetKey = `${params.assetType}:${params.revisionId}`;
      if (targets.has(targetKey)) throw new Error('Duplicate revision activation target');
      targets.add(targetKey);
      const spec = REVISION_SPECS[params.assetType];
      if (spec.executable) {
        if (!params.verificationScopeSha256 || !params.dependencyClosureSha256) {
          throw new Error(
            'Executable activation requires exact verification scope and dependency closure'
          );
        }
        requireSha256(params.verificationScopeSha256, 'verificationScopeSha256');
        requireSha256(params.dependencyClosureSha256, 'dependencyClosureSha256');
      }
    }
    return inImmediateTransaction(this.db, () => {
      const prepared = paramsList.map((params) => {
        const spec = REVISION_SPECS[params.assetType];
        const revision = this.db
          .prepare(
            `SELECT id, business_version_id, ${spec.assetColumn} AS asset_id,
                    lifecycle, validation_status
             FROM ${spec.table} WHERE id = ?`
          )
          .get(params.revisionId) as
          | {
              id: string;
              business_version_id: string;
              asset_id: string;
              lifecycle: string;
              validation_status: string;
            }
          | undefined;
        if (!revision) throw new Error('Revision not found');
        if (revision.lifecycle !== 'current') {
          if (revision.lifecycle !== 'draft' || revision.validation_status !== 'valid') {
            throw new Error('Only a valid draft revision can be activated');
          }
          this.requireWritableVersion(revision.business_version_id);
          if (spec.executable) {
            const verified = this.db
              .prepare(
                `SELECT id FROM asset_revision_verifications
                 WHERE asset_revision_id = ? AND verification_scope_sha256 = ?
                   AND dependency_closure_sha256 = ? AND status = 'verified' AND is_current = 1`
              )
              .get(revision.id, params.verificationScopeSha256, params.dependencyClosureSha256);
            if (!verified) throw new Error('No verified record matches the activation scope');
          }
        }
        return { params, revision, spec };
      });
      const versionIds = new Set(prepared.map(({ revision }) => revision.business_version_id));
      if (versionIds.size !== 1) {
        throw new Error('Atomic activation cannot span business versions');
      }
      const assetTargets = new Set<string>();
      for (const { params, revision } of prepared) {
        const assetKey = `${params.assetType}:${revision.asset_id}`;
        if (assetTargets.has(assetKey)) {
          throw new Error('Atomic activation cannot contain multiple revisions of one asset');
        }
        assetTargets.add(assetKey);
      }

      const now = new Date().toISOString();
      const activatedRevisionIds: string[] = [];
      const unchangedRevisionIds: string[] = [];
      const insertDependency = this.db.prepare(
        `INSERT INTO asset_revision_dependencies
          (id, business_version_id, from_asset_type, from_asset_id, from_revision_id,
           to_asset_type, to_asset_id, to_revision_id, relation, source_pointer, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const { params, revision, spec } of prepared) {
        if (revision.lifecycle === 'current') {
          unchangedRevisionIds.push(revision.id);
          continue;
        }
        this.db
          .prepare(
            `UPDATE ${spec.table} SET lifecycle = 'superseded'
             WHERE ${spec.assetColumn} = ? AND lifecycle = 'current'`
          )
          .run(revision.asset_id);
        this.db
          .prepare(
            `UPDATE ${spec.table}
             SET lifecycle = 'current'${spec.executable ? ", readiness_status = 'verified'" : ''}
             WHERE id = ? AND lifecycle = 'draft'`
          )
          .run(revision.id);
        for (const edge of params.dependencies) {
          insertDependency.run(
            randomUUID(),
            revision.business_version_id,
            params.assetType,
            revision.asset_id,
            revision.id,
            edge.toAssetType,
            edge.toAssetId,
            edge.toRevisionId ?? null,
            edge.relation,
            edge.sourcePointer,
            now
          );
        }
        if (params.authoringJobId) {
          this.appendAuthoringEvent(
            params.authoringJobId,
            revision.business_version_id,
            'asset.revision_activated',
            params.assetType,
            revision.asset_id,
            { revisionId: revision.id },
            params.correlationId,
            now
          );
        }
        activatedRevisionIds.push(revision.id);
      }
      if (activatedRevisionIds.length > 0) {
        const businessVersionId = prepared[0].revision.business_version_id;
        const reason = stableStringify({
          reason: 'asset_revisions_activated',
          revisionIds: activatedRevisionIds,
        });
        this.db
          .prepare(
            `UPDATE business_version_validations
             SET status = 'needs_recheck', invalidated_at = ?, reason_json = ?
             WHERE business_version_id = ? AND is_current = 1`
          )
          .run(now, reason, businessVersionId);
        this.db
          .prepare(
            `UPDATE business_versions SET validation_status = 'needs_recheck', updated_at = ?
             WHERE id = ?`
          )
          .run(now, businessVersionId);
      }
      return { activatedRevisionIds, unchangedRevisionIds };
    });
  }

  recordBusinessVersionValidation(params: RecordBusinessVersionValidationParams): { id: string } {
    assertNoInlineSecrets(params.verificationScope);
    if (params.reason !== undefined) assertNoInlineSecrets(params.reason);
    requireSha256(params.assetGraphSha256, 'assetGraphSha256');
    const scopeJson = stableStringify(params.verificationScope);
    const id = params.id ?? randomUUID();
    return inImmediateTransaction(this.db, () => {
      this.requireWritableVersion(params.businessVersionId);
      const binding = this.db
        .prepare(
          `SELECT is_default FROM version_deployment_bindings
           WHERE business_version_id = ? AND deployment_revision_id = ?`
        )
        .get(params.businessVersionId, params.deploymentRevisionId) as
        | { is_default: number | bigint }
        | undefined;
      if (!binding) throw new Error('Deployment revision is not bound to the business version');
      if (this.db.prepare('SELECT id FROM business_version_validations WHERE id = ?').get(id)) {
        throw new Error('Business version validation id already exists');
      }
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE business_version_validations SET is_current = 0
           WHERE business_version_id = ? AND deployment_revision_id = ? AND is_current = 1`
        )
        .run(params.businessVersionId, params.deploymentRevisionId);
      this.db
        .prepare(
          `INSERT INTO business_version_validations
            (id, business_version_id, deployment_revision_id, asset_graph_sha256,
             verification_scope_sha256, verification_scope_json, status, is_current,
             authoring_job_id, validated_at, invalidated_at, reason_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.businessVersionId,
          params.deploymentRevisionId,
          params.assetGraphSha256,
          sha256(scopeJson),
          scopeJson,
          params.status,
          params.authoringJobId ?? null,
          params.status === 'valid' ? now : null,
          ['needs_recheck', 'invalid'].includes(params.status) ? now : null,
          params.reason === undefined ? null : stableStringify(params.reason),
          now
        );
      if (Number(binding.is_default) === 1) {
        const aggregateStatus = params.status === 'validating' ? 'needs_recheck' : params.status;
        this.db
          .prepare(
            'UPDATE business_versions SET validation_status = ?, updated_at = ? WHERE id = ?'
          )
          .run(aggregateStatus, now, params.businessVersionId);
      }
      return { id };
    });
  }

  private requireWritableVersion(versionId: string): void {
    const version = this.db
      .prepare('SELECT archived_at FROM business_versions WHERE id = ?')
      .get(versionId) as { archived_at: string | null } | undefined;
    if (!version) throw new Error('Business version not found');
    if (version.archived_at) throw new Error('Archived business versions are read-only');
  }

  private incrementArtifactReferences(artifactIds: readonly string[]): void {
    const increment = this.db.prepare(
      `UPDATE artifact_objects SET ref_count = ref_count + 1
       WHERE id = ? AND deleted_at IS NULL`
    );
    for (const artifactId of artifactIds) {
      const result = increment.run(artifactId);
      if (Number(result.changes) !== 1)
        throw new Error(`Baseline artifact is unavailable: ${artifactId}`);
    }
  }

  private appendAuthoringEvent(
    jobId: string,
    businessVersionId: string,
    type: string,
    entityType: string,
    entityId: string,
    payload: unknown,
    correlationId: string | undefined,
    now: string
  ): void {
    const job = this.db
      .prepare(
        `SELECT next_event_seq FROM authoring_jobs
         WHERE id = ? AND business_version_id = ?`
      )
      .get(jobId, businessVersionId) as { next_event_seq: number | bigint } | undefined;
    if (!job) throw new Error('Authoring job does not belong to the business version');
    const seq = Number(job.next_event_seq);
    this.db
      .prepare('UPDATE authoring_jobs SET next_event_seq = next_event_seq + 1 WHERE id = ?')
      .run(jobId);
    this.db
      .prepare(
        `INSERT INTO authoring_events
          (id, job_id, seq, schema_version, type, entity_type, entity_id,
           correlation_id, payload_json, occurred_at, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        jobId,
        seq,
        type,
        entityType,
        entityId,
        correlationId ?? null,
        stableStringify(payload),
        now,
        now
      );
  }
}
