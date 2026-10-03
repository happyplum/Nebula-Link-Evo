import type {
  CreateAgentTaskRequest,
  AgentTaskUsage,
  AgentTaskToolCallSummary,
  AgentTaskBrowserBinding,
  AgentTaskBrowserStep,
} from '@nebula-link-evo/shared/types/agent-task';
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
  browserSteps: ReadonlyMap<string, AgentTaskBrowserStep>;
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
