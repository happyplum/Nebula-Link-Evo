import { randomUUID } from 'node:crypto';
import type { CreateAgentTaskRequest } from '@nebula-link-evo/shared/types/agent-task';
import type { SemanticAssetType } from '../../contracts/semantic-control.js';
import { DomainError } from '../../services/service-error.js';
import {
  SIDE_EFFECT_POLICY_VERSION,
  evaluateSideEffectPolicy,
} from '../../policy/side-effect-policy.js';
import { buildAuthoringVerificationPlan } from '../../policy/authoring-verification-plan.js';
import { BusinessVersionRepository } from './business-version-repository.js';
import { SemanticQueryRepository } from './semantic-query-repository.js';
import {
  assertNoInlineSecrets,
  hashValue,
  inImmediateTransaction,
  requireSha256,
  stableStringify,
  type DatabaseLike,
  type SupportedDatabase,
} from './semantic-repository-utils.js';
export type SemanticContext = { type: 'run' | 'authoring'; id: string };
type DbRow = Record<string, unknown>;
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

export class SemanticPolicyRepository {
  private readonly db: DatabaseLike;
  constructor(private readonly database: SupportedDatabase) {
    this.db = database as unknown as DatabaseLike;
  }

  getEvaluation(id: unknown): DbRow | undefined {
    return id
      ? (this.db.prepare('SELECT * FROM side_effect_policy_evaluations WHERE id = ?').get(id) as
          DbRow | undefined)
      : undefined;
  }
  getLatestEvaluation(context: SemanticContext): DbRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM side_effect_policy_evaluations WHERE context_type = ? AND context_id = ? ORDER BY rowid DESC LIMIT 1'
      )
      .get(context.type, context.id) as DbRow | undefined;
  }
  getGrant(id: unknown): DbRow | undefined {
    return id
      ? (this.db.prepare('SELECT * FROM side_effect_approval_grants WHERE id = ?').get(id) as
          DbRow | undefined)
      : undefined;
  }
  getActiveGrant(context: SemanticContext): DbRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM side_effect_approval_grants WHERE context_type = ? AND context_id = ? AND status = 'active'"
      )
      .get(context.type, context.id) as DbRow | undefined;
  }
  /** Runs inside the caller's business transaction; never starts a nested BEGIN. */
  invalidate(
    context: SemanticContext,
    reason: string,
    now = new Date().toISOString(),
    evaluationId?: string
  ): void {
    this.db
      .prepare(
        "UPDATE side_effect_approval_grants SET status = 'expired', expired_at = ?, reason_json = ? WHERE context_type = ? AND context_id = ? AND status = 'active' AND (? IS NULL OR evaluation_id = ?)"
      )
      .run(
        now,
        stableStringify({ code: reason }),
        context.type,
        context.id,
        evaluationId ?? null,
        evaluationId ?? null
      );
  }
  decisionFacts(evaluation: DbRow): DbRow {
    return {
      evaluationId: evaluation.id,
      contextType: evaluation.context_type,
      contextId: evaluation.context_id,
      businessVersionId: evaluation.business_version_id,
      deploymentRevisionId: evaluation.deployment_revision_id,
      environment: evaluation.environment,
      policyVersion: evaluation.policy_version,
      sourcePlanSha256: evaluation.source_plan_sha256,
      projectionSha256: evaluation.projection_sha256,
      projection: JSON.parse(String(evaluation.projection_json_redacted)),
    };
  }
  approve(
    evaluation: DbRow,
    decisionId: string,
    answerId: string,
    approvedBy: string,
    reason: string,
    now: string
  ): string {
    const decision = this.db
      .prepare('SELECT * FROM decision_requests WHERE id = ?')
      .get(decisionId) as DbRow | undefined;
    const facts = decision ? (JSON.parse(String(decision.facts_json)) as DbRow) : {};
    const answer = this.db.prepare('SELECT * FROM decision_answers WHERE id = ?').get(answerId) as
      DbRow | undefined;
    if (
      !decision ||
      decision.category !== 'side_effect_approval' ||
      decision.status !== 'applied' ||
      decision.context_type !== evaluation.context_type ||
      decision.context_id !== evaluation.context_id ||
      !answer ||
      answer.decision_request_id !== decisionId ||
      answer.answer_key !== 'approve' ||
      evaluation.result !== 'approval_required' ||
      facts.projectionSha256 !== evaluation.projection_sha256 ||
      facts.sourcePlanSha256 !== evaluation.source_plan_sha256 ||
      facts.deploymentRevisionId !== evaluation.deployment_revision_id ||
      facts.policyVersion !== evaluation.policy_version
    )
      throw new DomainError(
        'conflict',
        'Side-effect approval does not match the frozen policy',
        'side_effect_approval_stale'
      );
    const existing = this.db
      .prepare('SELECT id, status FROM side_effect_approval_grants WHERE decision_answer_id = ?')
      .get(answerId) as DbRow | undefined;
    if (existing) {
      if (existing.status !== 'active')
        throw new DomainError(
          'conflict',
          'Side-effect approval is inactive',
          'side_effect_approval_revoked'
        );
      return String(existing.id);
    }
    this.invalidate(
      {
        type: evaluation.context_type as SemanticContext['type'],
        id: String(evaluation.context_id),
      },
      'superseded',
      now
    );
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO side_effect_approval_grants (id, evaluation_id, context_type, context_id, business_version_id, deployment_revision_id, policy_version, approved_projection_json_redacted, approved_projection_sha256, decision_request_id, decision_answer_id, status, approved_by, approved_at, reason_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(
        id,
        evaluation.id,
        evaluation.context_type,
        evaluation.context_id,
        evaluation.business_version_id,
        evaluation.deployment_revision_id,
        evaluation.policy_version,
        evaluation.projection_json_redacted,
        evaluation.projection_sha256,
        decisionId,
        answerId,
        approvedBy,
        now,
        stableStringify({ reason })
      );
    return id;
  }
  check(
    evaluation: DbRow | undefined,
    expected: {
      context: SemanticContext;
      businessVersionId: string;
      deploymentRevisionId: string;
      sourcePlanSha256: string;
      projectionSha256: string;
      policyVersion: string;
    },
    grantId?: unknown
  ): { ok: true } | { ok: false; code: string; message: string } {
    const fail = (code: string, message: string) => ({ ok: false as const, code, message });
    if (
      !evaluation ||
      evaluation.context_type !== expected.context.type ||
      evaluation.context_id !== expected.context.id ||
      evaluation.business_version_id !== expected.businessVersionId ||
      evaluation.deployment_revision_id !== expected.deploymentRevisionId ||
      evaluation.source_plan_sha256 !== expected.sourcePlanSha256 ||
      evaluation.projection_sha256 !== expected.projectionSha256 ||
      evaluation.policy_version !== expected.policyVersion ||
      expected.policyVersion !== SIDE_EFFECT_POLICY_VERSION
    )
      return fail(
        'side_effect_approval_stale',
        'Side-effect approval is stale: risk projection changed or policy binding differs'
      );
    if (evaluation.result === 'denied')
      return fail('side_effect_policy_denied', 'Side-effect policy denied execution');
    const row = this.db
      .prepare(
        `SELECT lifecycle FROM ${expected.context.type === 'run' ? 'test_runs' : 'authoring_jobs'} WHERE id = ?`
      )
      .get(expected.context.id) as DbRow | undefined;
    if (
      !row ||
      ['completed', 'cancelled', 'failed', 'cancelling'].includes(String(row.lifecycle))
    ) {
      this.invalidate(expected.context, 'context_terminated');
      return fail('side_effect_approval_stale', 'Side-effect authorization context terminated');
    }
    if (evaluation.result === 'auto_allowed') return { ok: true };
    const grant = this.getGrant(grantId);
    if (!grant)
      return fail('side_effect_approval_required', 'Side-effect approval grant is required');
    if (grant.status !== 'active')
      return fail(
        grant.status === 'revoked' ? 'side_effect_approval_revoked' : 'side_effect_approval_stale',
        'Side-effect approval grant is inactive or stale'
      );
    if (
      grant.evaluation_id !== evaluation.id ||
      grant.context_type !== expected.context.type ||
      grant.context_id !== expected.context.id ||
      grant.business_version_id !== expected.businessVersionId ||
      grant.deployment_revision_id !== expected.deploymentRevisionId ||
      grant.policy_version !== expected.policyVersion ||
      grant.approved_projection_sha256 !== expected.projectionSha256
    )
      return fail('side_effect_approval_stale', 'Side-effect approval grant binding differs');
    return { ok: true };
  }
  getRunPolicyColumns(run: DbRow): DbRow {
    const evaluation = this.getEvaluation(run.current_policy_evaluation_id);
    const grant = this.getGrant(run.active_approval_grant_id);
    return {
      policy_version: evaluation?.policy_version,
      policy_result: evaluation?.result,
      policy_projection_sha256: evaluation?.projection_sha256,
      approval_grant_status: grant?.status,
      approved_projection_sha256: grant?.approved_projection_sha256,
    };
  }
  buildAuthoringPlan(amendmentId: string) {
    const amendment = this.db
      .prepare(
        'SELECT a.*, j.business_version_id FROM authoring_amendments a JOIN authoring_jobs j ON j.id = a.job_id WHERE a.id = ?'
      )
      .get(amendmentId) as DbRow | undefined;
    if (!amendment) throw new DomainError('not_found', 'Authoring amendment not found');
    const queries = new SemanticQueryRepository(
      this.database,
      new BusinessVersionRepository(this.database)
    );
    const workspace = queries.getWorkspace(String(amendment.business_version_id));
    const deployment = queries.getDefaultDeployment(String(amendment.business_version_id));
    if (!workspace || !deployment)
      throw new DomainError('conflict', 'Authoring verification scope is missing');
    const changes = this.db
      .prepare('SELECT * FROM authoring_amendment_changes WHERE amendment_id = ? ORDER BY sequence')
      .all(amendmentId) as DbRow[];
    const candidates = changes.map((change) => {
      const assetType = change.asset_type as SemanticAssetType;
      const revision = queries.getRevision(
        assetType,
        String(change.asset_id),
        String(change.candidate_revision_id)
      );
      if (!revision) throw new DomainError('conflict', 'Authoring candidate revision is missing');
      return {
        assetType,
        assetId: String(change.asset_id),
        revisionId: revision.id,
        payload: revision.payload,
      };
    });
    const plan = buildAuthoringVerificationPlan(candidates, workspace);
    const projection = {
      contextType: 'authoring',
      contextId: String(amendment.job_id),
      amendmentId,
      businessVersionId: String(amendment.business_version_id),
      deploymentRevisionId: deployment.revisionId,
      environment: deployment.environment,
      policyVersion: SIDE_EFFECT_POLICY_VERSION,
      effects: plan.effects,
    };
    const sourcePlanSha256 = hashValue({
      amendmentId,
      changes: changes.map((change) => ({
        assetType: change.asset_type,
        assetId: change.asset_id,
        baseRevisionId: change.base_revision_id,
        baseRevisionSha256: change.base_revision_sha256,
        candidateRevisionId: change.candidate_revision_id,
      })),
      candidates: candidates.map((candidate) => ({
        revisionId: candidate.revisionId,
        payloadSha256: hashValue(candidate.payload),
      })),
      scriptHashes: plan.scriptHashes,
      stepsSha256: hashValue(plan.steps),
      deploymentRevisionId: deployment.revisionId,
      deploymentSha256: hashValue(deployment.payload),
    });
    return { amendment, candidates, steps: plan.steps, projection, sourcePlanSha256, deployment };
  }
  getAuthoringEvaluation(amendmentId: string): DbRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM side_effect_policy_evaluations WHERE context_type = 'authoring' AND json_extract(projection_json_redacted, '$.amendmentId') = ? ORDER BY rowid DESC LIMIT 1"
      )
      .get(amendmentId) as DbRow | undefined;
  }
  getExactAuthoringEvaluation(
    plan: ReturnType<SemanticPolicyRepository['buildAuthoringPlan']>
  ): DbRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM side_effect_policy_evaluations WHERE context_type = 'authoring' AND context_id = ? AND source_plan_sha256 = ? AND projection_sha256 = ? AND deployment_revision_id = ? AND policy_version = ?"
      )
      .get(
        plan.amendment.job_id,
        plan.sourcePlanSha256,
        hashValue(plan.projection),
        plan.deployment.revisionId,
        SIDE_EFFECT_POLICY_VERSION
      ) as DbRow | undefined;
  }
  private rebuildAuthoringPlanForAuthorization(amendmentId: string) {
    try {
      return this.buildAuthoringPlan(amendmentId);
    } catch (cause) {
      if (cause instanceof DomainError) throw cause;
      const frozen = this.getAuthoringEvaluation(amendmentId);
      if (frozen)
        this.invalidate(
          { type: 'authoring', id: String(frozen.context_id) },
          'projection_stale',
          new Date().toISOString(),
          String(frozen.id)
        );
      const rejection = new DomainError(
        'conflict',
        'Frozen authoring verification plan can no longer be rebuilt',
        'side_effect_approval_stale'
      );
      Object.defineProperty(rejection, 'cause', { value: cause, configurable: true });
      throw rejection;
    }
  }

  assertAuthoringApprovalCurrent(amendmentId: string): void {
    const plan = this.rebuildAuthoringPlanForAuthorization(amendmentId);
    const evaluation = this.getExactAuthoringEvaluation(plan);
    const check = this.check(evaluation, {
      context: { type: 'authoring', id: String(plan.amendment.job_id) },
      businessVersionId: String(plan.amendment.business_version_id),
      deploymentRevisionId: plan.deployment.revisionId,
      sourcePlanSha256: plan.sourcePlanSha256,
      projectionSha256: hashValue(plan.projection),
      policyVersion: SIDE_EFFECT_POLICY_VERSION,
    });
    if (
      (!check.ok && check.code !== 'side_effect_approval_required') ||
      ['activated', 'failed', 'rejected', 'stale'].includes(String(plan.amendment.state))
    )
      throw new DomainError(
        'conflict',
        'Authoring side-effect approval is stale',
        'side_effect_approval_stale'
      );
  }
  freezeAuthoring(amendmentId: string): DbRow {
    const plan = this.buildAuthoringPlan(amendmentId);
    const evaluated = evaluateSideEffectPolicy(plan.deployment.environment, plan.projection);
    const recorded = this.recordPolicyEvaluation(
      {
        context: { type: 'authoring', id: String(plan.amendment.job_id) },
        businessVersionId: String(plan.amendment.business_version_id),
        deploymentRevisionId: plan.deployment.revisionId,
        policyVersion: SIDE_EFFECT_POLICY_VERSION,
        sourcePlanSha256: plan.sourcePlanSha256,
        projectionRedacted: plan.projection,
        result: evaluated.result,
        reasonCodes: evaluated.reasonCodes,
      },
      true
    );
    const evaluation = this.getEvaluation(recorded.id);
    if (!evaluation) throw new Error('Frozen authoring evaluation was not persisted');
    return evaluation;
  }
  requireAuthoringAuthorization(
    amendmentId: string
  ): NonNullable<CreateAgentTaskRequest['sideEffectAuthorization']> | undefined {
    const plan = this.rebuildAuthoringPlanForAuthorization(amendmentId);
    const evaluation = this.getExactAuthoringEvaluation(plan);
    const context = { type: 'authoring' as const, id: String(plan.amendment.job_id) };
    const grant = this.getActiveGrant(context);
    const checked = this.check(
      evaluation,
      {
        context,
        businessVersionId: String(plan.amendment.business_version_id),
        deploymentRevisionId: plan.deployment.revisionId,
        sourcePlanSha256: plan.sourcePlanSha256,
        projectionSha256: hashValue(plan.projection),
        policyVersion: SIDE_EFFECT_POLICY_VERSION,
      },
      grant?.id
    );
    if (
      !evaluation ||
      !checked.ok ||
      ['activated', 'rejected', 'failed', 'stale'].includes(String(plan.amendment.state))
    ) {
      const frozen = this.getAuthoringEvaluation(amendmentId);
      if (frozen)
        this.invalidate(context, 'projection_stale', new Date().toISOString(), String(frozen.id));
      throw new DomainError(
        'conflict',
        checked.ok ? 'Authoring candidate terminated' : checked.message,
        checked.ok ? 'side_effect_approval_stale' : checked.code
      );
    }
    if (plan.projection.effects.length === 0) return undefined;
    return {
      contextType: 'authoring',
      contextId: context.id,
      environment: plan.deployment.environment,
      policyVersion: SIDE_EFFECT_POLICY_VERSION,
      policyEvaluationId: String(evaluation.id),
      policyResult: evaluation.result as 'auto_allowed' | 'approval_required',
      projectionSha256: String(evaluation.projection_sha256),
      effects: plan.projection.effects.map(
        ({ stepId, effectId, kind, maxAffectedItems, reversibility, usesFileUpload }) => ({
          stepId,
          effectId,
          kind,
          maxAffectedItems,
          reversibility,
          usesFileUpload,
        })
      ),
      ...(evaluation.result === 'approval_required' && grant
        ? {
            grant: {
              grantId: String(grant.id),
              status: 'active' as const,
              approvedProjectionSha256: String(grant.approved_projection_sha256),
            },
          }
        : {}),
    };
  }
  recordPolicyEvaluation(
    params: RecordPolicyEvaluationParams,
    inTransaction = false
  ): { id: string; created: boolean } {
    assertNoInlineSecrets(params.projectionRedacted);
    requireSha256(params.sourcePlanSha256, 'sourcePlanSha256');
    const projectionJson = stableStringify(params.projectionRedacted);
    const projectionSha256 = hashValue(params.projectionRedacted);
    const work = () => {
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
    };
    return inTransaction ? work() : inImmediateTransaction(this.db, work);
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
        { business_version_id: string; deployment_revision_id: string } | undefined;
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
}
