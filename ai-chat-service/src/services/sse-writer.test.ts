import { describe, expect, it, vi } from 'vitest';
import { BoundedSseWriter } from './sse-writer.js';

describe('BoundedSseWriter', () => {
  it('preserves order and disconnects when the per-subscriber queue overflows', async () => {
    let firstCallback: ((error?: Error | null) => void) | undefined;
    const write = vi.fn((_chunk: string, callback: (error?: Error | null) => void) => {
      firstCallback ??= callback;
      return false;
    });
    const end = vi.fn();
    const onClose = vi.fn();
    const writer = new BoundedSseWriter({ write, end } as never, { maxQueued: 2, onClose });
    expect(writer.push('one')).toBe(true);
    expect(writer.push('two')).toBe(true);
    expect(writer.push('three')).toBe(true);
    expect(writer.push('four')).toBe(false);
    expect(onClose).toHaveBeenCalledWith('overflow');
    expect(end).toHaveBeenCalledOnce();
    firstCallback?.();
  });

  it('times out a write that never settles', async () => {
    vi.useFakeTimers();
    const end = vi.fn();
    const onClose = vi.fn();
    const writer = new BoundedSseWriter(
      { write: vi.fn(() => false), end } as never,
      { writeTimeoutMs: 5_000, onClose }
    );
    writer.push('event');
    await vi.advanceTimersByTimeAsync(5_001);
    expect(onClose).toHaveBeenCalledWith('timeout');
    expect(end).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
