import { randomUUID } from 'node:crypto';
import {
  assertNoInlineSecrets,
  hashValue,
  inImmediateTransaction,
  requireSha256,
  stableStringify,
  type DatabaseLike,
  type SupportedDatabase,
} from './semantic-repository-utils.js';

export type SemanticContext = { type: 'run'; id: string } | { type: 'authoring'; id: string };

export interface RegisterArtifactParams {
  id?: string;
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  storageBackend: string;
  storageKey: string;
  sensitivity: 'public' | 'sensitive' | 'restricted';
  redactionStatus: 'not_required' | 'pending' | 'redacted' | 'failed';
  encryptionKeyRef?: string;
  expiresAt?: string;
}

export interface CreateEvidenceManifestParams {
  id?: string;
  context: SemanticContext;
  todoId?: string;
  attemptId?: string;
  schemaId: string;
  retentionClass: 'success_7d' | 'failure_30d' | 'pinned' | 'custom';
  supersedesManifestId?: string;
}

export interface AddEvidenceItemParams {
  id?: string;
  manifestId: string;
  itemType:
    | 'screenshot'
    | 'annotated_screenshot'
    | 'dom_snapshot'
    | 'operation_result'
    | 'assertion_result'
    | 'console_meta'
    | 'network_meta'
    | 'video_segment'
    | 'trace'
    | 'agent_audit'
    | 'decision';
  artifactObjectId?: string;
  inline?: unknown;
  stepId?: string;
  browserOperationId?: string;
  capturedAt?: string;
  sourceService: 'ai-e2e' | 'ai-chat-service' | 'proxy-adapter';
  redactionStatus: 'not_required' | 'pending' | 'redacted' | 'failed';
  integritySha256: string;
  metadata: unknown;
}

export interface RecordPolicyEvaluationParams {
  id?: string;
  context: SemanticContext;
  businessVersionId: string;
  deploymentRevisionId: string;
  policyVersion: string;
  sourcePlanSha256: string;
  projectionRedacted: unknown;
  result: 'auto_allowed' | 'approval_required' | 'denied';
  reasonCodes?: readonly string[];
  supersedesEvaluationId?: string;
  decisionRequestId?: string;
}

export interface EnqueueOutboxParams {
  id: string;
  context: SemanticContext;
  pageTaskId?: string;
  attemptId?: string;
  authoringTaskId?: string;
  authoringAttemptId?: string;
  targetService: 'ai_chat_service' | 'proxy_adapter';
  commandType: string;
  endpointOrTool: string;
  payloadRedacted: unknown;
  secretBindingRef?: string;
}

export interface LinkExternalTaskParams {
  id?: string;
  context: SemanticContext;
  pageTaskId?: string;
  attemptId?: string;
  authoringTaskId?: string;
  authoringAttemptId?: string;
  service: 'ai_chat_service' | 'proxy_adapter';
  kind: 'agent_task' | 'browser_session' | 'browser_lease' | 'browser_operation' | 'artifact';
  externalId: string;
  externalState?: string;
  lastExternalSeq?: number;
  requestSha256?: string;
  resultSha256?: string;
  resultRef?: string;
  tokenHash?: string;
  secretRef?: string;
  terminal?: boolean;
}

export interface EvidenceArtifactCleanupCandidate {
  id: string;
  storageBackend: string;
  storageKey: string;
}

const ARTIFACT_ELIGIBLE_FOR_DELETION = `
  deleted_at IS NULL
  AND pinned_at IS NULL
  AND (
    (
      EXISTS (
        SELECT 1 FROM evidence_items AS item
        WHERE item.artifact_object_id = artifact_objects.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM evidence_items AS item
        JOIN evidence_manifests AS manifest ON manifest.id = item.manifest_id
        WHERE item.artifact_object_id = artifact_objects.id
          AND (
            manifest.status <> 'sealed'
            OR manifest.retention_class IN ('pinned', 'custom')
            OR (
              manifest.retention_class = 'success_7d'
              AND COALESCE(manifest.sealed_at, manifest.created_at) > ?
            )
            OR (
              manifest.retention_class = 'failure_30d'
              AND COALESCE(manifest.sealed_at, manifest.created_at) > ?
            )
          )
      )
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM evidence_items AS item
        WHERE item.artifact_object_id = artifact_objects.id
      )
      AND (
        (expires_at IS NOT NULL AND expires_at <= ?)
        OR (expires_at IS NULL AND created_at <= ?)
      )
    )
  )
`;

