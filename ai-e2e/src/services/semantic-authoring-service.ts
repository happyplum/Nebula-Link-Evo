import type {
  AuthoringAmendmentChangeInput,
  AuthoringAmendmentRepository,
  AuthoringContextScope,
  AmendmentCategory,
  AmendmentRecord,
} from '../database/repositories/authoring-amendment-repository.js';
import type {
  CreateSemanticRevisionParams,
  SemanticAssetRepository,
  SemanticRevisionRecord,
} from '../database/repositories/semantic-asset-repository.js';
import { hashValue } from '../database/repositories/semantic-repository-utils.js';
import type {
  SemanticWorkflowRepository,
  AuthoringJobResult,
} from '../database/repositories/semantic-workflow-repository.js';
import { ServiceError } from './service-error.js';
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

  createJob(input: CreateAuthoringJobInput): AuthoringJobResult & { taskId: string } {
    try {
      const version = this.versions.findById(input.businessVersionId);
      if (!version) {
        throw ServiceError.notFound(`Business version '${input.businessVersionId}' not found`);
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
              : [
                  'browser-control.operation_execute',
                  'vision.analyze_page',
                  'vision.resolve_target',
                ],
          mutation: input.intent === 'locate_in_browser' ? 'navigation_only' : 'candidate_only',
        }),
        skillPolicyHash: hashValue({ skill: 'semantic-authoring', version: 1 }),
        budget: { maxAttempts: 3, maxToolCalls: 24 },
      });
      return { ...job, taskId: task.id };
    } catch (error) {
      throw mapSemanticError(error);
    }
  }

  commandJob(input: {
    commandId: string;
    jobId: string;
    action: 'pause' | 'resume' | 'cancel';
    expectedStateVersion: number;
    reason?: string;
    createdBy: string;
  }) {
    try {
      const accepted = this.workflows.acceptAuthoringCommand({
        id: input.commandId,
        jobId: input.jobId,
        type: input.action,
        expectedStateVersion: input.expectedStateVersion,
        payload: { reason: input.reason ?? null },
        createdBy: input.createdBy,
      });
      if (accepted.status === 'rejected') {
        throw ServiceError.conflict(
          `Authoring state version conflict; actual=${accepted.stateVersion}`
        );
      }
      const target =
        input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'running' : 'cancelling';
      return this.workflows.applyAuthoringTransition(input.commandId, target, {
        action: input.action,
        reason: input.reason ?? null,
      });
    } catch (error) {
      throw mapSemanticError(error);
    }
  }

  createThread(input: {
    jobId: string;
    businessVersionId: string;
    scope: AuthoringContextScope;
    createdBy: string;
  }) {
    try {
      return this.amendments.createContextThread(input);
    } catch (error) {
      throw mapSemanticError(error);
    }
  }

  createRevision(input: CreateSemanticRevisionParams): SemanticRevisionRecord {
    try {
      return this.assets.createRevision(input);
    } catch (error) {
      throw mapSemanticError(error);
    }
  }

  createAmendment(input: CreateAmendmentInput) {
    try {
      return this.amendments.createAmendment(input);
    } catch (error) {
      throw mapSemanticError(error);
    }
  }

  listAmendments(jobId: string): AmendmentRecord[] {
    try {
      return this.amendments.listAmendments(jobId);
    } catch (error) {
      throw mapSemanticError(error);
    }
  }

  getAmendment(amendmentId: string): AmendmentRecord {
    const amendment = this.amendments.getAmendment(amendmentId);
    if (!amendment) throw ServiceError.notFound(`Authoring amendment '${amendmentId}' not found`);
    return amendment;
  }

  addChatMessage(input: {
    threadId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    amendmentId?: string;
    createdBy: string;
  }) {
    try {
      return this.amendments.addChatMessage(input);
    } catch (error) {
      throw mapSemanticError(error);
    }
  }

  listChatMessages(threadId: string) {
    try {
      return this.amendments.listChatMessages(threadId);
    } catch (error) {
      throw mapSemanticError(error);
    }
  }

  answerDecision(input: {
    amendmentId: string;
    decisionId: string;
    answer: 'approve' | 'reject';
    reason: string;
    answeredBy: string;
  }): AmendmentRecord {
    try {
      return this.amendments.answerDecision(input);
    } catch (error) {
      throw mapSemanticError(error);
    }
  }

  command(
    amendmentId: string,
    input: { action: 'queue_at_safe_boundary' } | { action: 'reject'; reason: string }
  ): AmendmentRecord {
    try {
      switch (input.action) {
        case 'queue_at_safe_boundary':
          return this.amendments.queueAtSafeBoundary(amendmentId);
        case 'reject':
          return this.amendments.reject(amendmentId, input.reason);
      }
    } catch (error) {
      throw mapSemanticError(error);
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

function mapSemanticError(error: unknown): Error {
  if (error instanceof ServiceError) return error;
  const message = error instanceof Error ? error.message : 'Semantic authoring operation failed';
  if (/not found|does not belong/i.test(message)) return ServiceError.notFound(message);
  if (
    /stale|state|current|writable|active|decision|safe boundary|already|conflict|unique constraint|Only a|cannot/i.test(
      message
    )
  ) {
    return ServiceError.conflict(message);
  }
  if (/required|must|invalid|sha-256|secret|At least/i.test(message)) {
    return ServiceError.validation(message);
  }
  return ServiceError.internal(message);
}
