import type { AgentTaskProblem, AgentTaskToolCallSummary, AgentTaskUsage } from './types.js';

export interface AgentTaskFailureTrace {
  toolCalls: AgentTaskToolCallSummary[];
  usage?: AgentTaskUsage;
}

export type AgentTaskErrorCode =
  | 'validation_failed'
  | 'conflict'
  | 'not_found'
  | 'dependency_unavailable'
  | 'budget_exceeded'
  | 'tool_not_allowed'
  | 'outcome_unknown'
  | 'execution_failed';

const STATUS_BY_CODE: Record<AgentTaskErrorCode, number> = {
  validation_failed: 400,
  conflict: 409,
  not_found: 404,
  dependency_unavailable: 503,
  budget_exceeded: 422,
  tool_not_allowed: 403,
  outcome_unknown: 502,
  execution_failed: 502,
};

export class AgentTaskError extends Error {
  readonly statusCode: number;
  private trace?: AgentTaskFailureTrace;

  constructor(
    readonly code: AgentTaskErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AgentTaskError';
    this.statusCode = STATUS_BY_CODE[code];
  }

  toProblem(): AgentTaskProblem {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }

  withExecutionTrace(trace: AgentTaskFailureTrace): this {
    this.trace = trace;
    return this;
  }

  get executionTrace(): AgentTaskFailureTrace | undefined {
    return this.trace;
  }
}

export function toAgentTaskError(error: unknown): AgentTaskError {
  if (error instanceof AgentTaskError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new AgentTaskError(
      'budget_exceeded',
      'Agent task duration budget was exceeded',
      false,
      undefined,
      {
        cause: error,
      }
    );
  }
  return new AgentTaskError(
    'execution_failed',
    error instanceof Error ? error.message : 'Unknown Agent task execution failure',
    false,
    undefined,
    { cause: error }
  );
}
