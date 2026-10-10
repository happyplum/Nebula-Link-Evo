import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticEventStream } from './useSemanticEventStream.js';

interface TestStream {
  readonly readable: ReadableStream<Uint8Array>;
  emit(eventName: string, value: unknown): void;
  emitComment(): void;
  close(): void;
  error(): void;
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
    try {
      streamController.enqueue(encoder.encode(chunk));
    } catch {
      // Controller may be closed or cancelled
    }
  };
  return {
    readable,
    emit: (eventName, value) =>
      enqueue(`event: ${eventName}\ndata: ${JSON.stringify(value)}\n\n`),
    emitComment: () => enqueue(': keepalive\n\n'),
    close: () => streamController?.close(),
    error: () => streamController?.error(new Error('stream aborted')),
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

describe('useSemanticEventStream', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children);
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    streams = [];
    fetchCalls = 0;
    signals = [];
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

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

  it('disabled 状态下返回 idle 且不发起任何 fetch 连接', () => {
    const { result } = renderHook(
      () =>
        useSemanticEventStream({
          enabled: false,
          endpoint: '/api/v1/authoring-jobs/job-1/events',
          snapshotEvent: 'authoring.snapshot',
          queryKey: ['semantic-authoring', 'job-1'],
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toBe('idle');
    expect(fetchCalls).toBe(0);
  });

  it('收到有效 snapshot 时更新 React Query 缓存，状态切换至 live 并支持轮询门禁', async () => {
    const queryKey = ['semantic-authoring', 'job-1'];
    const { result } = renderHook(
      () =>
        useSemanticEventStream<{ seq: number; job: { id: string } }>({
          enabled: true,
          endpoint: '/api/v1/authoring-jobs/job-1/events',
          snapshotEvent: 'authoring.snapshot',
          queryKey,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toBe('connecting');
    expect(fetchCalls).toBe(1);
    await settleStream();

    await act(async () => {
      latestStream().emit('authoring.snapshot', {
        schema: 'nebula.ai-e2e.snapshot-event/1.0',
        seq: 1,
        stateVersion: 1,
        snapshot: { seq: 1, job: { id: 'job-1' } },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toBe('live');
    expect(queryClient.getQueryData(queryKey)).toEqual({
      seq: 1,
      job: { id: 'job-1' },
    });
  });

  it('当 snapshotEvent 信封缺少 snapshot 字段时，忽略该帧：不写缓存、不进入 live、轮询门禁保持开启', async () => {
    const queryKey = ['semantic-authoring', 'job-1'];
    queryClient.setQueryData(queryKey, { seq: 0, job: { id: 'initial' } });

    const { result } = renderHook(
      () =>
        useSemanticEventStream<{ seq: number; job: { id: string } }>({
          enabled: true,
          endpoint: '/api/v1/authoring-jobs/job-1/events',
          snapshotEvent: 'authoring.snapshot',
          queryKey,
        }),
      { wrapper: createWrapper() }
    );

    await settleStream();

    await act(async () => {
      latestStream().emit('authoring.snapshot', {
        schema: 'nebula.ai-e2e.snapshot-event/1.0',
        seq: 2,
        stateVersion: 2,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toBe('connecting');
    expect(queryClient.getQueryData(queryKey)).toEqual({
      seq: 0,
      job: { id: 'initial' },
    });
  });

  it('收到非 snapshot 的具名事件时触发 invalidateQueries', async () => {
    const queryKey = ['semantic-authoring', 'job-1'];
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(
      () =>
        useSemanticEventStream({
          enabled: true,
          endpoint: '/api/v1/authoring-jobs/job-1/events',
          snapshotEvent: 'authoring.snapshot',
          queryKey,
        }),
      { wrapper: createWrapper() }
    );

    await settleStream();

    await act(async () => {
      latestStream().emit('authoring.amendment_queued', { amendmentId: 'amd-1' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
  });

  it('收到 stream.error 事件时忽略，不触发 invalidateQueries', async () => {
    const queryKey = ['semantic-run', 'run-1'];
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(
      () =>
        useSemanticEventStream({
          enabled: true,
          endpoint: '/api/v1/runs/run-1/events',
          snapshotEvent: 'run.snapshot',
          queryKey,
        }),
      { wrapper: createWrapper() }
    );

    await settleStream();

    await act(async () => {
      latestStream().emit('stream.error', { code: 'INTERNAL_ERROR', message: 'transient' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('连接中断时状态转为 reconnecting，并通过共享退避策略自动重连', async () => {
    const queryKey = ['semantic-run', 'run-1'];
    const { result } = renderHook(
      () =>
        useSemanticEventStream({
          enabled: true,
          endpoint: '/api/v1/runs/run-1/events',
          snapshotEvent: 'run.snapshot',
          queryKey,
        }),
      { wrapper: createWrapper() }
    );

    await settleStream();

    // 产生 snapshot 进入 live
    await act(async () => {
      latestStream().emit('run.snapshot', {
        schema: 'nebula.ai-e2e.snapshot-event/1.0',
        seq: 1,
        snapshot: { id: 'run-1' },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toBe('live');

    // 流关闭触发断线
    await act(async () => {
      latestStream().close();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toBe('reconnecting');
    expect(fetchCalls).toBe(1);

    // 第一次退避 1000ms 重连
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchCalls).toBe(2);

    // 第二次断线，指数退避至 2000ms
    await act(async () => {
      latestStream().close();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toBe('reconnecting');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchCalls).toBe(2); // 尚未到达 2000ms

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchCalls).toBe(3); // 2000ms 到达，发起第 3 次重连
  });

  it('上下文切换时中止旧流并建立新连接，避免旧流事件污染新上下文', async () => {
    let hookEndpoint = '/api/v1/authoring-jobs/job-1/events';
    let hookQueryKey = ['semantic-authoring', 'job-1'];

    const { result, rerender } = renderHook(
      () =>
        useSemanticEventStream<{ seq: number; id: string }>({
          enabled: true,
          endpoint: hookEndpoint,
          snapshotEvent: 'authoring.snapshot',
          queryKey: hookQueryKey,
        }),
      { wrapper: createWrapper() }
    );

    await settleStream();
    expect(signals).toHaveLength(1);
    const firstSignal = signals[0];
    const firstStream = latestStream();

    // 切换上下文至 job-2
    hookEndpoint = '/api/v1/authoring-jobs/job-2/events';
    hookQueryKey = ['semantic-authoring', 'job-2'];
    rerender();
    await settleStream();

    expect(firstSignal?.aborted).toBe(true);
    expect(signals).toHaveLength(2);
    expect(fetchCalls).toBe(2);

    // 旧流发送事件不应更新 job-2 缓存
    await act(async () => {
      firstStream.emit('authoring.snapshot', {
        schema: 'nebula.ai-e2e.snapshot-event/1.0',
        seq: 99,
        snapshot: { seq: 99, id: 'job-1' },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(queryClient.getQueryData(['semantic-authoring', 'job-2'])).toBeUndefined();

    // 新流发送 snapshot
    await act(async () => {
      latestStream().emit('authoring.snapshot', {
        schema: 'nebula.ai-e2e.snapshot-event/1.0',
        seq: 1,
        snapshot: { seq: 1, id: 'job-2' },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toBe('live');
    expect(queryClient.getQueryData(['semantic-authoring', 'job-2'])).toEqual({
      seq: 1,
      id: 'job-2',
    });
  });
});
