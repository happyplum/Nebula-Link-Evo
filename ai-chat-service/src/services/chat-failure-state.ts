import type { AgentState } from '../db/types.js';
import { ProviderError, PROVIDER_ERRORS } from './provider/errors.js';

type BlockReason = NonNullable<AgentState['blockReason']>;
type WaitingFor = NonNullable<AgentState['waitingFor']>;

const ALLOWED_BLOCK_REASONS: ReadonlySet<string> = new Set([
  'waiting_for_user_input',
  'api_error',
  'rate_limit',
  'validation_failed',
  'timeout',
]);

const ALLOWED_WAITING_FOR: ReadonlySet<string> = new Set([
  'user_message',
  'api_retry',
  'external_confirmation',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractBlockedAgentState(
  error: unknown
): Pick<AgentState, 'blockReason' | 'waitingFor'> | null {
  if (!isRecord(error)) {
    return null;
  }

  const blockReason = error.blockReason;
  if (typeof blockReason !== 'string') {
    return null;
  }

  // Treat job_error as an internal failure reason, not a "blocked" signal.
  if (blockReason === 'job_error') {
    return null;
  }

  if (!ALLOWED_BLOCK_REASONS.has(blockReason)) {
    return null;
  }

  const waitingFor = error.waitingFor;
  const result: Pick<AgentState, 'blockReason' | 'waitingFor'> = {
    blockReason: blockReason as BlockReason,
  };

  return {
    ...result,
    ...(typeof waitingFor === 'string' && ALLOWED_WAITING_FOR.has(waitingFor)
      ? { waitingFor: waitingFor as WaitingFor }
      : {}),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function chatFailureState(
  error: unknown,
  retryCount = 1
): { retryable: boolean; agentState: AgentState } {
  if (error instanceof ProviderError) {
    const rateLimited = error.code === PROVIDER_ERRORS.RATE_LIMITED;
    const retryAfterMs = (error.details as { retryAfterMs?: number } | undefined)?.retryAfterMs;
    return {
      retryable: false,
      agentState: {
        schema_version: 1,
        blockReason: rateLimited ? 'rate_limit' : 'api_error',
        ...(rateLimited ? { waitingFor: 'api_retry' as const } : {}),
        lastError: rateLimited
          ? toErrorMessage(error)
          : `Provider '${error.provider}' error: ${toErrorMessage(error)}`,
        ...(retryAfterMs != null && rateLimited ? { retryAfterMs } : {}),
      },
    };
  }
  const blocked = extractBlockedAgentState(error);
  if (blocked) return { retryable: false, agentState: { schema_version: 1, ...blocked } };
  return {
    retryable: true,
    agentState: {
      schema_version: 1,
      blockReason: 'job_error',
      waitingFor: 'api_retry',
      retryCount,
      lastError: toErrorMessage(error),
    },
  };
}
