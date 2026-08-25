import { randomUUID } from 'node:crypto';
import type {
  ActivateSemanticRevisionParams,
  SemanticAssetRepository,
  SemanticAssetType,
  SemanticDependencyEdge,
} from './semantic-asset-repository.js';
import {
  assertNoInlineSecrets,
  hashValue,
  inImmediateTransaction,
  requireSha256,
  stableStringify,
  type DatabaseLike,
  type SupportedDatabase,
} from './semantic-repository-utils.js';

export type AmendmentState =
  | 'draft'
  | 'candidate_ready'
  | 'waiting_decision'
  | 'queued_at_safe_boundary'
  | 'verifying'
  | 'activated'
  | 'rejected'
  | 'failed'
  | 'stale';

export type AmendmentCategory =
  | 'requirement'
  | 'script'
  | 'acceptance'
  | 'scenario_add'
  | 'scenario_remove'
  | 'scenario_reorder'
  | 'module_call'
  | 'repair';

export interface AuthoringContextScope {
  currentUrl: string;
  currentPageDefinitionId: string;
  currentFunctionalModuleId: string;
  baseRevisionSha256: string;
  visibleScenarioIds: string[];
  context?: Record<string, unknown>;
}

export interface CreateAuthoringThreadParams {
  id?: string;
  jobId: string;
  businessVersionId: string;
  scope: AuthoringContextScope;
  createdBy: string;
}

export interface AuthoringAmendmentChangeInput {
  assetType: SemanticAssetType;
  assetId: string;
  baseRevisionId: string;
  baseRevisionSha256: string;
  candidateRevisionId: string;
  targetPageDefinitionId: string;
  targetFunctionalModuleId?: string;
  targetUrl: string;
  category: string;
  diff: Record<string, unknown>;
  dependencies?: SemanticDependencyEdge[];
  verificationScopeSha256?: string;
  dependencyClosureSha256?: string;
}

export interface CreateAuthoringAmendmentParams {
  id?: string;
  jobId: string;
  threadId: string;
  idempotencyKey: string;
  reason: string;
  category: AmendmentCategory;
  changes: AuthoringAmendmentChangeInput[];
  validationPlan: Record<string, unknown>;
  potentialSideEffects?: Record<string, unknown>;
  createdBy: string;
}

export interface AmendmentRecord {
  id: string;
  jobId: string;
  threadId: string;
  state: AmendmentState;
  reason: string;
  category: AmendmentCategory;
  impact: Record<string, unknown>;
  validationPlan: Record<string, unknown>;
  decisionIds: string[];
  changes: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  failure?: Record<string, unknown>;
  staleReason?: Record<string, unknown>;
}

interface RevisionSpec {
  table: string;
  assetColumn: string;
}

const REVISION_SPECS: Record<SemanticAssetType, RevisionSpec> = {
  page_definition: { table: 'page_definition_revisions', assetColumn: 'page_definition_id' },
  business_module: {
    table: 'semantic_business_module_revisions',
    assetColumn: 'business_module_id',
  },
  functional_module: {
    table: 'semantic_functional_module_revisions',
    assetColumn: 'functional_module_id',
  },
  functional_script: {
    table: 'functional_script_revisions',
    assetColumn: 'functional_script_id',
  },
  test_scenario: {
    table: 'semantic_test_scenario_revisions',
    assetColumn: 'test_scenario_id',
  },
  page_baseline: {
    table: 'page_baseline_revisions',
    assetColumn: 'page_baseline_variant_id',
  },
  module_requirement: {
    table: 'module_requirement_revisions',
    assetColumn: 'functional_module_id',
  },
};

type DbRow = Record<string, unknown>;

export class AuthoringAmendmentRepository {
  private readonly db: DatabaseLike;

  constructor(
    database: SupportedDatabase,
    private readonly assets: SemanticAssetRepository
  ) {
    this.db = database as unknown as DatabaseLike;
  }

