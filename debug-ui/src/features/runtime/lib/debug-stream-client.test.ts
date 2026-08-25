import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  private readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
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

async function loadStreamClient() {
  vi.resetModules();
  const mod = await import('./debug-stream-client.js');
  mod.debugStreamClient._reset();
  return mod;
}

describe('debugStreamClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('acquire() creates one EventSource and reuses it across references', async () => {
    const { DEBUG_STREAM_PATH, debugStreamClient } = await loadStreamClient();

    debugStreamClient.acquire();
    debugStreamClient.acquire();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe(DEBUG_STREAM_PATH);
    expect(debugStreamClient.getConnectionState()).toBe('connecting');
  });

  it('release() only closes the EventSource after the final reference', async () => {
    const { debugStreamClient } = await loadStreamClient();

    debugStreamClient.acquire();
    debugStreamClient.acquire();

    const es = MockEventSource.instances[0]!;

    debugStreamClient.release();
    expect(es.close).not.toHaveBeenCalled();
    expect(debugStreamClient.getConnectionState()).toBe('connecting');

    debugStreamClient.release();
    expect(es.close).toHaveBeenCalledTimes(1);
    expect(debugStreamClient.getConnectionState()).toBe('disconnected');
  });

  it('subscribe() forwards EventSource events and unsubscribe stops forwarding', async () => {
    const { debugStreamClient } = await loadStreamClient();
    const handler = vi.fn();
    const unsubscribe = debugStreamClient.subscribe('debug.status', handler);

    debugStreamClient.acquire();
    const es = MockEventSource.instances[0]!;

    es.emit('debug.status', {
      type: 'debug.status',
      emittedAt: '2026-05-03T00:00:00.000Z',
      status: {
        isOpen: true,
        url: 'https://example.test',
        title: 'Example',
        status: 'ready',
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();

    es.emit('debug.status', {
      type: 'debug.status',
      emittedAt: '2026-05-03T00:00:01.000Z',
      status: {
        isOpen: false,
        url: null,
        title: null,
        status: 'unknown',
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('subscribeConnectionState() notifies on connecting, connected, and disconnected transitions', async () => {
    const { debugStreamClient } = await loadStreamClient();
    const listener = vi.fn();

    debugStreamClient.subscribeConnectionState(listener);
    debugStreamClient.acquire();
    MockEventSource.instances[0]!.open();
    MockEventSource.instances[0]!.fail();

    expect(listener.mock.calls).toEqual([['connecting'], ['connected'], ['disconnected']]);
    expect(debugStreamClient.getConnectionState()).toBe('disconnected');
  });

  it('forceReconnect() closes the current EventSource and opens a new one', async () => {
    const { debugStreamClient } = await loadStreamClient();

    debugStreamClient.acquire();
    const first = MockEventSource.instances[0]!;
    first.open();

    debugStreamClient.forceReconnect();

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]).not.toBe(first);
    expect(debugStreamClient.getConnectionState()).toBe('connecting');
  });

  it('_reset() closes the EventSource and clears refs plus subscribers', async () => {
    const { debugStreamClient } = await loadStreamClient();
    const eventHandler = vi.fn();
    const stateHandler = vi.fn();

    debugStreamClient.subscribe('debug.keepalive', eventHandler);
    debugStreamClient.subscribeConnectionState(stateHandler);
    debugStreamClient.acquire();

    const first = MockEventSource.instances[0]!;

    stateHandler.mockClear();

    debugStreamClient._reset();

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(debugStreamClient.getConnectionState()).toBe('disconnected');

    first.emit('debug.keepalive', {
      type: 'debug.keepalive',
      emittedAt: '2026-05-03T00:00:02.000Z',
    });

    expect(eventHandler).not.toHaveBeenCalled();
    expect(stateHandler).not.toHaveBeenCalled();

    debugStreamClient.acquire();

    expect(MockEventSource.instances).toHaveLength(2);
  });

  it('getConnectionState() reflects the latest connection lifecycle state', async () => {
    const { debugStreamClient } = await loadStreamClient();

    expect(debugStreamClient.getConnectionState()).toBe('disconnected');

    debugStreamClient.acquire();
    expect(debugStreamClient.getConnectionState()).toBe('connecting');

    MockEventSource.instances[0]!.open();
    expect(debugStreamClient.getConnectionState()).toBe('connected');

    MockEventSource.instances[0]!.fail();
    expect(debugStreamClient.getConnectionState()).toBe('disconnected');
  });
});
