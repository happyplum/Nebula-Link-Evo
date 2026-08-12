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
export type BrowserOperationKind = 'observe' | 'act';

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
  effectId?: string;
  maxAffectedItems?: number;
  capture?: {
    beforeScreenshot?: boolean;
    afterScreenshot?: boolean;
    domSnapshot?: boolean;
    videoSegment?: boolean;
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
}

export interface AgentTaskExecutionContext {
  taskId: string;
  request: CreateAgentTaskRequest;
  deadlineAt: number;
  signal: AbortSignal;
}

export interface AgentTaskExecutor {
  execute(context: AgentTaskExecutionContext): Promise<AgentTaskExecutionResult>;
}
