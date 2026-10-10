import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useSnapshotEventConnection,
  type SnapshotEventConnectionOptions,
} from './index.js';

interface TestSnapshot {
  readonly id: string;
}

interface TestStream {
  readonly readable: ReadableStream<Uint8Array>;
  emit(eventName: string, value: unknown): void;
  emitComment(): void;
  close(): void;
}

const encoder = new TextEncoder();
let streams: TestStream[];
let fetchCalls: number;
let signals: AbortSignal[];

function createStream(): TestStream {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  const enqueue = (chunk: string) => {
    if (!streamController) throw new Error('Stream controller is not ready');
    streamController.enqueue(encoder.encode(chunk));
  };
  return {
    readable,
    emit: (eventName, value) =>
      enqueue(`event: ${eventName}\ndata: ${JSON.stringify(value)}\n\n`),
    emitComment: () => enqueue(': keepalive\n\n'),
    close: () => streamController?.close(),
  };
}

function latestStream(): TestStream {
  const stream = streams.at(-1);
  if (!stream) throw new Error('No SSE stream has been opened');
  return stream;
}

async function settleStream(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function isTestSnapshot(value: unknown): value is TestSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
  );
}

function setup(
  overrides: Partial<SnapshotEventConnectionOptions<TestSnapshot, unknown>> = {}
) {
  const onSnapshot = vi.fn();
  const onEvent = vi.fn();
  const props = {
    endpoint: '/events',
    snapshotEvent: 'authoring.snapshot',
    onSnapshot,
    onEvent,
    ...overrides,
  };
  return {
    ...renderHook((options: SnapshotEventConnectionOptions<TestSnapshot>) =>
      useSnapshotEventConnection(options), { initialProps: props }),
    onSnapshot,
    onEvent,
  };
}

describe('useSnapshotEventConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    streams = [];
    fetchCalls = 0;
    signals = [];
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      if (init?.signal) signals.push(init.signal);
      const stream = createStream();
      streams.push(stream);
      return new Response(stream.readable);
    };
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('surfaces each named event before snapshot and applies eventFilter', async () => {
    const hook = setup({ eventFilter: (eventName) => eventName !== 'authoring.ignored' });
    await settleStream();

    await act(async () => {
      latestStream().emit('authoring.changed', { revision: 3 });
      latestStream().emit('authoring.ignored', { revision: 4 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.current.status).toBe('connecting');
    expect(hook.onEvent).toHaveBeenCalledExactlyOnceWith('authoring.changed', { revision: 3 });
  });

  it('filters heartbeat and comment frames by default', async () => {
    const hook = setup();
    await settleStream();

    await act(async () => {
      latestStream().emit('heartbeat', { at: 1 });
      latestStream().emitComment();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.onEvent).not.toHaveBeenCalled();
  });

  it('ignores envelopes without a snapshot and stays non-live', async () => {
    const hook = setup();
    await settleStream();

    await act(async () => {
      latestStream().emit('authoring.snapshot', { schema: 'semantic-snapshot-event/1.0' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.onSnapshot).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('connecting');
  });

  it('rejects an invalid snapshot, reconnects with backoff, and goes live on a valid retry snapshot', async () => {
    const hook = setup({ validateSnapshot: isTestSnapshot });
    await settleStream();

    await act(async () => {
      latestStream().emit('authoring.snapshot', { snapshot: { wrong: true } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.status).toBe('reconnecting');
    expect(hook.onSnapshot).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1000));
    await settleStream();
    await act(async () => {
      latestStream().emit('authoring.snapshot', { snapshot: { id: 'valid' } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.current.status).toBe('live');
    expect(hook.onSnapshot).toHaveBeenCalledExactlyOnceWith({ id: 'valid' });
  });

  it('uses exponential reconnect delays capped at thirty seconds', async () => {
    const hook = setup();
    await settleStream();
    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];

    for (const [index, delay] of delays.entries()) {
      act(() => latestStream().close());
      await settleStream();
      expect(hook.result.current.status).toBe('reconnecting');
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(fetchCalls).toBe(index + 1);
      act(() => vi.advanceTimersByTime(1));
      await settleStream();
      expect(fetchCalls).toBe(index + 2);
    }
  });

  it('resets backoff only after a validated snapshot', async () => {
    setup({ validateSnapshot: isTestSnapshot });
    await settleStream();

    act(() => latestStream().close());
    await settleStream();
    act(() => vi.advanceTimersByTime(1000));
    await settleStream();

    await act(async () => {
      latestStream().emit('authoring.snapshot', { snapshot: { id: 'valid' } });
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => latestStream().close());
    await settleStream();
    act(() => vi.advanceTimersByTime(999));
    expect(fetchCalls).toBe(2);
    act(() => vi.advanceTimersByTime(1));
    await settleStream();
    expect(fetchCalls).toBe(3);
  });

  it('aborts the previous stream when contextKey changes', async () => {
    const hook = setup({ contextKey: 'authoring-one' });
    await settleStream();
    const oldStream = latestStream();
    const oldSignal = signals[0];
    oldStream.emit('authoring.snapshot', { snapshot: { id: 'stale' } });

    hook.rerender({
      endpoint: '/events',
      contextKey: 'authoring-two',
      snapshotEvent: 'authoring.snapshot',
      onSnapshot: hook.onSnapshot,
      onEvent: hook.onEvent,
    });
    await settleStream();

    expect(oldSignal?.aborted).toBe(true);
    expect(fetchCalls).toBe(2);
    expect(hook.onSnapshot).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('connecting');
  });

  it('enabled=false aborts the stream and clears the pending retry timer', async () => {
    const hook = setup();
    await settleStream();
    const oldSignal = signals[0];
    act(() => latestStream().close());
    await settleStream();
    expect(vi.getTimerCount()).toBe(1);

    hook.rerender({
      endpoint: '/events',
      snapshotEvent: 'authoring.snapshot',
      enabled: false,
      onSnapshot: hook.onSnapshot,
      onEvent: hook.onEvent,
    });
    act(() => vi.advanceTimersByTime(60_000));

    expect(oldSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchCalls).toBe(1);
    expect(hook.result.current.status).toBe('disconnected');
  });
});