  createContextThread(params: CreateAuthoringThreadParams): {
    id: string;
    created: boolean;
  } {
    requireSha256(params.scope.baseRevisionSha256, 'baseRevisionSha256');
    assertNoInlineSecrets(params.scope.context ?? {});
    const scopeKey = hashValue({
      currentUrl: params.scope.currentUrl,
      currentPageDefinitionId: params.scope.currentPageDefinitionId,
      currentFunctionalModuleId: params.scope.currentFunctionalModuleId,
      baseRevisionSha256: params.scope.baseRevisionSha256,
      visibleScenarioIds: [...params.scope.visibleScenarioIds].sort(),
    });
    return inImmediateTransaction(this.db, () => {
      const job = this.requireWritableJob(params.jobId, params.businessVersionId);
      this.requireOwnedAsset(
        'page_definitions',
        params.scope.currentPageDefinitionId,
        params.businessVersionId,
        'Page'
      );
      this.requireOwnedAsset(
        'semantic_functional_modules',
        params.scope.currentFunctionalModuleId,
        params.businessVersionId,
        'Functional module'
      );
      const existing = this.db
        .prepare(
          `SELECT id, state FROM authoring_context_threads
           WHERE job_id = ? AND scope_key = ?`
        )
        .get(params.jobId, scopeKey) as { id: string; state: string } | undefined;
      const now = new Date().toISOString();
      this.staleActiveThread(params.jobId, scopeKey, now);
      if (existing) {
        this.db
          .prepare(
            `UPDATE authoring_context_threads
             SET state = 'active', stale_reason_json = NULL, updated_at = ? WHERE id = ?`
          )
          .run(now, existing.id);
        return { id: existing.id, created: false };
      }
      const id = params.id ?? randomUUID();
      this.db
        .prepare(
          `INSERT INTO authoring_context_threads
            (id, job_id, business_version_id, scope_key, current_url_redacted,
             current_page_definition_id, current_functional_module_id, base_revision_sha256,
             state, context_json_redacted, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
        )
        .run(
          id,
          params.jobId,
          params.businessVersionId,
          scopeKey,
          params.scope.currentUrl,
          params.scope.currentPageDefinitionId,
          params.scope.currentFunctionalModuleId,
          params.scope.baseRevisionSha256,
          stableStringify({
            visibleScenarioIds: params.scope.visibleScenarioIds,
            ...(params.scope.context ?? {}),
          }),
          params.createdBy,
          now,
          now
        );
      this.appendEvent(
        params.jobId,
        Number(job.next_event_seq),
        'authoring.context_bound',
        'authoring_context_thread',
        id,
        { scopeKey, currentUrl: params.scope.currentUrl },
        now
      );
      return { id, created: true };
    });
  }

  createAmendment(params: CreateAuthoringAmendmentParams): {
    amendment: AmendmentRecord;
    created: boolean;
  } {
    if (params.changes.length === 0) throw new Error('At least one amendment change is required');
    assertNoInlineSecrets(params.validationPlan);
    assertNoInlineSecrets(params.potentialSideEffects ?? {});
    for (const change of params.changes) {
      assertNoInlineSecrets(change.diff);
      requireSha256(change.baseRevisionSha256, 'baseRevisionSha256');
      if (change.verificationScopeSha256) {
        requireSha256(change.verificationScopeSha256, 'verificationScopeSha256');
      }
      if (change.dependencyClosureSha256) {
        requireSha256(change.dependencyClosureSha256, 'dependencyClosureSha256');
      }
    }
    const requestSha256 = hashValue({
      threadId: params.threadId,
      reason: params.reason,
      category: params.category,
      changes: params.changes,
      validationPlan: params.validationPlan,
      potentialSideEffects: params.potentialSideEffects ?? {},
    });
    return inImmediateTransaction(this.db, () => {
      const existing = this.db
        .prepare(
          `SELECT id, request_sha256 FROM authoring_amendments
           WHERE job_id = ? AND idempotency_key = ?`
        )
        .get(params.jobId, params.idempotencyKey) as
        | { id: string; request_sha256: string }
        | undefined;
      if (existing) {
        if (existing.request_sha256 !== requestSha256) {
          throw new Error('Amendment idempotency key was reused with different input');
        }
        return { amendment: this.requireAmendment(existing.id), created: false };
      }
      const job = this.requireWritableJob(params.jobId);
      const thread = this.requireActiveThread(params.threadId, params.jobId);
      for (const change of params.changes) {
        this.validateChange(change, String(thread.business_version_id), thread);
      }
      const id = params.id ?? randomUUID();
      const impact = buildImpact(thread, params);
      const scopeKinds = classifyScopeExpansion(thread, params.changes);
      const decisionIds = scopeKinds.map(() => randomUUID());
      const state: AmendmentState = decisionIds.length > 0 ? 'waiting_decision' : 'candidate_ready';
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO authoring_amendments
            (id, job_id, thread_id, idempotency_key, request_sha256, state, reason,
             category, impact_json, validation_plan_json, decision_ids_json,
             created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.jobId,
          params.threadId,
          params.idempotencyKey,
          requestSha256,
          state,
          params.reason,
          params.category,
          stableStringify(impact),
          stableStringify(params.validationPlan),
          stableStringify(decisionIds),
          params.createdBy,
          now,
          now
        );
      const insertChange = this.db.prepare(
        `INSERT INTO authoring_amendment_changes
          (id, amendment_id, sequence, asset_type, asset_id, base_revision_id,
           base_revision_sha256, candidate_revision_id, target_page_definition_id,
           target_functional_module_id, target_url_redacted, category, diff_json,
           dependencies_json, verification_scope_sha256, dependency_closure_sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      params.changes.forEach((change, index) => {
        insertChange.run(
          randomUUID(),
          id,
          index + 1,
          change.assetType,
          change.assetId,
          change.baseRevisionId,
          change.baseRevisionSha256,
          change.candidateRevisionId,
          change.targetPageDefinitionId,
          change.targetFunctionalModuleId ?? null,
          change.targetUrl,
          change.category,
          stableStringify(change.diff),
          stableStringify(change.dependencies ?? []),
          change.verificationScopeSha256 ?? null,
          change.dependencyClosureSha256 ?? null,
          now
        );
      });
      scopeKinds.forEach((scopeKind, index) => {
        const decisionId = decisionIds[index];
        const affected = params.changes.filter((change) =>
          scopeKind === 'cross_url'
            ? change.targetUrl !== thread.current_url_redacted
            : change.targetUrl === thread.current_url_redacted &&
              (['page_definition', 'business_module', 'page_baseline'].includes(change.assetType) ||
                (Boolean(change.targetFunctionalModuleId) &&
                  change.targetFunctionalModuleId !== thread.current_functional_module_id))
        );
        const decisionImpact = { ...impact, scopeKind, affectedChanges: affected };
        this.db
          .prepare(
            `INSERT INTO decision_requests
              (id, context_type, context_id, authoring_job_id, status, category,
               required_authority, question, facts_json, options_json,
               recommendation_key, impact_json, state_version, created_by, created_at)
             VALUES (?, 'authoring', ?, ?, 'open', 'authoring_scope_expansion',
               'user', ?, ?, ?, 'approve', ?, 1, ?, ?)`
          )
          .run(
            decisionId,
            params.jobId,
            params.jobId,
            scopeKind === 'cross_url'
              ? '候选修改涉及其他 URL，是否批准扩展修改范围？'
              : '候选修改涉及当前页面的其他模块，是否批准扩展修改范围？',
            stableStringify({ amendmentId: id, scopeKind }),
            stableStringify([
              { key: 'approve', label: '批准范围扩展' },
              { key: 'reject', label: '拒绝并保持当前版本' },
            ]),
            stableStringify(decisionImpact),
            params.createdBy,
            now
          );
        this.db
          .prepare(
            `INSERT INTO authoring_amendment_decisions
              (amendment_id, decision_id, scope_kind) VALUES (?, ?, ?)`
          )
          .run(id, decisionId, scopeKind);
      });
      this.appendEvent(
        params.jobId,
        Number(job.next_event_seq),
        'asset.candidate_created',
        'authoring_amendment',
        id,
        { state, decisionIds, changeCount: params.changes.length },
        now
      );
      return { amendment: this.requireAmendment(id), created: true };
    });
  }

  addChatMessage(params: {
    id?: string;
    threadId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    amendmentId?: string;
    createdBy: string;
  }): { id: string } {
    if (!params.content.trim()) throw new Error('Chat content is required');
    return inImmediateTransaction(this.db, () => {
      const thread = this.db
        .prepare('SELECT job_id FROM authoring_context_threads WHERE id = ?')
        .get(params.threadId) as { job_id: string } | undefined;
      if (!thread) throw new Error('Authoring context thread not found');
      if (params.amendmentId) {
        const amendment = this.db
          .prepare('SELECT thread_id FROM authoring_amendments WHERE id = ?')
          .get(params.amendmentId) as { thread_id: string } | undefined;
        if (!amendment || amendment.thread_id !== params.threadId) {
          throw new Error('Chat amendment does not belong to the thread');
        }
      }
      const id = params.id ?? randomUUID();
      this.db
        .prepare(
          `INSERT INTO authoring_chat_messages
            (id, thread_id, role, content, amendment_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.threadId,
          params.role,
          params.content,
          params.amendmentId ?? null,
          params.createdBy,
          new Date().toISOString()
        );
      return { id };
    });
  }

  listChatMessages(threadId: string): Array<Record<string, unknown>> {
    if (!this.db.prepare('SELECT id FROM authoring_context_threads WHERE id = ?').get(threadId)) {
      throw new Error('Authoring context thread not found');
    }
    return this.db
      .prepare(
        `SELECT id, thread_id, role, content, amendment_id, created_by, created_at
         FROM authoring_chat_messages WHERE thread_id = ? ORDER BY created_at, rowid`
      )
      .all(threadId)
      .map((row) => mapRow(row as DbRow));
  }

  answerDecision(params: {
    amendmentId: string;
    decisionId: string;
    answerId?: string;
    answer: 'approve' | 'reject';
    reason: string;
    answeredBy: string;
  }): AmendmentRecord {
    return inImmediateTransaction(this.db, () => {
      const amendment = this.requireAmendment(params.amendmentId);
      if (amendment.state !== 'waiting_decision') {
        throw new Error('Amendment is not waiting for a decision');
      }
      const decision = this.db
        .prepare(
          `SELECT requests.* FROM decision_requests AS requests
           JOIN authoring_amendment_decisions AS links ON links.decision_id = requests.id
           WHERE links.amendment_id = ? AND requests.id = ?`
        )
        .get(params.amendmentId, params.decisionId) as DbRow | undefined;
      if (!decision) throw new Error('Decision does not belong to the amendment');
      const existingAnswer = this.db
        .prepare('SELECT answer_key FROM decision_answers WHERE decision_request_id = ?')
        .get(params.decisionId) as { answer_key: string } | undefined;
      if (existingAnswer) {
        if (existingAnswer.answer_key !== params.answer) {
          throw new Error('Decision was already answered differently');
        }
        return this.requireAmendment(params.amendmentId);
      }
      if (decision.status !== 'open') throw new Error('Decision is not open');
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO decision_answers
            (id, decision_request_id, answer_key, reason, answered_by_type,
             answered_by_id, created_at)
           VALUES (?, ?, ?, ?, 'user', ?, ?)`
        )
        .run(
          params.answerId ?? randomUUID(),
          params.decisionId,
          params.answer,
          params.reason,
          params.answeredBy,
          now
        );
      this.db
        .prepare(
          `UPDATE decision_requests
           SET status = ?, state_version = state_version + 1, answered_at = ?, applied_at = ?
           WHERE id = ?`
        )
        .run(
          params.answer === 'approve' ? 'applied' : 'answered',
          now,
          params.answer === 'approve' ? now : null,
          params.decisionId
        );
      if (params.answer === 'reject') {
        this.updateAmendmentState(params.amendmentId, 'waiting_decision', 'rejected', now, {
          failure: { code: 'scope_expansion_rejected', decisionId: params.decisionId },
        });
      } else {
        const open = this.db
          .prepare(
            `SELECT 1 FROM authoring_amendment_decisions AS links
             JOIN decision_requests AS requests ON requests.id = links.decision_id
             WHERE links.amendment_id = ? AND requests.status != 'applied' LIMIT 1`
          )
          .get(params.amendmentId);
        if (!open) {
          this.updateAmendmentState(params.amendmentId, 'waiting_decision', 'candidate_ready', now);
        }
      }
      this.appendEvent(
        amendment.jobId,
        this.nextEventSeq(amendment.jobId),
        params.answer === 'approve' ? 'decision.applied' : 'asset.candidate_rejected',
        'authoring_amendment',
        params.amendmentId,
        { decisionId: params.decisionId, answer: params.answer },
        now
      );
      return this.requireAmendment(params.amendmentId);
    });
  }

  queueAtSafeBoundary(amendmentId: string): AmendmentRecord {
    const candidate = this.requireAmendment(amendmentId);
    if (candidate.state !== 'candidate_ready') {
      throw new Error('Only a ready candidate can be applied');
    }
    this.assertCandidateFresh(candidate);
    return inImmediateTransaction(this.db, () => {
      const amendment = this.requireAmendment(amendmentId);
      if (amendment.state !== 'candidate_ready') {
        throw new Error('Only a ready candidate can be applied');
      }
      this.assertDecisionsApplied(amendmentId);
      const now = new Date().toISOString();
      const nextState: AmendmentState = this.hasUnsafeBrowserOperation(amendment.jobId)
        ? 'queued_at_safe_boundary'
        : 'verifying';
      this.updateAmendmentState(amendmentId, 'candidate_ready', nextState, now);
      this.appendEvent(
        amendment.jobId,
        this.nextEventSeq(amendment.jobId),
        nextState === 'verifying'
          ? 'asset.candidate_verification_started'
          : 'asset.candidate_queued_at_safe_boundary',
        'authoring_amendment',
        amendmentId,
        { state: nextState },
        now
      );
      return this.requireAmendment(amendmentId);
    });
  }

  beginQueuedVerification(amendmentId: string): AmendmentRecord {
    const candidate = this.requireAmendment(amendmentId);
    if (candidate.state !== 'queued_at_safe_boundary') {
      throw new Error('Amendment is not queued at a safe boundary');
    }
    this.assertCandidateFresh(candidate);
    return inImmediateTransaction(this.db, () => {
      const amendment = this.requireAmendment(amendmentId);
      if (amendment.state !== 'queued_at_safe_boundary') {
        throw new Error('Amendment is not queued at a safe boundary');
      }
      if (this.hasUnsafeBrowserOperation(amendment.jobId)) {
        throw new Error('Browser operation has not reached a safe boundary');
      }
      const now = new Date().toISOString();
      this.updateAmendmentState(amendmentId, 'queued_at_safe_boundary', 'verifying', now);
      this.appendEvent(
        amendment.jobId,
        this.nextEventSeq(amendment.jobId),
        'asset.candidate_verification_started',
        'authoring_amendment',
        amendmentId,
        {},
        now
      );
      return this.requireAmendment(amendmentId);
    });
  }

  reject(amendmentId: string, reason: string): AmendmentRecord {
    return this.finishWithoutActivation(amendmentId, 'rejected', {
      code: 'rejected_by_user',
      reason,
    });
  }

  fail(amendmentId: string, failure: Record<string, unknown>): AmendmentRecord {
    assertNoInlineSecrets(failure);
    return this.finishWithoutActivation(amendmentId, 'failed', failure);
  }

  activate(amendmentId: string, correlationId?: string): AmendmentRecord {
    const amendment = this.requireAmendment(amendmentId);
    if (amendment.state === 'activated') return amendment;
    if (amendment.state !== 'verifying') {
      throw new Error('Only a verifying amendment can be activated');
    }
    if (!this.areAllCandidatesCurrent(amendment)) {
      this.assertCandidateFresh(amendment);
      const activations = amendment.changes.map((change) =>
        toActivationParams(change, amendment.jobId, correlationId)
      );
      this.assets.activateRevisions(activations);
    }
    return inImmediateTransaction(this.db, () => {
      const current = this.requireAmendment(amendmentId);
      if (current.state === 'activated') return current;
      if (current.state !== 'verifying' || !this.areAllCandidatesCurrent(current)) {
        throw new Error('Candidate revisions were not atomically activated');
      }
      const now = new Date().toISOString();
      this.updateAmendmentState(amendmentId, 'verifying', 'activated', now);
      this.appendEvent(
        current.jobId,
        this.nextEventSeq(current.jobId),
        'asset.candidate_activated',
        'authoring_amendment',
        amendmentId,
        { revisionIds: current.changes.map((change) => change.candidateRevisionId) },
        now
      );
      return this.requireAmendment(amendmentId);
    });
  }

  getAmendment(amendmentId: string): AmendmentRecord | null {
    const row = this.db
      .prepare('SELECT id FROM authoring_amendments WHERE id = ?')
      .get(amendmentId);
    return row ? this.requireAmendment(amendmentId) : null;
  }

  listAmendments(jobId: string): AmendmentRecord[] {
    return (
      this.db
        .prepare('SELECT id FROM authoring_amendments WHERE job_id = ? ORDER BY created_at')
        .all(jobId) as Array<{ id: string }>
    ).map((row) => this.requireAmendment(row.id));
  }

  private finishWithoutActivation(
    amendmentId: string,
    state: 'rejected' | 'failed',
    failure: Record<string, unknown>
  ): AmendmentRecord {
    return inImmediateTransaction(this.db, () => {
      const amendment = this.requireAmendment(amendmentId);
      if (['activated', 'rejected', 'failed', 'stale'].includes(amendment.state)) {
        if (amendment.state === state) return amendment;
        throw new Error('Terminal amendment cannot change outcome');
      }
      const now = new Date().toISOString();
      this.updateAmendmentState(amendmentId, amendment.state, state, now, { failure });
      this.appendEvent(
        amendment.jobId,
        this.nextEventSeq(amendment.jobId),
        state === 'rejected' ? 'asset.candidate_rejected' : 'asset.candidate_failed',
        'authoring_amendment',
        amendmentId,
        failure,
        now
      );
      return this.requireAmendment(amendmentId);
    });
  }

  private staleActiveThread(jobId: string, nextScopeKey: string, now: string): void {
    const active = this.db
      .prepare(
        `SELECT id FROM authoring_context_threads
         WHERE job_id = ? AND state = 'active' AND scope_key != ?`
      )
      .get(jobId, nextScopeKey) as { id: string } | undefined;
    if (!active) return;
    const reason = stableStringify({ code: 'context_changed', nextScopeKey });
    this.db
      .prepare(
        `UPDATE authoring_context_threads
         SET state = 'stale', stale_reason_json = ?, updated_at = ? WHERE id = ?`
      )
      .run(reason, now, active.id);
    this.db
      .prepare(
        `UPDATE authoring_amendments
         SET state = 'stale', stale_reason_json = ?, completed_at = ?, updated_at = ?
         WHERE thread_id = ? AND state IN (
           'draft','candidate_ready','waiting_decision','queued_at_safe_boundary','verifying'
         )`
      )
      .run(reason, now, now, active.id);
  }

  private requireWritableJob(jobId: string, versionId?: string): DbRow {
    const job = this.db.prepare('SELECT * FROM authoring_jobs WHERE id = ?').get(jobId) as
      | DbRow
      | undefined;
    if (!job || (versionId && job.business_version_id !== versionId)) {
      throw new Error('Authoring job not found for the business version');
    }
    if (['completed', 'cancelled', 'failed'].includes(String(job.lifecycle))) {
      throw new Error('Authoring job is not writable');
    }
    return job;
  }

  private requireActiveThread(threadId: string, jobId: string): DbRow {
    const thread = this.db
      .prepare('SELECT * FROM authoring_context_threads WHERE id = ? AND job_id = ?')
      .get(threadId, jobId) as DbRow | undefined;
    if (!thread) throw new Error('Authoring context thread not found');
    if (thread.state !== 'active') throw new Error('Authoring context thread is stale');
    return thread;
  }

  private requireOwnedAsset(
    table: string,
    assetId: string,
    versionId: string,
    label: string
  ): void {
    const asset = this.db
      .prepare(`SELECT business_version_id FROM ${table} WHERE id = ?`)
      .get(assetId) as { business_version_id: string } | undefined;
    if (!asset || asset.business_version_id !== versionId) {
      throw new Error(`${label} does not belong to the business version`);
    }
  }

  private validateChange(
    change: AuthoringAmendmentChangeInput,
    versionId: string,
    thread: DbRow
  ): void {
    const spec = REVISION_SPECS[change.assetType];
    const base = this.db
      .prepare(
        `SELECT ${spec.assetColumn} AS asset_id, business_version_id, lifecycle, content_sha256,
                payload_json
         FROM ${spec.table} WHERE id = ?`
      )
      .get(change.baseRevisionId) as DbRow | undefined;
    const candidate = this.db
      .prepare(
        `SELECT ${spec.assetColumn} AS asset_id, business_version_id, lifecycle,
                validation_status, supersedes_revision_id
         FROM ${spec.table} WHERE id = ?`
      )
      .get(change.candidateRevisionId) as DbRow | undefined;
    if (
      !base ||
      base.asset_id !== change.assetId ||
      base.business_version_id !== versionId ||
      base.lifecycle !== 'current' ||
      base.content_sha256 !== change.baseRevisionSha256
    ) {
      throw new Error('Amendment base revision is stale or belongs to another asset');
    }
    if (
      !candidate ||
      candidate.asset_id !== change.assetId ||
      candidate.business_version_id !== versionId ||
      candidate.lifecycle !== 'draft' ||
      candidate.validation_status !== 'valid' ||
      candidate.supersedes_revision_id !== change.baseRevisionId
    ) {
      throw new Error('Candidate must be a valid draft that supersedes the exact base revision');
    }
    const ownership = this.resolveChangeOwnership(change, base, versionId);
    if (
      ownership.functionalModuleId &&
      change.targetFunctionalModuleId !== ownership.functionalModuleId
    ) {
      throw new Error('Target functional module does not match the asset owner');
    }
    if (
      ownership.pageDefinitionId &&
      change.targetPageDefinitionId !== ownership.pageDefinitionId
    ) {
      throw new Error('Target page does not match the asset owner');
    }
    if (
      change.assetType === 'test_scenario' &&
      change.targetUrl === thread.current_url_redacted &&
      !parseStringArray(parseObject(thread.context_json_redacted).visibleScenarioIds).includes(
        change.assetId
      )
    ) {
      throw new Error('Scenario is not visible in the current URL scope');
    }
    this.requireOwnedAsset(
      'page_definitions',
      change.targetPageDefinitionId,
      versionId,
      'Target page'
    );
    if (change.targetFunctionalModuleId) {
      this.requireOwnedAsset(
        'semantic_functional_modules',
        change.targetFunctionalModuleId,
        versionId,
        'Target functional module'
      );
    }
  }

  private resolveChangeOwnership(
    change: AuthoringAmendmentChangeInput,
    base: DbRow,
    versionId: string
  ): { functionalModuleId?: string; pageDefinitionId?: string } {
    if (change.assetType === 'functional_module' || change.assetType === 'module_requirement') {
      const module = this.db
        .prepare(
          `SELECT primary_page_definition_id FROM semantic_functional_modules
           WHERE id = ? AND business_version_id = ?`
        )
        .get(change.assetId, versionId) as { primary_page_definition_id: string } | undefined;
      if (!module) throw new Error('Functional module ownership is unavailable');
      return {
        functionalModuleId: change.assetId,
        pageDefinitionId: module.primary_page_definition_id,
      };
    }
    if (change.assetType === 'functional_script') {
      const script = this.db
        .prepare(
          `SELECT scripts.functional_module_id, modules.primary_page_definition_id
           FROM functional_scripts AS scripts
           JOIN semantic_functional_modules AS modules ON modules.id = scripts.functional_module_id
           WHERE scripts.id = ? AND scripts.business_version_id = ?`
        )
        .get(change.assetId, versionId) as
        | { functional_module_id: string; primary_page_definition_id: string }
        | undefined;
      if (!script) throw new Error('Functional script ownership is unavailable');
      const basePayload = parseObject(base.payload_json);
      const pageScope = parseObject(basePayload.pageScope);
      return {
        functionalModuleId: script.functional_module_id,
        pageDefinitionId:
          typeof pageScope.entryPageId === 'string'
            ? pageScope.entryPageId
            : script.primary_page_definition_id,
      };
    }
    return {};
  }

  private requireAmendment(amendmentId: string): AmendmentRecord {
    const row = this.db
      .prepare('SELECT * FROM authoring_amendments WHERE id = ?')
      .get(amendmentId) as DbRow | undefined;
    if (!row) throw new Error('Authoring amendment not found');
    const changes = (
      this.db
        .prepare(
          `SELECT * FROM authoring_amendment_changes
           WHERE amendment_id = ? ORDER BY sequence`
        )
        .all(amendmentId) as DbRow[]
    ).map(mapRow);
    const decisions = (
      this.db
        .prepare(
          `SELECT requests.*, links.scope_kind, answers.answer_key, answers.reason AS answer_reason,
                  answers.answered_by_id, answers.created_at AS answer_created_at
           FROM authoring_amendment_decisions AS links
           JOIN decision_requests AS requests ON requests.id = links.decision_id
           LEFT JOIN decision_answers AS answers ON answers.decision_request_id = requests.id
           WHERE links.amendment_id = ? ORDER BY requests.created_at`
        )
        .all(amendmentId) as DbRow[]
    ).map(mapRow);
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      threadId: String(row.thread_id),
      state: row.state as AmendmentState,
      reason: String(row.reason),
      category: row.category as AmendmentCategory,
      impact: parseObject(row.impact_json),
      validationPlan: parseObject(row.validation_plan_json),
      decisionIds: parseArray(row.decision_ids_json).map(String),
      changes,
      decisions,
      createdBy: String(row.created_by),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      ...(row.failure_json ? { failure: parseObject(row.failure_json) } : {}),
      ...(row.stale_reason_json ? { staleReason: parseObject(row.stale_reason_json) } : {}),
    };
  }

  private assertCandidateFresh(amendment: AmendmentRecord): void {
    const thread = this.db
      .prepare('SELECT state FROM authoring_context_threads WHERE id = ?')
      .get(amendment.threadId) as { state: string } | undefined;
    if (!thread || thread.state !== 'active') {
      this.markStale(amendment.id, { code: 'context_stale' });
      throw new Error('Amendment context is stale');
    }
    for (const raw of amendment.changes) {
      const change = raw as unknown as {
        assetType: SemanticAssetType;
        assetId: string;
        baseRevisionId: string;
        baseRevisionSha256: string;
      };
      const spec = REVISION_SPECS[change.assetType];
      const base = this.db
        .prepare(
          `SELECT lifecycle, content_sha256 FROM ${spec.table}
           WHERE id = ? AND ${spec.assetColumn} = ?`
        )
        .get(change.baseRevisionId, change.assetId) as DbRow | undefined;
      if (
        !base ||
        base.lifecycle !== 'current' ||
        base.content_sha256 !== change.baseRevisionSha256
      ) {
        this.markStale(amendment.id, {
          code: 'base_revision_changed',
          assetType: change.assetType,
          assetId: change.assetId,
        });
        throw new Error('Amendment base revision changed');
      }
    }
  }

  private markStale(amendmentId: string, reason: Record<string, unknown>): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE authoring_amendments
         SET state = 'stale', stale_reason_json = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND state NOT IN ('activated','rejected','failed','stale')`
      )
      .run(stableStringify(reason), now, now, amendmentId);
  }

  private assertDecisionsApplied(amendmentId: string): void {
    const pending = this.db
      .prepare(
        `SELECT 1 FROM authoring_amendment_decisions AS links
         JOIN decision_requests AS requests ON requests.id = links.decision_id
         WHERE links.amendment_id = ? AND requests.status != 'applied' LIMIT 1`
      )
      .get(amendmentId);
    if (pending) throw new Error('Required impact decision has not been applied');
  }

  private hasUnsafeBrowserOperation(jobId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM external_task_links
           WHERE context_type = 'authoring' AND context_id = ?
             AND service = 'proxy_adapter' AND kind = 'browser_operation'
             AND (external_state IS NULL OR external_state NOT IN (
               'succeeded','failed','cancelled','outcome_unknown'
             )) LIMIT 1`
        )
        .get(jobId)
    );
  }

  private areAllCandidatesCurrent(amendment: AmendmentRecord): boolean {
    return amendment.changes.every((raw) => {
      const change = raw as unknown as {
        assetType: SemanticAssetType;
        assetId: string;
        candidateRevisionId: string;
      };
      const spec = REVISION_SPECS[change.assetType];
      const candidate = this.db
        .prepare(
          `SELECT lifecycle FROM ${spec.table}
           WHERE id = ? AND ${spec.assetColumn} = ?`
        )
        .get(change.candidateRevisionId, change.assetId) as { lifecycle: string } | undefined;
      return candidate?.lifecycle === 'current';
    });
  }

  private updateAmendmentState(
    amendmentId: string,
    from: AmendmentState,
    to: AmendmentState,
    now: string,
    options: { failure?: Record<string, unknown> } = {}
  ): void {
    const result = this.db
      .prepare(
        `UPDATE authoring_amendments
         SET state = ?, queued_at = CASE WHEN ? = 'queued_at_safe_boundary' THEN ? ELSE queued_at END,
             verification_started_at = CASE WHEN ? = 'verifying' THEN ? ELSE verification_started_at END,
             completed_at = CASE WHEN ? IN ('activated','rejected','failed','stale') THEN ? ELSE completed_at END,
             failure_json = COALESCE(?, failure_json), updated_at = ?
         WHERE id = ? AND state = ?`
      )
      .run(
        to,
        to,
        now,
        to,
        now,
        to,
        now,
        options.failure ? stableStringify(options.failure) : null,
        now,
        amendmentId,
        from
      );
    if (Number(result.changes) !== 1) throw new Error('Amendment state changed concurrently');
  }

  private nextEventSeq(jobId: string): number {
    const job = this.db
      .prepare('SELECT next_event_seq FROM authoring_jobs WHERE id = ?')
      .get(jobId) as { next_event_seq: number | bigint } | undefined;
    if (!job) throw new Error('Authoring job not found');
    return Number(job.next_event_seq);
  }

  private appendEvent(
    jobId: string,
    seq: number,
    type: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
    now: string
  ): void {
    const job = this.db
      .prepare('SELECT state_version, next_event_seq FROM authoring_jobs WHERE id = ?')
      .get(jobId) as
      | { state_version: number | bigint; next_event_seq: number | bigint }
      | undefined;
    if (!job || Number(job.next_event_seq) !== seq) {
      throw new Error('Authoring event sequence changed concurrently');
    }
    this.db
      .prepare('UPDATE authoring_jobs SET next_event_seq = next_event_seq + 1 WHERE id = ?')
      .run(jobId);
    this.db
      .prepare(
        `INSERT INTO authoring_events
          (id, job_id, seq, schema_version, type, entity_type, entity_id,
           state_version, payload_json, occurred_at, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        jobId,
        seq,
        type,
        entityType,
        entityId,
        Number(job.state_version),
        stableStringify(payload),
        now,
        now
      );
  }
}

function classifyScopeExpansion(
  thread: DbRow,
  changes: AuthoringAmendmentChangeInput[]
): Array<'same_page_other_module' | 'cross_url'> {
  const kinds = new Set<'same_page_other_module' | 'cross_url'>();
  for (const change of changes) {
    if (change.targetUrl !== thread.current_url_redacted) {
      kinds.add('cross_url');
    } else if (
      ['page_definition', 'business_module', 'page_baseline'].includes(change.assetType) ||
      (change.targetFunctionalModuleId &&
        change.targetFunctionalModuleId !== thread.current_functional_module_id)
    ) {
      kinds.add('same_page_other_module');
    }
  }
  return [...kinds];
}

function buildImpact(thread: DbRow, params: CreateAuthoringAmendmentParams) {
  return {
    affectedUrls: [...new Set(params.changes.map((change) => change.targetUrl))],
    affectedPageDefinitionIds: [
      ...new Set(params.changes.map((change) => change.targetPageDefinitionId)),
    ],
    affectedFunctionalModuleIds: [
      ...new Set(
        params.changes
          .map((change) => change.targetFunctionalModuleId)
          .filter((value): value is string => Boolean(value))
      ),
    ],
    affectedAssets: params.changes.map((change) => ({
      assetType: change.assetType,
      assetId: change.assetId,
      baseRevisionId: change.baseRevisionId,
      targetRevisionId: change.candidateRevisionId,
      category: change.category,
    })),
    currentScope: {
      url: thread.current_url_redacted,
      pageDefinitionId: thread.current_page_definition_id,
      functionalModuleId: thread.current_functional_module_id,
    },
    potentialSideEffects: params.potentialSideEffects ?? {},
    validationPlan: params.validationPlan,
  };
}

function toActivationParams(
  raw: Record<string, unknown>,
  authoringJobId: string,
  correlationId?: string
): ActivateSemanticRevisionParams {
  return {
    assetType: raw.assetType as SemanticAssetType,
    revisionId: String(raw.candidateRevisionId),
    dependencies: (raw.dependencies as SemanticDependencyEdge[] | undefined) ?? [],
    ...(raw.verificationScopeSha256
      ? { verificationScopeSha256: String(raw.verificationScopeSha256) }
      : {}),
    ...(raw.dependencyClosureSha256
      ? { dependencyClosureSha256: String(raw.dependencyClosureSha256) }
      : {}),
    authoringJobId,
    ...(correlationId ? { correlationId } : {}),
  };
}

function mapRow(row: DbRow): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (key.endsWith('_json_redacted')) {
        return [toCamelCase(key.slice(0, -14) + '_redacted'), parseJson(value)];
      }
      if (key.endsWith('_json')) return [toCamelCase(key.slice(0, -5)), parseJson(value)];
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

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
