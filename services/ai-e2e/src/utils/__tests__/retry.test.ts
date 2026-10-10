import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRetry } from '../retry.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns result on first successful call', async () => {
    const fn = vi.fn(async () => 'ok');

    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and returns result on retry', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    const error = new Error('permanent failure');
    const fn = vi.fn(async () => {
      throw error;
    });

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow('permanent failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom maxRetries and baseDelayMs', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(fn, { maxRetries: 4, baseDelayMs: 25 })).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(3);
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 25);
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 50);
  });

  it('applies exponential backoff', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 1000 });

    await vi.waitFor(() => {
      expect(fn).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(fn).toHaveBeenCalledTimes(2);
    });

    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
