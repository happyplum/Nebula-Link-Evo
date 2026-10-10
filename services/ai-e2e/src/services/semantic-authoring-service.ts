import type { CreateAuthoringJobResult } from '../contracts/semantic-authoring.js';
import type { AmendmentCategory, AmendmentRecord } from '../contracts/semantic-authoring.js';
import type {
  AuthoringAmendmentChangeInput,
  AuthoringAmendmentRepository,
  AuthoringContextScope,
} from '../database/repositories/authoring-amendment-repository.js';
import type {
  CreateSemanticRevisionParams,
  SemanticAssetRepository,
  SemanticRevisionRecord,
} from '../database/repositories/semantic-asset-repository.js';
import { hashValue } from '../database/repositories/semantic-repository-utils.js';
import type { SemanticWorkflowRepository } from '../database/repositories/semantic-workflow-repository.js';
import { DomainError } from './service-error.js';
import type { BusinessVersionRepository } from '../database/repositories/business-version-repository.js';

export type AuthoringMode = 'bootstrap' | 'recheck' | 'repair';

export interface CreateAuthoringJobInput {
  businessVersionId: string;
  mode: AuthoringMode;
  intent?: 'author_assets' | 'locate_in_browser';
  idempotencyKey: string;
  targetType?: string;
  targetId?: string;
  currentUrl?: string;
  parentRunId?: string;
  reason?: string;
  createdBy: string;
}

export interface CreateAmendmentInput {
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

export class SemanticAuthoringService {
  constructor(
    private readonly workflows: SemanticWorkflowRepository,
    private readonly assets: SemanticAssetRepository,
    private readonly amendments: AuthoringAmendmentRepository,
    private readonly versions: BusinessVersionRepository
  ) {}

  createJob(input: CreateAuthoringJobInput): CreateAuthoringJobResult {
    const version = this.versions.findById(input.businessVersionId);
    if (!version) {
      throw new DomainError('not_found', `Business version '${input.businessVersionId}' not found`);
    }
    const job = this.workflows.createAuthoringJob({
      projectId: version.projectId,
      businessVersionId: input.businessVersionId,
      mode: input.mode,
      idempotencyKey: input.idempotencyKey,
      stage: stageForMode(input.mode),
      strategyVersion: 'semantic-v1',
      sourceFingerprint: hashValue({
        mode: input.mode,
        intent: input.intent ?? 'author_assets',
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        currentUrl: input.currentUrl ?? null,
        reason: input.reason ?? null,
      }),
      input: {
        intent: input.intent ?? 'author_assets',
        requestedBy: input.createdBy,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        currentUrl: input.currentUrl ?? null,
        reason: input.reason ?? null,
      },
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      createdBy: input.createdBy,
    });
    const task = this.workflows.createAuthoringTask({
      jobId: job.id,
      taskKey: initialTaskKey(input),
      type: initialTaskType(input.mode),
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
      inputRedacted: {
        mode: input.mode,
        intent: input.intent ?? 'author_assets',
        requestedBy: input.createdBy,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        currentUrl: input.currentUrl ?? null,
        reason: input.reason ?? null,
        output: 'structured_authoring_amendment',
      },
      toolPolicyHash: hashValue({
        allow:
          input.intent === 'locate_in_browser'
            ? ['browser-control.operation_execute']
            : ['browser-control.operation_execute', 'vision.analyze_page', 'vision.resolve_target'],
        mutation: input.intent === 'locate_in_browser' ? 'navigation_only' : 'candidate_only',
      }),
      skillPolicyHash: hashValue({ skill: 'semantic-authoring', version: 1 }),
      budget: { maxAttempts: 3, maxToolCalls: 24 },
    });
    return { ...job, taskId: task.id };
  }

  commandJob(input: {
    commandId: string;
    jobId: string;
    action: 'pause' | 'resume' | 'cancel';
    expectedStateVersion: number;
    reason?: string;
    createdBy: string;
  }) {
    if (input.action === 'resume')
      this.workflows.assertAuthoringExecutionAllowed(input.jobId, undefined, true);
    const accepted = this.workflows.acceptAuthoringCommand({
      id: input.commandId,
      jobId: input.jobId,
      type: input.action,
      expectedStateVersion: input.expectedStateVersion,
      payload: { reason: input.reason ?? null },
      createdBy: input.createdBy,
    });
    if (accepted.status === 'rejected') {
      throw new DomainError(
        'conflict',
        `Authoring state version conflict; actual=${accepted.stateVersion}`
      );
    }
    const target =
      input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'running' : 'cancelling';
    return this.workflows.applyAuthoringTransition(input.commandId, target, {
      action: input.action,
      reason: input.reason ?? null,
    });
  }

  createThread(input: {
    jobId: string;
    businessVersionId: string;
    scope: AuthoringContextScope;
    createdBy: string;
  }) {
    return this.amendments.createContextThread(input);
  }

  createRevision(input: CreateSemanticRevisionParams): SemanticRevisionRecord {
    return this.assets.createRevision(input);
  }

  createAmendment(input: CreateAmendmentInput) {
    return this.amendments.createAmendment(input);
  }

  listAmendments(jobId: string): AmendmentRecord[] {
    return this.amendments.listAmendments(jobId);
  }

  getAmendment(amendmentId: string): AmendmentRecord {
    const amendment = this.amendments.getAmendment(amendmentId);
    if (!amendment)
      throw new DomainError('not_found', `Authoring amendment '${amendmentId}' not found`);
    return amendment;
  }

  answerDecision(input: {
    amendmentId: string;
    decisionId: string;
    answer: 'approve' | 'reject';
    reason: string;
    answeredBy: string;
  }): AmendmentRecord {
    return this.amendments.answerDecision(input);
  }

  command(
    amendmentId: string,
    input: { action: 'queue_at_safe_boundary' } | { action: 'reject'; reason: string }
  ): AmendmentRecord {
    switch (input.action) {
      case 'queue_at_safe_boundary':
        return this.amendments.queueAtSafeBoundary(amendmentId);
      case 'reject':
        return this.amendments.reject(amendmentId, input.reason);
    }
  }
}

function stageForMode(mode: AuthoringMode): string {
  switch (mode) {
    case 'bootstrap':
      return 'ingest_prd';
    case 'recheck':
      return 'validate_version';
    case 'repair':
      return 'analyze_impact';
  }
}

function initialTaskType(mode: AuthoringMode) {
  switch (mode) {
    case 'bootstrap':
      return 'ingest_prd' as const;
    case 'recheck':
      return 'validate_version' as const;
    case 'repair':
      return 'analyze_impact' as const;
  }
}

function initialTaskKey(input: CreateAuthoringJobInput): string {
  const target = input.targetId ? `:${input.targetId}` : '';
  return `${initialTaskType(input.mode)}${target}`;
}
