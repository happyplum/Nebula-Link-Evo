import type { BrowserExecutionProblem } from '@nebula-link-evo/shared/types/browser-execution';

export class BrowserControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly correlationId?: string,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'BrowserControlError';
  }

  static fromProblem(
    problem: BrowserExecutionProblem,
    options?: ErrorOptions
  ): BrowserControlError {
    return new BrowserControlError(
      problem.code,
      problem.message,
      problem.retryable,
      problem.correlationId,
      problem.details,
      options
    );
  }
}

export class BrowserOutcomeUnknownError extends BrowserControlError {
  constructor(operationId: string, cause?: unknown) {
    super(
      'outcome_unknown',
      `Browser operation ${operationId} could not be proven terminal; retry is unsafe`,
      true,
      operationId,
      { operationId },
      cause === undefined ? undefined : { cause }
    );
    this.name = 'BrowserOutcomeUnknownError';
  }
}
