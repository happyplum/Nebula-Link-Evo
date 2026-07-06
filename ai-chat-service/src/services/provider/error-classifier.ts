import { APICallError, RetryError } from 'ai';
import { ProviderError } from './errors.js';
import { PROVIDER_ERRORS } from './errors.js';

/**
 * Result of rate-limit error classification.
 */
export interface RateLimitClassification {
  isRateLimited: boolean;
  retryAfterMs?: number;
  providerError?: ProviderError;
}

const RATE_LIMIT_PATTERNS = [
  /rate\s*limit/i,
  /too\s*many\s*requests/i,
  /quota\s*exceeded/i,
  /requests\s*per\s*(minute|hour|day|second)/i,
  /rpm\s*limit/i,
  /tpm\s*limit/i,
  /tokens?\s*per\s*(minute|second)/i,
] as const;

/**
 * Parse a header value that is already in milliseconds.
 * Used for `retry-after-ms` / `Retry-After-Ms` headers.
 * Returns undefined if parsing fails (conservative fallback).
 */
export function parseDirectMs(
  value: string | undefined,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const ms = Number(trimmed);
  return Number.isFinite(ms) && ms >= 0 ? Math.ceil(ms) : undefined;
}

/**
 * Parse Retry-After header value to milliseconds.
 * Supports both seconds (number) and HTTP-date formats.
 * Returns undefined if parsing fails (conservative fallback).
 */
export function parseRetryAfterMs(
  value: string | undefined,
): number | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Try numeric seconds
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  // Try HTTP-date
  try {
    const date = new Date(trimmed);
    const now = Date.now();
    const ms = date.getTime() - now;
    if (ms > 0) {
      return Math.ceil(ms);
    }
  } catch {
    // Not a valid date, ignore
  }

  return undefined;
}

/**
 * Check if an APICallError indicates rate limiting.
 */
function checkAPICallErrorForRateLimit(error: APICallError, options?: { provider?: string; logger?: { debug: (...args: unknown[]) => void } }): RateLimitClassification {
  // Primary: HTTP 429 status code
  if (error.statusCode === 429) {
    const retryAfterMs = parseDirectMs(
      error.responseHeaders?.['retry-after-ms'] ??
        error.responseHeaders?.['Retry-After-Ms'],
    ) ?? parseRetryAfterMs(
      error.responseHeaders?.['retry-after'] ??
        error.responseHeaders?.['Retry-After'],
    );

    return {
      isRateLimited: true,
      retryAfterMs,
      providerError: new ProviderError(PROVIDER_ERRORS.RATE_LIMITED, options?.provider ?? 'unknown', {
        statusCode: error.statusCode,
        responseHeaders: error.responseHeaders,
        responseBody: error.responseBody,
        retryAfterMs,
      }, error.message),
    };
  }

  // Fallback: message pattern matching (lower confidence)
  const message = error.message ?? '';
  if (RATE_LIMIT_PATTERNS.some((p) => p.test(message))) {
    const retryAfterMs = parseDirectMs(
      error.responseHeaders?.['retry-after-ms'] ??
        error.responseHeaders?.['Retry-After-Ms'],
    ) ?? parseRetryAfterMs(
      error.responseHeaders?.['retry-after'] ??
        error.responseHeaders?.['Retry-After'],
    );

    return {
      isRateLimited: true,
      retryAfterMs,
      providerError: new ProviderError(PROVIDER_ERRORS.RATE_LIMITED, options?.provider ?? 'unknown', {
        statusCode: error.statusCode,
        responseHeaders: error.responseHeaders,
        responseBody: error.responseBody,
        matchedPattern: true,
        retryAfterMs,
      }, error.message),
    };
  }

  return { isRateLimited: false };
}

/**
 * Classify a raw error from Vercel AI SDK into rate-limit category.
 *
 * Checks:
 * 1. APICallError with statusCode 429 → RATE_LIMITED
 * 2. APICallError with rate-limit keywords in message → RATE_LIMITED (lower confidence)
 * 3. RetryError wrapping an APICallError that was rate-limited → RATE_LIMITED
 * 4. Generic error with rate-limit message → RATE_LIMITED (lowest confidence)
 */
export function classifyRateLimitError(error: unknown, options?: { provider?: string; logger?: { debug: (...args: unknown[]) => void } }): RateLimitClassification {
  const logger = options?.logger;

  // Direct APICallError
  if (APICallError.isInstance(error)) {
    const result = checkAPICallErrorForRateLimit(error, options);
    if (result.isRateLimited) {
      logger?.debug({ isRateLimit: true, provider: options?.provider, retryAfterMs: result.retryAfterMs }, 'Rate-limit error classified');
    }
    return result;
  }

  // RetryError wrapping APICallError — check the inner errors
  if (RetryError.isInstance(error)) {
    const apiError = error.errors?.find((e) => APICallError.isInstance(e));
    if (apiError && APICallError.isInstance(apiError)) {
      const result = checkAPICallErrorForRateLimit(apiError, options);
      if (result.isRateLimited) {
        logger?.debug({ isRateLimit: true, provider: options?.provider, retryAfterMs: result.retryAfterMs }, 'Rate-limit error classified');
      }
      return result;
    }
  }

  // Last resort: message pattern on generic errors
  if (error instanceof Error) {
    const message = error.message ?? '';
    if (RATE_LIMIT_PATTERNS.some((p) => p.test(message))) {
      const result: RateLimitClassification = {
        isRateLimited: true,
        providerError: new ProviderError(PROVIDER_ERRORS.RATE_LIMITED, options?.provider ?? 'unknown', {
          originalError: String(error),
          matchedPattern: true,
        }, error.message),
      };
      logger?.debug({ isRateLimit: true, provider: options?.provider }, 'Rate-limit error classified');
      return result;
    }
  }

  return { isRateLimited: false };
}