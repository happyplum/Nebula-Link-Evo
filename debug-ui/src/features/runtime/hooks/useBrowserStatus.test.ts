import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const streamState = vi.hoisted(() => ({
  connectionState: 'disconnected' as 'disconnected' | 'connecting' | 'connected',
  lastErrorAt: 0,
  lastKeepaliveAt: 0,
  lastMessageAt: 0,
}));

vi.mock('@/features/runtime/lib/debug-stream-client.js', () => ({
  debugStreamClient: {
    getConnectionState: () => streamState.connectionState,
  },
}));

vi.mock('./useDebugStream.js', () => ({
  useDebugStream: () => ({
    connectionState: streamState.connectionState,
    lastErrorAt: streamState.lastErrorAt,
    lastKeepaliveAt: streamState.lastKeepaliveAt,
    lastMessageAt: streamState.lastMessageAt,
  }),
}));

import { useControlStore } from '@/features/playwright-control/store/control.store.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';

import { useBrowserStatus } from './useBrowserStatus.js';

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceTimers(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useBrowserStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    streamState.connectionState = 'disconnected';
    streamState.lastErrorAt = 0;
    streamState.lastKeepaliveAt = 0;
    streamState.lastMessageAt = 0;
    useRuntimeStore.getState().reset();
    useControlStore.getState().reset();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          services: {
            playwright: {
              isOpen: true,
              url: 'https://health.example',
              title: 'Health',
              status: 'ready',
            },
          },
        }),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stops 4s polling while the stream is connected', async () => {
    const { rerender, unmount } = renderHook(() => useBrowserStatus());

    await flushAsyncWork();
    expect(fetch).toHaveBeenCalledTimes(1);

    streamState.connectionState = 'connected';
    streamState.lastMessageAt = 1;
    rerender();

    await advanceTimers(12_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('resumes 4s polling after the stream stays disconnected for 5s', async () => {
    const { rerender, unmount } = renderHook(() => useBrowserStatus());

    await flushAsyncWork();
    expect(fetch).toHaveBeenCalledTimes(1);

    streamState.connectionState = 'connected';
    streamState.lastMessageAt = 1;
    rerender();

    streamState.connectionState = 'disconnected';
    rerender();

    await advanceTimers(4_999);
    expect(fetch).toHaveBeenCalledTimes(1);

    await advanceTimers(4_001);
    expect(fetch).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('stops polling again when the stream reconnects', async () => {
    const { rerender, unmount } = renderHook(() => useBrowserStatus());

    await flushAsyncWork();
    expect(fetch).toHaveBeenCalledTimes(1);

    streamState.connectionState = 'connected';
    streamState.lastMessageAt = 1;
    rerender();

    streamState.connectionState = 'disconnected';
    rerender();

    await advanceTimers(9_001);
    expect(fetch).toHaveBeenCalledTimes(2);

    streamState.connectionState = 'connected';
    streamState.lastMessageAt = 2;
    rerender();

    await advanceTimers(8_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('keeps refreshNow as a one-shot health fetch', async () => {
    const { rerender, result, unmount } = renderHook(() => useBrowserStatus());

    await flushAsyncWork();
    expect(fetch).toHaveBeenCalledTimes(1);

    streamState.connectionState = 'connected';
    streamState.lastMessageAt = 1;
    rerender();

    await act(async () => {
      await result.current.refreshNow();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    unmount();
  });
});
