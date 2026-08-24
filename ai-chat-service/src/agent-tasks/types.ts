import type {
  BrowserOperationKind,
  BrowserTargetRefV1,
} from '@nebula-link-evo/shared/types/browser-execution';

export const AGENT_TASK_SCHEMA = 'nebula.ai.agent-task/1.0' as const;

export const AGENT_TASK_STATUSES = [
  'created',
  'running',
  'paused',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
  'blocked',
] as const;

export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];
export type { BrowserOperationKind } from '@nebula-link-evo/shared/types/browser-execution';

export interface AgentTaskBrowserBinding {
  browserSessionId: string;
  tabId: string;
  browserLeaseId: string;
  browserLeaseToken: string;
  browserLeaseSequence: number;
  access: 'observe' | 'control';
}

export interface AgentTaskBrowserStep {
  stepId: string;
  kind: BrowserOperationKind;
  operation: string;
  target?: BrowserTargetRefV1;
  args?: Record<string, unknown>;
  effectId?: string;
  maxAffectedItems?: number;
  capture?: {
    beforeScreenshot?: boolean;
    afterScreenshot?: boolean;
    domSnapshot?: boolean;
    videoSegment?: boolean;
  };
}

export interface AgentTaskSideEffectAuthorization {
  contextType: 'run' | 'authoring';
  contextId: string;
  environment: 'local' | 'test' | 'staging' | 'production';
  policyVersion: string;
  policyEvaluationId: string;
  policyResult: 'auto_allowed' | 'approval_required';
  projectionSha256: string;
  effects: Array<{
    stepId: string;
    effectId: string;
    kind: 'create' | 'update' | 'delete' | 'auth_change';
    maxAffectedItems: number;
    reversibility: 'reversible' | 'compensatable' | 'irreversible';
  }>;
  grant?: {
    grantId: string;
    status: 'active';
    approvedProjectionSha256: string;
  };
}

export interface CreateAgentTaskRequest {
  schema: typeof AGENT_TASK_SCHEMA;
  clientTaskId: string;
  modelRole: 'decision';
  input: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  toolPolicy: {
    allow: string[];
    constraints?: Record<string, unknown>;
  };
  skillPolicy: {
    allow: Array<{
      skillId: string;
      version: string;
      contentHash: string;
    }>;
  };
  budgets: {
    maxDurationMs: number;
    maxModelTurns: number;
    maxToolCalls: number;
    maxTokens?: number;
  };
  browserBinding?: AgentTaskBrowserBinding;
  sideEffectAuthorization?: AgentTaskSideEffectAuthorization;
  correlation?: Record<string, string>;
}

export interface PersistedAgentTaskRequest extends Omit<CreateAgentTaskRequest, 'browserBinding'> {
  browserBinding?: Omit<AgentTaskBrowserBinding, 'browserLeaseToken'>;
}

export interface AgentTaskUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  modelTurns: number;
  toolCalls: number;
}

export interface AgentTaskToolCallSummary {
  toolCallId: string;
  toolName: string;
  status: 'succeeded' | 'failed' | 'outcome_unknown';
  stepId?: string;
  operationId?: string;
  operation?: string;
  effectId?: string;
  errorCode?: string;
}

export interface AgentTaskProblem {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface AgentTaskView {
  schema: typeof AGENT_TASK_SCHEMA;
  taskId: string;
  clientTaskId: string;
  status: AgentTaskStatus;
  stateVersion: number;
  eventSeq: number;
  lastCheckpointId?: string;
  modelRole: 'decision';
  request: PersistedAgentTaskRequest;
  output?: unknown;
  error?: AgentTaskProblem;
  terminationReason?: string;
  usage?: AgentTaskUsage;
  toolCalls: AgentTaskToolCallSummary[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentTaskExecutionResult {
  output: unknown;
  usage: AgentTaskUsage;
  toolCalls: AgentTaskToolCallSummary[];
  terminationReason: string;
  harness?: AgentTaskHarnessCommit;
}

export interface AgentTaskHarnessCommit {
  sessionId: string;
  durableSeq: number;
  durableRevision: string;
  resultCallId: string;
  resultHash: string;
  events: Array<{ seq: number; type: string }>;
}

export interface AgentTaskSkillExecution {
  skillId: string;
  version: string;
  contentHash: string;
  description: string;
  instructions: string;
  requiredToolPatterns: string[];
  effectiveToolAllow: string[];
  effectiveBudgets: {
    maxModelTurns: number;
    maxToolCalls: number;
    maxTokens?: number;
  };
  policySha256: string;
}

export interface AgentTaskExecutionContext {
  taskId: string;
  request: CreateAgentTaskRequest;
  deadlineAt: number;
  signal: AbortSignal;
  skill?: AgentTaskSkillExecution;
  harnessProjectedSeq?: number;
  beforeToolCall(): void;
  shouldPause?(): boolean;
  emitEvent(type: string, payload: Record<string, unknown>): void;
  persistPendingResult(callId: string, resultHash: string, output: unknown): void;
  reserveTokenBudget?(
    reservationId: string,
    totalBudget: number,
    estimatedInput: number,
    requestedOutput: number
  ): number;
  settleTokenBudget?(reservationId: string, inputTokens: number, outputTokens: number): void;
  persistOperation?(operation: AgentTaskOperationReservation): void;
  markOperationDispatched?(toolCallId: string): void;
  settleOperation?(
    toolCallId: string,
    status: 'succeeded' | 'failed' | 'outcome_unknown',
    proxyStatus?: string
  ): void;
  registerOperationCanceller?(cancel: () => Promise<void>): () => void;
}

export interface AgentTaskOperationReservation {
  toolCallId: string;
  operationId: string;
  toolName: string;
  requestHash: string;
  canonicalArgs: Record<string, unknown>;
  quantity: {
    browserOperations: 1;
    affectedItems: 1;
    sideEffectUnits: 0 | 1;
  };
  authorization: Record<string, unknown>;
  browserBinding: Omit<AgentTaskBrowserBinding, 'browserLeaseToken'>;
}

export interface AgentTaskExecutor {
  execute(context: AgentTaskExecutionContext): Promise<AgentTaskExecutionResult>;
}
