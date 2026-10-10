import { randomUUID } from 'node:crypto';
import type { BrowserExecutionProblem } from './types.js';

export type BrowserExecutionErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'state_conflict'
  | 'idempotency_conflict'
  | 'permission_denied'
  | 'browser_busy'
  | 'lease_expired'
  | 'dependency_unavailable'
  | 'outcome_unknown'
  | 'internal_error';

const STATUS_BY_CODE: Record<BrowserExecutionErrorCode, number> = {
  validation_failed: 400,
  not_found: 404,
  state_conflict: 409,
  idempotency_conflict: 409,
  permission_denied: 403,
  browser_busy: 409,
  lease_expired: 410,
  dependency_unavailable: 503,
  outcome_unknown: 409,
  internal_error: 500,
};

export class BrowserExecutionError extends Error {
  readonly statusCode: number;
  readonly code: BrowserExecutionErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: BrowserExecutionErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = 'BrowserExecutionError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function toBrowserExecutionProblem(
  error: unknown,
  correlationId: string = randomUUID()
): BrowserExecutionProblem {
  if (error instanceof BrowserExecutionError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      correlationId,
      ...(error.details ? { details: error.details } : {}),
    };
  }

  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : 'Unexpected browser execution error',
    retryable: false,
    correlationId,
  };
}
