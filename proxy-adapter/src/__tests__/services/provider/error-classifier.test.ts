import { describe, it, expect } from 'vitest';
import { APICallError, RetryError } from 'ai';
import { parseRetryAfterMs, parseDirectMs, classifyRateLimitError } from '../../../services/provider/error-classifier.js';
import { ProviderError, PROVIDER_ERRORS } from '../../../services/provider/errors.js';

// ---------------------------------------------------------------------------
// Helpers — construct real APICallError / RetryError instances
// ---------------------------------------------------------------------------

interface APICallErrorInit {
  message: string;
  url?: string;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

function makeAPICallError(init: APICallErrorInit): APICallError {
  return new APICallError({
    message: init.message,
    url: init.url ?? 'https://api.test.example/v1/chat',
    statusCode: init.statusCode ?? 500,
    responseHeaders: init.responseHeaders ?? {},
    responseBody: init.responseBody ?? '',
  });
}

function makeRetryError(errors: Error[]): RetryError {
  return new RetryError({ message: 'Retry failed', errors });
}

// ===========================================================================
// parseRetryAfterMs
// ===========================================================================

describe('parseRetryAfterMs', () => {
  it('parses numeric seconds "30" → 30000', () => {
    expect(parseRetryAfterMs('30')).toBe(30000);
  });

  it('parses decimal seconds "1.5" → 1500', () => {
    expect(parseRetryAfterMs('1.5')).toBe(1500);
  });

  it('parses zero "0" → 0', () => {
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('returns undefined for empty string', () => {
    expect(parseRetryAfterMs('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(parseRetryAfterMs('   ')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });

  it('returns undefined for negative number "-5"', () => {
    expect(parseRetryAfterMs('-5')).toBeUndefined();
  });

  it('returns undefined for non-numeric string that is not a date', () => {
    expect(parseRetryAfterMs('not-a-number')).toBeUndefined();
  });

  it('parses future HTTP-date to positive ms value', () => {
    const future = new Date(Date.now() + 60_000);
    const result = parseRetryAfterMs(future.toUTCString());
    expect(result).toBeGreaterThan(0);
    expect(result!).toBeLessThanOrEqual(60_100); // allow ceil jitter
  });

  it('returns undefined for past HTTP-date (ms ≤ 0)', () => {
    const past = new Date(Date.now() - 60_000);
    expect(parseRetryAfterMs(past.toUTCString())).toBeUndefined();
  });

  it('parses a date just barely in the future', () => {
    // Use 2s offset to survive test execution latency
    const barely = new Date(Date.now() + 2000);
    const result = parseRetryAfterMs(barely.toUTCString());
    expect(result).toBeGreaterThan(0);
  });

  it('parses large number "3600" → 3600000', () => {
    expect(parseRetryAfterMs('3600')).toBe(3_600_000);
  });
});

// ===========================================================================
// parseDirectMs
// ===========================================================================

describe('parseDirectMs', () => {
  it('parses milliseconds "5000" → 5000', () => {
    expect(parseDirectMs('5000')).toBe(5000);
  });

  it('parses zero "0" → 0', () => {
    expect(parseDirectMs('0')).toBe(0);
  });

  it('returns undefined for empty string', () => {
    expect(parseDirectMs('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(parseDirectMs('   ')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(parseDirectMs(undefined)).toBeUndefined();
  });

  it('returns undefined for negative number "-100"', () => {
    expect(parseDirectMs('-100')).toBeUndefined();
  });

  it('returns undefined for non-numeric string', () => {
    expect(parseDirectMs('not-a-number')).toBeUndefined();
  });

  it('parses decimal milliseconds "1500.7" → 1501 (ceil)', () => {
    expect(parseDirectMs('1500.7')).toBe(1501);
  });
});

// ===========================================================================
// classifyRateLimitError
// ===========================================================================

describe('classifyRateLimitError', () => {
  // -------------------------------------------------------------------------
  // APICallError with statusCode 429
  // -------------------------------------------------------------------------
  describe('APICallError with 429', () => {
    it('returns isRateLimited=true with retryAfterMs from retry-after-ms header (direct ms)', () => {
      const error = makeAPICallError({
        message: 'Too many requests',
        statusCode: 429,
        responseHeaders: { 'retry-after-ms': '5000' },
        responseBody: 'rate limited',
      });
      const result = classifyRateLimitError(error);
      expect(result.isRateLimited).toBe(true);
      expect(result.retryAfterMs).toBe(5000);
    });

    it('returns isRateLimited=true with retryAfterMs from retry-after header (seconds)', () => {
      const error = makeAPICallError({
        message: 'Too many requests',
        statusCode: 429,
        responseHeaders: { 'retry-after': '30' },
        responseBody: 'rate limited',
      });
      const result = classifyRateLimitError(error);
      expect(result.isRateLimited).toBe(true);
      expect(result.retryAfterMs).toBe(30_000);
    });

    it('returns isRateLimited=true without retryAfterMs when no header present', () => {
      const error = makeAPICallError({
        message: 'Too many requests',
        statusCode: 429,
        responseHeaders: {},
        responseBody: 'rate limited',
      });
      const result = classifyRateLimitError(error);
      expect(result.isRateLimited).toBe(true);
      expect(result.retryAfterMs).toBeUndefined();
    });

    it('sets ProviderError.code to RATE_LIMITED', () => {
      const error = makeAPICallError({
        message: 'Too many requests',
        statusCode: 429,
      });
      const result = classifyRateLimitError(error);
      expect(result.providerError).toBeInstanceOf(ProviderError);
      expect(result.providerError!.code).toBe(PROVIDER_ERRORS.RATE_LIMITED);
    });

    it('sets ProviderError.message to the original error message', () => {
      const error = makeAPICallError({
        message: 'Custom rate limit message',
        statusCode: 429,
      });
      const result = classifyRateLimitError(error);
      expect(result.providerError!.message).toBe('Custom rate limit message');
    });

    it('sets ProviderError.provider from options', () => {
      const error = makeAPICallError({
        message: 'Too many requests',
        statusCode: 429,
      });
      const result = classifyRateLimitError(error, { provider: 'openai' });
      expect(result.providerError!.provider).toBe('openai');
    });

    it('defaults ProviderError.provider to "unknown" when no options', () => {
      const error = makeAPICallError({
        message: 'Too many requests',
        statusCode: 429,
      });
      const result = classifyRateLimitError(error);
      expect(result.providerError!.provider).toBe('unknown');
    });

    it('includes statusCode, responseHeaders, responseBody in ProviderError.details', () => {
      const error = makeAPICallError({
        message: 'Too many requests',
        statusCode: 429,
        responseHeaders: { 'retry-after': '10' },
        responseBody: '{"error":"rate_limited"}',
      });
      const result = classifyRateLimitError(error);
      const details = result.providerError!.details as Record<string, unknown>;
      expect(details.statusCode).toBe(429);
      expect(details.responseHeaders).toEqual({ 'retry-after': '10' });
      expect(details.responseBody).toBe('{"error":"rate_limited"}');
    });
  });

  // -------------------------------------------------------------------------
  // APICallError with non-429 + rate-limit message patterns
  // -------------------------------------------------------------------------
  describe('APICallError with non-429 status + rate-limit message', () => {
    it('matches "rate limit exceeded" with statusCode 500', () => {
      const error = makeAPICallError({ message: 'rate limit exceeded', statusCode: 500 });
      const result = classifyRateLimitError(error);
      expect(result.isRateLimited).toBe(true);
    });

    it('matches "too many requests" with statusCode 500', () => {
      const error = makeAPICallError({ message: 'too many requests', statusCode: 500 });
      const result = classifyRateLimitError(error);
      expect(result.isRateLimited).toBe(true);
    });

    it('matches "quota exceeded" with statusCode 500', () => {
      const error = makeAPICallError({ message: 'quota exceeded', statusCode: 500 });
      const result = classifyRateLimitError(error);
      expect(result.isRateLimited).toBe(true);
    });

    it('matches "requests per minute exceeded" with statusCode 500', () => {
      const error = makeAPICallError({ message: 'requests per minute exceeded', statusCode: 500 });
      const result = classifyRateLimitError(error);
      expect(result.isRateLimited).toBe(true);
    });

    it('matches "rpm limit reached" with statusCode 500', () => {
      const error = makeAPICallError({ message: 'rpm limit reached', statusCode: 500 });
      const result = classifyRateLimitError(error);
      expect(result.isRateLimited).toBe(true);
    });

    it('matches "tpm limit reached" with statusCode 500', () => {
      const error = makeAPICallError({ message: 'tpm limit reached', statusCode: 500 });
      const result = classifyRateLimitError(error);
      expect(result.isRateLimited).toBe(true);
    });

    it('matches "tokens per minute exceeded" with statusCode 500', () => {
      const error = makeAPICallError({ message: 'tokens per minute exceeded', statusCode: 500 });
      const result = classifyRateLimitError(error);
      expect(result.isRateLimited).toBe(true);
    });

    it('includes matchedPattern:true in ProviderError.details', () => {
      const error = makeAPICallError({ message: 'rate limit exceeded', statusCode: 500 });
      const result = classifyRateLimitError(error);
      const details = result.providerError!.details as Record<string, unknown>;
      expect(details.matchedPattern).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // APICallError with non-429 + NON-rate-limit message
  // -------------------------------------------------------------------------
  describe('APICallError with non-429 status + non-rate-limit message', () => {
    it('returns isRateLimited=false for "internal server error" with statusCode 500', () => {
      const error = makeAPICallError({ message: 'internal server error', statusCode: 500 });
      expect(classifyRateLimitError(error).isRateLimited).toBe(false);
    });

    it('returns isRateLimited=false for "bad request" with statusCode 400', () => {
      const error = makeAPICallError({ message: 'bad request', statusCode: 400 });
      expect(classifyRateLimitError(error).isRateLimited).toBe(false);
    });

    it('returns isRateLimited=false for "token limit exceeded" (context window)', () => {
      const error = makeAPICallError({ message: 'token limit exceeded', statusCode: 500 });
      expect(classifyRateLimitError(error).isRateLimited).toBe(false);
    });

    it('returns isRateLimited=false for "capacity exceeded"', () => {
      const error = makeAPICallError({ message: 'capacity exceeded', statusCode: 500 });
      expect(classifyRateLimitError(error).isRateLimited).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // RetryError wrapping APICallError
  // -------------------------------------------------------------------------
  describe('RetryError wrapping APICallError', () => {
    it('classifies RetryError wrapping APICallError(429) as rate-limited', () => {
      const inner = makeAPICallError({
        message: 'Too many requests',
        statusCode: 429,
        responseHeaders: { 'retry-after': '10' },
      });
      const retryErr = makeRetryError([inner]);
      const result = classifyRateLimitError(retryErr);
      expect(result.isRateLimited).toBe(true);
      expect(result.retryAfterMs).toBe(10_000);
    });

    it('classifies RetryError wrapping non-429 APICallError with rate-limit message', () => {
      const inner = makeAPICallError({
        message: 'rate limit exceeded',
        statusCode: 500,
      });
      const retryErr = makeRetryError([inner]);
      const result = classifyRateLimitError(retryErr);
      expect(result.isRateLimited).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Generic Error with rate-limit message
  // -------------------------------------------------------------------------
  describe('generic Error with rate-limit message', () => {
    it('classifies Error("rate limit exceeded") as rate-limited', () => {
      const result = classifyRateLimitError(new Error('rate limit exceeded'));
      expect(result.isRateLimited).toBe(true);
    });

    it('classifies Error("too many requests") as rate-limited', () => {
      const result = classifyRateLimitError(new Error('too many requests'));
      expect(result.isRateLimited).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Generic Error without rate-limit message
  // -------------------------------------------------------------------------
  describe('generic Error without rate-limit message', () => {
    it('returns isRateLimited=false for Error("network timeout")', () => {
      const result = classifyRateLimitError(new Error('network timeout'));
      expect(result.isRateLimited).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Non-Error input
  // -------------------------------------------------------------------------
  describe('non-Error input', () => {
    it('returns isRateLimited=false for null', () => {
      expect(classifyRateLimitError(null).isRateLimited).toBe(false);
    });

    it('returns isRateLimited=false for undefined', () => {
      expect(classifyRateLimitError(undefined).isRateLimited).toBe(false);
    });

    it('returns isRateLimited=false for string', () => {
      expect(classifyRateLimitError('rate limit exceeded').isRateLimited).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Logger integration
  // -------------------------------------------------------------------------
  describe('logger integration', () => {
    it('calls logger.debug once when isRateLimited is true', () => {
      const logs: unknown[][] = [];
      const logger = { debug: (...args: unknown[]) => { logs.push(args); } };
      const error = makeAPICallError({ message: 'Too many requests', statusCode: 429 });
      classifyRateLimitError(error, { logger });
      expect(logs.length).toBe(1);
    });

    it('does not call logger.debug when isRateLimited is false', () => {
      const logs: unknown[][] = [];
      const logger = { debug: (...args: unknown[]) => { logs.push(args); } };
      const error = makeAPICallError({ message: 'internal server error', statusCode: 500 });
      classifyRateLimitError(error, { logger });
      expect(logs.length).toBe(0);
    });

    it('calls logger.debug for generic Error with rate-limit message', () => {
      const logs: unknown[][] = [];
      const logger = { debug: (...args: unknown[]) => { logs.push(args); } };
      classifyRateLimitError(new Error('rate limit exceeded'), { logger });
      expect(logs.length).toBe(1);
    });

    it('calls logger.debug for RetryError wrapping rate-limited APICallError', () => {
      const logs: unknown[][] = [];
      const logger = { debug: (...args: unknown[]) => { logs.push(args); } };
      const inner = makeAPICallError({ message: 'Too many requests', statusCode: 429 });
      const retryErr = makeRetryError([inner]);
      classifyRateLimitError(retryErr, { logger });
      expect(logs.length).toBe(1);
    });
  });
});
