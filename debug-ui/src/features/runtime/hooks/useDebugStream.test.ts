import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: MockEventSource[] = [];

  readonly url: string;
  readyState = MockEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type: string, payload: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) });
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }

  open() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  fail() {
    this.readyState = MockEventSource.CONNECTING;
    this.onerror?.(new Event('error'));
  }
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function loadRuntimeModules() {
  vi.resetModules();

  const runtimeStoreModule = await import('@/features/runtime/store/runtime.store.js');
  const controlStoreModule = await import('@/features/playwright-control/store/control.store.js');
  const streamClientModule = await import('../lib/debug-stream-client.js');
  const hookModule = await import('./useDebugStream.js');

  runtimeStoreModule.useRuntimeStore.getState().reset();
  controlStoreModule.useControlStore.getState().reset();

  return {
    ...runtimeStoreModule,
    ...controlStoreModule,
    ...streamClientModule,
    ...hookModule,
  };
}

describe('useDebugStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shares a singleton EventSource until the last release', async () => {
    const { debugStreamClient } = await loadRuntimeModules();

    debugStreamClient.acquire();
    debugStreamClient.acquire();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe('/debug/api/stream');

    debugStreamClient.release();
    expect(MockEventSource.instances[0]?.close).not.toHaveBeenCalled();

    debugStreamClient.release();
    expect(MockEventSource.instances[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('applies debug.snapshot and debug.status payloads to runtime and control stores', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { useRuntimeStore, useControlStore, useDebugStream } = await loadRuntimeModules();

    renderHook(() => useDebugStream(), { wrapper: createWrapper(client) });
    await flushAsyncWork();

    const es = MockEventSource.instances[0]!;
    act(() => {
      es.open();
      es.emit('debug.snapshot', {
        type: 'debug.snapshot',
        seq: 0,
        emittedAt: '2026-05-02T00:00:00.000Z',
        status: {
          isOpen: true,
          url: 'https://snapshot.example',
          title: 'Snapshot',
          status: 'ready',
          reason: 'snapshot',
        },
      });
    });

    expect(useRuntimeStore.getState().playwrightStatus).toBe('ready');
    expect(useRuntimeStore.getState().playwrightIsOpen).toBe(true);
    expect(useRuntimeStore.getState().playwrightStatusHydrated).toBe(true);
    expect(useRuntimeStore.getState().playwrightUrl).toBe('https://snapshot.example');
    expect(useControlStore.getState().browserOpen).toBe(true);
    expect(useControlStore.getState().browserUrl).toBe('https://snapshot.example');

    act(() => {
      es.emit('debug.status', {
        type: 'debug.status',
        seq: 1,
        emittedAt: '2026-05-02T00:00:01.000Z',
        status: {
          isOpen: false,
          url: null,
          title: null,
          status: 'unknown',
          reason: 'close',
        },
      });
    });

    expect(useRuntimeStore.getState().playwrightStatus).toBe('unknown');
    expect(useRuntimeStore.getState().playwrightIsOpen).toBe(false);
    expect(useRuntimeStore.getState().playwrightUrl).toBeNull();
    expect(useControlStore.getState().browserOpen).toBe(false);
    expect(useControlStore.getState().browserUrl).toBe('');
  });

  it('invalidates health, MCP status, and MCP tools separately', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    const { useDebugStream } = await loadRuntimeModules();

    const { unmount } = renderHook(() => useDebugStream(), { wrapper: createWrapper(client) });

    act(() => {
      MockEventSource.instances[0]!.open();
      MockEventSource.instances[0]!.emit('debug.mcp_invalidated', {
        type: 'debug.mcp_invalidated',
        seq: 2,
        scope: 'all',
        reason: 'tool_call',
        emittedAt: '2026-05-02T00:00:02.000Z',
      });
    });

    await flushAsyncWork();

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ['health'] });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ['mcp', 'status'] });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, { queryKey: ['mcp', 'tools'] });

    unmount();
  });

  it('updates health state on debug.error events', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { useDebugStream } = await loadRuntimeModules();

    const { result } = renderHook(() => useDebugStream(), { wrapper: createWrapper(client) });
    await flushAsyncWork();

    act(() => {
      MockEventSource.instances[0]!.open();
      MockEventSource.instances[0]!.emit('debug.error', {
        type: 'debug.error',
        code: 'upstream_disconnected',
        message: 'test error',
        emittedAt: '2026-05-03T00:00:03.000Z',
      });
    });

    expect(warn).toHaveBeenCalledWith('[debug-stream]', 'test error');
    expect(result.current.lastErrorAt).toBeGreaterThan(0);
  });

  it('updates keepalive timestamp on debug.keepalive events', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { useDebugStream } = await loadRuntimeModules();

    const { result } = renderHook(() => useDebugStream(), { wrapper: createWrapper(client) });
    await flushAsyncWork();

    act(() => {
      MockEventSource.instances[0]!.open();
      MockEventSource.instances[0]!.emit('debug.keepalive', {
        type: 'debug.keepalive',
        emittedAt: '2026-05-03T00:00:04.000Z',
      });
    });

    expect(result.current.lastKeepaliveAt).toBeGreaterThan(0);
    expect(result.current.lastMessageAt).toBeGreaterThan(0);
  });

  it('reconnects after the EventSource errors', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { useDebugStream } = await loadRuntimeModules();

    renderHook(() => useDebugStream(), { wrapper: createWrapper(client) });
    await flushAsyncWork();

    act(() => {
      MockEventSource.instances[0]!.open();
      MockEventSource.instances[0]!.fail();
    });

    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(MockEventSource.instances.length).toBeGreaterThan(1);
    expect(MockEventSource.instances[0]!.close).toHaveBeenCalled();
  });
});