export class SemanticEvidenceRepository {
  private readonly db: DatabaseLike;

  constructor(db: SupportedDatabase) {
    this.db = db as unknown as DatabaseLike;
  }

  registerArtifact(params: RegisterArtifactParams): { id: string; created: boolean } {
    requireSha256(params.sha256, 'artifact sha256');
    if (!Number.isSafeInteger(params.sizeBytes) || params.sizeBytes < 0) {
      throw new Error('Artifact sizeBytes must be a non-negative safe integer');
    }
    return inImmediateTransaction(this.db, () => {
      const existing = this.db
        .prepare(
          `SELECT * FROM artifact_objects
           WHERE sha256 = ? AND storage_backend = ? AND sensitivity = ?`
        )
        .get(params.sha256, params.storageBackend, params.sensitivity) as
        | Record<string, unknown>
        | undefined;
      if (existing) {
        if (
          Number(existing.size_bytes) !== params.sizeBytes ||
          existing.media_type !== params.mediaType ||
          existing.storage_key !== params.storageKey
        ) {
          throw new Error('Content-addressed artifact metadata does not match the existing object');
        }
        return { id: String(existing.id), created: false };
      }
      const id = params.id ?? randomUUID();
      this.db
        .prepare(
          `INSERT INTO artifact_objects
            (id, sha256, size_bytes, media_type, storage_backend, storage_key,
             sensitivity, redaction_status, encryption_key_ref, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.sha256,
          params.sizeBytes,
          params.mediaType,
          params.storageBackend,
          params.storageKey,
          params.sensitivity,
          params.redactionStatus,
          params.encryptionKeyRef ?? null,
          new Date().toISOString(),
          params.expiresAt ?? null
        );
      return { id, created: true };
    });
  }

  createManifest(params: CreateEvidenceManifestParams): { id: string } {
    return inImmediateTransaction(this.db, () => {
      this.requireContext(params.context);
      const id = params.id ?? randomUUID();
      const now = new Date().toISOString();
      const initial = {
        schema: params.schemaId,
        status: 'open',
        context: params.context,
        items: [],
      };
      const manifestJson = stableStringify(initial);
      this.db
        .prepare(
          `INSERT INTO evidence_manifests
            (id, context_type, context_id, run_id, authoring_job_id, todo_id, attempt_id,
             schema_id, status, supersedes_manifest_id, completeness, manifest_json,
             manifest_sha256, retention_class, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, 'partial', ?, ?, ?, ?)`
        )
        .run(
          id,
          params.context.type,
          params.context.id,
          params.context.type === 'run' ? params.context.id : null,
          params.context.type === 'authoring' ? params.context.id : null,
          params.todoId ?? null,
          params.attemptId ?? null,
          params.schemaId,
          params.supersedesManifestId ?? null,
          manifestJson,
          hashValue(initial),
          params.retentionClass,
          now
        );
      return { id };
    });
  }

  addItem(params: AddEvidenceItemParams): { id: string } {
    if (Boolean(params.artifactObjectId) === (params.inline !== undefined)) {
      throw new Error('Evidence item requires exactly one of artifactObjectId or inline');
    }
    if (params.inline !== undefined) assertNoInlineSecrets(params.inline);
    assertNoInlineSecrets(params.metadata);
    requireSha256(params.integritySha256, 'integritySha256');
    return inImmediateTransaction(this.db, () => {
      const manifest = this.db
        .prepare('SELECT status FROM evidence_manifests WHERE id = ?')
        .get(params.manifestId) as { status: string } | undefined;
      if (!manifest) throw new Error('Evidence manifest not found');
      if (manifest.status !== 'open') throw new Error('Sealed evidence manifests are immutable');
      if (params.artifactObjectId) {
        const artifact = this.db
          .prepare('SELECT deleted_at FROM artifact_objects WHERE id = ?')
          .get(params.artifactObjectId) as { deleted_at: string | null } | undefined;
        if (!artifact || artifact.deleted_at) throw new Error('Evidence artifact is unavailable');
      }
      const id = params.id ?? randomUUID();
      this.db
        .prepare(
          `INSERT INTO evidence_items
            (id, manifest_id, item_type, artifact_object_id, inline_json, step_id,
             browser_operation_id, captured_at, source_service, redaction_status,
             integrity_sha256, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.manifestId,
          params.itemType,
          params.artifactObjectId ?? null,
          params.inline === undefined ? null : stableStringify(params.inline),
          params.stepId ?? null,
          params.browserOperationId ?? null,
          params.capturedAt ?? new Date().toISOString(),
          params.sourceService,
          params.redactionStatus,
          params.integritySha256,
          stableStringify(params.metadata)
        );
      if (params.artifactObjectId) {
        this.db
          .prepare('UPDATE artifact_objects SET ref_count = ref_count + 1 WHERE id = ?')
          .run(params.artifactObjectId);
      }
      return { id };
    });
  }

  sealManifest(
    manifestId: string,
    completeness: 'complete' | 'partial' | 'failed',
    summary?: unknown
  ): { manifestSha256: string; sealed: boolean } {
    if (summary !== undefined) assertNoInlineSecrets(summary);
    return inImmediateTransaction(this.db, () => {
      const manifest = this.db
        .prepare('SELECT * FROM evidence_manifests WHERE id = ?')
        .get(manifestId) as Record<string, unknown> | undefined;
      if (!manifest) throw new Error('Evidence manifest not found');
      if (manifest.status === 'sealed') {
        if (manifest.completeness !== completeness) {
          throw new Error('Sealed manifest replay changed completeness');
        }
        if (summary !== undefined) {
          const stored = JSON.parse(String(manifest.manifest_json)) as { summary?: unknown };
          if (stableStringify(stored.summary ?? null) !== stableStringify(summary)) {
            throw new Error('Sealed manifest replay changed summary');
          }
        }
        return { manifestSha256: String(manifest.manifest_sha256), sealed: false };
      }
      const items = this.db
        .prepare(
          `SELECT id, item_type, artifact_object_id, integrity_sha256, step_id,
                  browser_operation_id, captured_at, source_service, redaction_status
           FROM evidence_items WHERE manifest_id = ? ORDER BY captured_at, id`
        )
        .all(manifestId);
      const sealedManifest = {
        schema: manifest.schema_id,
        status: 'sealed',
        completeness,
        context: { type: manifest.context_type, id: manifest.context_id },
        summary: summary ?? null,
        items,
      };
      const manifestJson = stableStringify(sealedManifest);
      const manifestSha256 = hashValue(sealedManifest);
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE evidence_manifests
           SET status = 'sealed', completeness = ?, manifest_json = ?, manifest_sha256 = ?, sealed_at = ?
           WHERE id = ? AND status = 'open'`
        )
        .run(completeness, manifestJson, manifestSha256, now, manifestId);
      return { manifestSha256, sealed: true };
    });
  }

  recordPolicyEvaluation(params: RecordPolicyEvaluationParams): { id: string; created: boolean } {
    assertNoInlineSecrets(params.projectionRedacted);
    requireSha256(params.sourcePlanSha256, 'sourcePlanSha256');
    const projectionJson = stableStringify(params.projectionRedacted);
    const projectionSha256 = hashValue(params.projectionRedacted);
    return inImmediateTransaction(this.db, () => {
      this.requireContext(params.context);
      const environment = this.requirePolicyScope(
        params.context,
        params.businessVersionId,
        params.deploymentRevisionId
      );
      const existing = this.db
        .prepare(
          `SELECT id, result FROM side_effect_policy_evaluations
           WHERE context_type = ? AND context_id = ? AND source_plan_sha256 = ?
             AND projection_sha256 = ? AND policy_version = ?`
        )
        .get(
          params.context.type,
          params.context.id,
          params.sourcePlanSha256,
          projectionSha256,
          params.policyVersion
        ) as { id: string; result: string } | undefined;
      if (existing) {
        if (existing.result !== params.result) {
          throw new Error('Policy evaluation replay changed the result');
        }
        return { id: existing.id, created: false };
      }
      const id = params.id ?? randomUUID();
      this.db
        .prepare(
          `INSERT INTO side_effect_policy_evaluations
            (id, context_type, context_id, run_id, authoring_job_id, business_version_id,
             deployment_revision_id, environment, policy_version, source_plan_sha256,
             projection_json_redacted, projection_sha256, result, reason_codes_json,
             supersedes_evaluation_id, decision_request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.context.type,
          params.context.id,
          params.context.type === 'run' ? params.context.id : null,
          params.context.type === 'authoring' ? params.context.id : null,
          params.businessVersionId,
          params.deploymentRevisionId,
          environment,
          params.policyVersion,
          params.sourcePlanSha256,
          projectionJson,
          projectionSha256,
          params.result,
          stableStringify(params.reasonCodes ?? []),
          params.supersedesEvaluationId ?? null,
          params.decisionRequestId ?? null,
          new Date().toISOString()
        );
      return { id, created: true };
    });
  }

  enqueueOutbox(params: EnqueueOutboxParams): { created: boolean } {
    assertNoInlineSecrets(params.payloadRedacted);
    const requestSha256 = hashValue({
      targetService: params.targetService,
      commandType: params.commandType,
      endpointOrTool: params.endpointOrTool,
      payloadRedacted: params.payloadRedacted,
      secretBindingRef: params.secretBindingRef ?? null,
    });
    return inImmediateTransaction(this.db, () => {
      this.requireContext(params.context);
      this.requireScopedLinks(params);
      const existing = this.db
        .prepare('SELECT * FROM integration_outbox WHERE id = ?')
        .get(params.id) as Record<string, unknown> | undefined;
      if (existing) {
        if (
          existing.context_type !== params.context.type ||
          existing.context_id !== params.context.id ||
          existing.request_sha256 !== requestSha256
        ) {
          throw new Error('Outbox id was reused with different intent');
        }
        return { created: false };
      }
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO integration_outbox
            (id, context_type, context_id, run_id, page_task_id, attempt_id,
             authoring_job_id, authoring_task_id, authoring_attempt_id,
             target_service, command_type, endpoint_or_tool, request_sha256,
             payload_json_redacted, secret_binding_ref, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .run(
          params.id,
          params.context.type,
          params.context.id,
          params.context.type === 'run' ? params.context.id : null,
          params.pageTaskId ?? null,
          params.attemptId ?? null,
          params.context.type === 'authoring' ? params.context.id : null,
          params.authoringTaskId ?? null,
          params.authoringAttemptId ?? null,
          params.targetService,
          params.commandType,
          params.endpointOrTool,
          requestSha256,
          stableStringify(params.payloadRedacted),
          params.secretBindingRef ?? null,
          now,
          now
        );
      return { created: true };
    });
  }

  claimNextOutbox(now = new Date().toISOString()): Record<string, unknown> | null {
    return inImmediateTransaction(this.db, () => {
      const item = this.db
        .prepare(
          `SELECT * FROM integration_outbox
           WHERE status IN ('pending','retryable_failed')
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ORDER BY created_at, id LIMIT 1`
        )
        .get(now) as Record<string, unknown> | undefined;
      if (!item) return null;
      this.db
        .prepare(
          `UPDATE integration_outbox
           SET status = 'dispatching', attempt_count = attempt_count + 1, updated_at = ?
           WHERE id = ? AND status IN ('pending','retryable_failed')`
        )
        .run(now, item.id);
      return { ...item, status: 'dispatching', attempt_count: Number(item.attempt_count) + 1 };
    });
  }

  recoverDispatchingOutbox(now = new Date().toISOString()): number {
    return inImmediateTransaction(this.db, () => {
      const result = this.db
        .prepare(
          `UPDATE integration_outbox
           SET status = 'retryable_failed', next_attempt_at = ?,
               last_error_json = ?, updated_at = ?
           WHERE status = 'dispatching'`
        )
        .run(
          now,
          stableStringify({
            code: 'coordinator_restarted',
            message: '协调器重启后通过幂等键重新核对外部事实',
            retryable: true,
          }),
          now
        );
      return Number(result.changes);
    });
  }

  settleOutbox(
    id: string,
    status: 'confirmed' | 'retryable_failed' | 'terminal_failed' | 'cancelled',
    options?: { resultRef?: string; error?: unknown; nextAttemptAt?: string }
  ): void {
    if (options?.error !== undefined) assertNoInlineSecrets(options.error);
    inImmediateTransaction(this.db, () => {
      const item = this.db.prepare('SELECT status FROM integration_outbox WHERE id = ?').get(id) as
        | { status: string }
        | undefined;
      if (!item) throw new Error('Outbox item not found');
      if (['confirmed', 'terminal_failed', 'cancelled'].includes(item.status)) {
        if (item.status === status) return;
        throw new Error('Terminal outbox state cannot be changed');
      }
      if (item.status !== 'dispatching')
        throw new Error('Only dispatching outbox items can settle');
      if (status === 'retryable_failed' && !options?.nextAttemptAt) {
        throw new Error('Retryable failures require nextAttemptAt');
      }
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE integration_outbox
           SET status = ?, result_ref = ?, last_error_json = ?, next_attempt_at = ?,
               updated_at = ?, confirmed_at = CASE WHEN ? = 'confirmed' THEN ? ELSE NULL END
           WHERE id = ?`
        )
        .run(
          status,
          options?.resultRef ?? null,
          options?.error === undefined ? null : stableStringify(options.error),
          options?.nextAttemptAt ?? null,
          now,
          status,
          now,
          id
        );
    });
  }

  linkExternalTask(params: LinkExternalTaskParams): { id: string; created: boolean } {
    for (const [value, label] of [
      [params.requestSha256, 'requestSha256'],
      [params.resultSha256, 'resultSha256'],
      [params.tokenHash, 'tokenHash'],
    ] as const) {
      if (value) requireSha256(value, label);
    }
    return inImmediateTransaction(this.db, () => {
      this.requireContext(params.context);
      this.requireScopedLinks(params);
      const existing = this.db
        .prepare(
          'SELECT * FROM external_task_links WHERE service = ? AND kind = ? AND external_id = ?'
        )
        .get(params.service, params.kind, params.externalId) as Record<string, unknown> | undefined;
      const now = new Date().toISOString();
      if (existing) {
        if (
          existing.context_type !== params.context.type ||
          existing.context_id !== params.context.id
        ) {
          throw new Error('External task is already linked to another context');
        }
        if (
          params.requestSha256 &&
          existing.request_sha256 &&
          existing.request_sha256 !== params.requestSha256
        ) {
          throw new Error('External task request hash cannot change');
        }
        if (params.tokenHash && existing.token_hash && existing.token_hash !== params.tokenHash) {
          throw new Error('External task token hash cannot change');
        }
        const previousSeq =
          existing.last_external_seq === null ? null : Number(existing.last_external_seq);
        if (
          params.lastExternalSeq !== undefined &&
          previousSeq !== null &&
          params.lastExternalSeq < previousSeq
        ) {
          throw new Error('External sequence cannot move backwards');
        }
        if (
          params.lastExternalSeq !== undefined &&
          previousSeq === params.lastExternalSeq &&
          params.externalState &&
          existing.external_state &&
          params.externalState !== existing.external_state
        ) {
          throw new Error('External task replay changed state at the same sequence');
        }
        this.db
          .prepare(
            `UPDATE external_task_links
             SET external_state = COALESCE(?, external_state),
                 last_external_seq = COALESCE(?, last_external_seq),
                 result_sha256 = COALESCE(?, result_sha256), result_ref = COALESCE(?, result_ref),
                 last_reconciled_at = ?, terminal_at = CASE WHEN ? THEN ? ELSE terminal_at END
             WHERE id = ?`
          )
          .run(
            params.externalState ?? null,
            params.lastExternalSeq ?? null,
            params.resultSha256 ?? null,
            params.resultRef ?? null,
            now,
            params.terminal ? 1 : 0,
            now,
            existing.id
          );
        return { id: String(existing.id), created: false };
      }
      const id = params.id ?? randomUUID();
      this.db
        .prepare(
          `INSERT INTO external_task_links
            (id, context_type, context_id, run_id, page_task_id, attempt_id,
             authoring_job_id, authoring_task_id, authoring_attempt_id, service, kind,
             external_id, external_state, last_external_seq, request_sha256, result_sha256,
             result_ref, token_hash, secret_ref, created_at, last_reconciled_at, terminal_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.context.type,
          params.context.id,
          params.context.type === 'run' ? params.context.id : null,
          params.pageTaskId ?? null,
          params.attemptId ?? null,
          params.context.type === 'authoring' ? params.context.id : null,
          params.authoringTaskId ?? null,
          params.authoringAttemptId ?? null,
          params.service,
          params.kind,
          params.externalId,
          params.externalState ?? null,
          params.lastExternalSeq ?? null,
          params.requestSha256 ?? null,
          params.resultSha256 ?? null,
          params.resultRef ?? null,
          params.tokenHash ?? null,
          params.secretRef ?? null,
          now,
          now,
          params.terminal ? now : null
        );
      return { id, created: true };
    });
  }

  listArtifactsEligibleForDeletion(
    now: string,
    successCutoff: string,
    failureCutoff: string
  ): EvidenceArtifactCleanupCandidate[] {
    return this.db
      .prepare(
        `SELECT id, storage_backend, storage_key
         FROM artifact_objects
         WHERE ${ARTIFACT_ELIGIBLE_FOR_DELETION}
         ORDER BY created_at, id`
      )
      .all(successCutoff, failureCutoff, now, failureCutoff)
      .map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: String(record.id),
          storageBackend: String(record.storage_backend),
          storageKey: String(record.storage_key),
        };
      });
  }

  claimArtifactDeletion(
    id: string,
    deletedAt: string,
    successCutoff: string,
    failureCutoff: string
  ): boolean {
    return inImmediateTransaction(this.db, () => {
      const result = this.db
        .prepare(
          `UPDATE artifact_objects
           SET deleted_at = ?
           WHERE id = ? AND ${ARTIFACT_ELIGIBLE_FOR_DELETION}`
        )
        .run(deletedAt, id, successCutoff, failureCutoff, deletedAt, failureCutoff);
      return Number(result.changes) === 1;
    });
  }

  listPendingStorageCleanup(): EvidenceArtifactCleanupCandidate[] {
    return this.db
      .prepare(
        `SELECT artifact.id, artifact.storage_backend, artifact.storage_key
         FROM artifact_objects AS artifact
         LEFT JOIN artifact_storage_cleanup_receipts AS receipt
           ON receipt.artifact_object_id = artifact.id
         WHERE artifact.deleted_at IS NOT NULL AND receipt.artifact_object_id IS NULL
         ORDER BY artifact.deleted_at, artifact.id`
      )
      .all()
      .map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: String(record.id),
          storageBackend: String(record.storage_backend),
          storageKey: String(record.storage_key),
        };
      });
  }

  hasOtherLiveStorageReference(storageKey: string, artifactId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM artifact_objects
           WHERE storage_key = ? AND id <> ? AND deleted_at IS NULL
           LIMIT 1`
        )
        .get(storageKey, artifactId)
    );
  }

  recordStorageCleanup(artifactId: string, storageDeletedAt: string): void {
    inImmediateTransaction(this.db, () => {
      const artifact = this.db
        .prepare('SELECT deleted_at FROM artifact_objects WHERE id = ?')
        .get(artifactId) as { deleted_at: string | null } | undefined;
      if (!artifact?.deleted_at) throw new Error('Artifact must be logically deleted first');
      this.db
        .prepare(
          `INSERT INTO artifact_storage_cleanup_receipts
            (artifact_object_id, storage_deleted_at)
           VALUES (?, ?)
           ON CONFLICT(artifact_object_id) DO NOTHING`
        )
        .run(artifactId, storageDeletedAt);
    });
  }

  private requireContext(context: SemanticContext): void {
    const table = context.type === 'run' ? 'test_runs' : 'authoring_jobs';
    if (!this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(context.id)) {
      throw new Error(`${context.type} context not found`);
    }
  }

  private requirePolicyScope(
    context: SemanticContext,
    businessVersionId: string,
    deploymentRevisionId: string
  ): 'local' | 'test' | 'staging' | 'production' {
    if (context.type === 'run') {
      const run = this.db
        .prepare('SELECT business_version_id, deployment_revision_id FROM test_runs WHERE id = ?')
        .get(context.id) as
        | { business_version_id: string; deployment_revision_id: string }
        | undefined;
      if (
        !run ||
        run.business_version_id !== businessVersionId ||
        run.deployment_revision_id !== deploymentRevisionId
      ) {
        throw new Error('Policy scope does not match the run');
      }
      return this.readDeploymentEnvironment(deploymentRevisionId);
    }
    const job = this.db
      .prepare('SELECT business_version_id FROM authoring_jobs WHERE id = ?')
      .get(context.id) as { business_version_id: string } | undefined;
    if (!job || job.business_version_id !== businessVersionId) {
      throw new Error('Policy scope does not match the authoring job');
    }
    if (
      !this.db
        .prepare(
          `SELECT 1 FROM version_deployment_bindings
           WHERE business_version_id = ? AND deployment_revision_id = ?`
        )
        .get(businessVersionId, deploymentRevisionId)
    ) {
      throw new Error('Policy deployment revision is not bound to the business version');
    }
    return this.readDeploymentEnvironment(deploymentRevisionId);
  }

  private readDeploymentEnvironment(
    deploymentRevisionId: string
  ): 'local' | 'test' | 'staging' | 'production' {
    const revision = this.db
      .prepare('SELECT payload_json FROM deployment_profile_revisions WHERE id = ?')
      .get(deploymentRevisionId) as { payload_json: string } | undefined;
    if (!revision) throw new Error('Deployment revision not found');
    const payload = JSON.parse(revision.payload_json) as { environment?: unknown };
    if (!['local', 'test', 'staging', 'production'].includes(String(payload.environment))) {
      throw new Error('Deployment revision has no valid immutable environment');
    }
    return payload.environment as 'local' | 'test' | 'staging' | 'production';
  }

  private requireScopedLinks(params: {
    context: SemanticContext;
    pageTaskId?: string;
    attemptId?: string;
    authoringTaskId?: string;
    authoringAttemptId?: string;
  }): void {
    if (params.context.type === 'run') {
      if (params.authoringTaskId || params.authoringAttemptId) {
        throw new Error('Run context cannot reference authoring task fields');
      }
      if (params.pageTaskId) {
        const pageTask = this.db
          .prepare('SELECT run_id FROM page_tasks WHERE id = ?')
          .get(params.pageTaskId) as { run_id: string } | undefined;
        if (!pageTask || pageTask.run_id !== params.context.id) {
          throw new Error('Page task does not belong to the run context');
        }
      }
      if (params.attemptId) {
        const attempt = this.db
          .prepare('SELECT run_id FROM execution_attempts WHERE id = ?')
          .get(params.attemptId) as { run_id: string } | undefined;
        if (!attempt || attempt.run_id !== params.context.id) {
          throw new Error('Execution attempt does not belong to the run context');
        }
      }
      return;
    }
    if (params.pageTaskId || params.attemptId) {
      throw new Error('Authoring context cannot reference run task fields');
    }
    if (params.authoringTaskId) {
      const task = this.db
        .prepare('SELECT job_id FROM authoring_tasks WHERE id = ?')
        .get(params.authoringTaskId) as { job_id: string } | undefined;
      if (!task || task.job_id !== params.context.id) {
        throw new Error('Authoring task does not belong to the context');
      }
    }
    if (params.authoringAttemptId) {
      const attempt = this.db
        .prepare('SELECT job_id FROM authoring_attempts WHERE id = ?')
        .get(params.authoringAttemptId) as { job_id: string } | undefined;
      if (!attempt || attempt.job_id !== params.context.id) {
        throw new Error('Authoring attempt does not belong to the context');
      }
    }
  }
}
