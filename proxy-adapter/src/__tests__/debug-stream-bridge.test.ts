import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchEventSourceInit, EventSourceMessage } from '@microsoft/fetch-event-source';
import type {
  DebugKeepaliveEvent,
  DebugMarkerEvent,
  DebugOverlayEvent,
  DebugPlaywrightState,
  DebugSnapshotEvent,
  DebugStatusEvent,
  DebugStreamEvent,
} from '@nebula-link-evo/shared/types/debug-events.js';

const mockFetchEventSourceState = vi.hoisted(() => {
  let lastInit: FetchEventSourceInit | null = null;
  let callCount = 0;

  const fetchEventSource = vi.fn(async (_url: string, init: FetchEventSourceInit) => {
    callCount += 1;
    lastInit = init;

    return await new Promise<void>((resolve) => {
      init.signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  });

  return {
    fetchEventSource,
    getLastInit: () => lastInit,
    getCallCount: () => callCount,
    reset: () => {
      lastInit = null;
      callCount = 0;
      fetchEventSource.mockClear();
    },
  };
});

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: mockFetchEventSourceState.fetchEventSource,
}));

function createStatus(reason: DebugPlaywrightState['reason'] = 'open'): DebugPlaywrightState {
  return {
    isOpen: true,
    url: 'https://example.com',
    title: 'Example',
    status: 'ready',
    viewport: { width: 1280, height: 720 },
    reason,
  };
}

function createMessage(event: DebugStreamEvent): EventSourceMessage {
  return {
    id: event.seq !== undefined ? String(event.seq) : '',
    event: event.type,
    data: JSON.stringify(event),
  };
}

describe('debug-stream-bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T00:00:00.000Z'));
    process.env.NEBULA_INTERNAL_TOKEN = 'bridge-secret';
    process.env.PLAYWRIGHT_HOST = 'playwright.internal';
    process.env.PLAYWRIGHT_PORT = '3100';
    mockFetchEventSourceState.reset();
  });

  afterEach(async () => {
    const { debugStreamBridge } = await import('../services/debug-stream-bridge.js');
    await debugStreamBridge.stop();
    vi.useRealTimers();
    delete process.env.NEBULA_INTERNAL_TOKEN;
    delete process.env.PLAYWRIGHT_HOST;
    delete process.env.PLAYWRIGHT_PORT;
  });

  it('opens only one upstream connection and sends the internal auth header', async () => {
    const { debugStreamBridge } = await import('../services/debug-stream-bridge.js');

    debugStreamBridge.start();
    debugStreamBridge.start();

    expect(mockFetchEventSourceState.getCallCount()).toBe(1);
    expect(debugStreamBridge.isRunning()).toBe(true);

    const init = mockFetchEventSourceState.getLastInit();
    expect(init?.headers).toEqual({
      'x-nebula-internal-token': 'bridge-secret',
    });
  });

  it('reassigns local sequence numbers and updates latest status cache', async () => {
    const { debugEventHub } = await import('../services/debug-event-hub.js');
    const { debugStreamBridge } = await import('../services/debug-stream-bridge.js');
    const received: DebugStreamEvent[] = [];
    const unsubscribe = debugEventHub.subscribe((event) => received.push(event));

    debugStreamBridge.start();
    const init = mockFetchEventSourceState.getLastInit();

    const snapshotEvent: DebugSnapshotEvent = {
      type: 'debug.snapshot',
      seq: 77,
      status: createStatus('snapshot'),
      emittedAt: '2026-05-02T00:00:00.000Z',
    };
    const markerEvent: DebugMarkerEvent = {
      type: 'debug.marker',
      seq: 78,
      marker: {
        source: 'system',
        pageX: 12,
        pageY: 24,
      },
      emittedAt: '2026-05-02T00:00:01.000Z',
    };
    const overlayEvent: DebugOverlayEvent = {
      type: 'debug.overlay',
      seq: 79,
      overlay: {
        kind: 'highlight',
        source: 'system',
        bbox: { x: 1, y: 2, width: 3, height: 4 },
      },
      emittedAt: '2026-05-02T00:00:02.000Z',
    };
    const keepaliveEvent: DebugKeepaliveEvent = {
      type: 'debug.keepalive',
      seq: 80,
      emittedAt: '2026-05-02T00:00:03.000Z',
    };

    await init?.onmessage?.(createMessage(snapshotEvent));
    await init?.onmessage?.(createMessage(markerEvent));
    await init?.onmessage?.(createMessage(overlayEvent));
    await init?.onmessage?.(createMessage(keepaliveEvent));

    expect(received).toHaveLength(4);
    expect(received.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(debugEventHub.getLatestStatus()).toEqual(snapshotEvent.status);

    unsubscribe();
  });

  it('retries indefinitely and emits debug.error after five minutes of continuous failure', async () => {
    const { debugEventHub } = await import('../services/debug-event-hub.js');
    const { debugStreamBridge } = await import('../services/debug-stream-bridge.js');
    const received: DebugStreamEvent[] = [];
    const unsubscribe = debugEventHub.subscribe((event) => received.push(event));

    debugStreamBridge.start();
    const init = mockFetchEventSourceState.getLastInit();
    expect(init).toBeTruthy();

    const firstDelay = await init?.onerror?.(new Error('upstream offline'));
    expect(firstDelay).toBeGreaterThan(0);
    expect(debugStreamBridge.isRunning()).toBe(true);
    expect(received).toEqual([]);

    vi.setSystemTime(new Date('2026-05-02T00:05:01.000Z'));
    const secondDelay = await init?.onerror?.(new Error('still offline'));

    expect(secondDelay).toBeGreaterThan(firstDelay ?? 0);
    expect(debugStreamBridge.isRunning()).toBe(true);

    const errorEvent = received.find((event): event is Extract<DebugStreamEvent, { type: 'debug.error' }> => (
      event.type === 'debug.error'
    ));
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.code).toBe('bridge_failure');
    expect(errorEvent?.message).toContain('continuous upstream failure');

    unsubscribe();
  });

  it('resets the failure window after a successful upstream open', async () => {
    const { debugEventHub } = await import('../services/debug-event-hub.js');
    const { debugStreamBridge } = await import('../services/debug-stream-bridge.js');
    const received: DebugStreamEvent[] = [];
    const unsubscribe = debugEventHub.subscribe((event) => received.push(event));

    debugStreamBridge.start();
    const init = mockFetchEventSourceState.getLastInit();
    expect(init).toBeTruthy();

    await init?.onerror?.(new Error('temporary outage'));
    vi.setSystemTime(new Date('2026-05-02T00:01:00.000Z'));
    await init?.onopen?.(new Response('', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    const statusEvent: DebugStatusEvent = {
      type: 'debug.status',
      seq: 99,
      status: createStatus('navigate'),
      emittedAt: '2026-05-02T00:01:01.000Z',
    };
    await init?.onmessage?.(createMessage(statusEvent));

    vi.setSystemTime(new Date('2026-05-02T00:05:30.000Z'));
    await init?.onerror?.(new Error('fresh outage'));

    expect(received.some((event) => event.type === 'debug.error')).toBe(false);
    expect(debugEventHub.getLatestStatus()).toEqual(statusEvent.status);

    unsubscribe();
  });
});
