import type { ApiProblem, ApiSuccess } from '../../../../src/contracts/semantic-control.js';

export class ApiRequestError extends Error {
  readonly code?: string;
  readonly retryable?: boolean;
  readonly correlationId?: string;
  readonly details?: ApiProblem['details'];

  constructor(
    readonly status: number,
    problem?: ApiProblem
  ) {
    super(problem?.message ?? `请求失败（${status}）`);
    this.name = 'ApiRequestError';
    this.code = problem?.code;
    this.retryable = problem?.retryable;
    this.correlationId = problem?.correlationId;
    this.details = problem?.details;
  }
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<ApiSuccess<T>> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem =
      body &&
      typeof body === 'object' &&
      'code' in body &&
      typeof body.code === 'string' &&
      'message' in body &&
      typeof body.message === 'string' &&
      'retryable' in body &&
      typeof body.retryable === 'boolean' &&
      'correlationId' in body &&
      typeof body.correlationId === 'string'
        ? (body as ApiProblem)
        : undefined;
    throw new ApiRequestError(response.status, problem);
  }
  return body as ApiSuccess<T>;
}
