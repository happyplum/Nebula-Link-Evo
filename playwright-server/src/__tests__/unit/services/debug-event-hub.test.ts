import { beforeEach, describe, expect, it } from 'vitest';
import type { DebugPlaywrightState, DebugStreamEvent } from '@nebula-link-evo/shared/types/debug-events.js';
import { DebugEventHub, debugEventHub } from '../../../services/debug-event-hub.js';

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

function createEvent(type: DebugStreamEvent['type'], seq?: number): DebugStreamEvent {
  const emittedAt = '2026-05-02T00:00:00.000Z';

  if (type === 'debug.snapshot') {
    return { type, seq, emittedAt, status: createStatus('snapshot') };
  }

  if (type === 'debug.status') {
    return { type, seq, emittedAt, status: createStatus('navigate') };
  }

  return { type: 'debug.keepalive', seq, emittedAt };
}

describe('DebugEventHub', () => {
  beforeEach(() => {
    debugEventHub.resetForTests();
  });

  it('delivers published events to subscribers', () => {
    const hub = new DebugEventHub();
    const received: DebugStreamEvent[] = [];

    hub.subscribe((event) => {
      received.push(event);
    });

    const event = createEvent('debug.status', hub.getNextSeq());
    hub.publish(event);

    expect(received).toEqual([event]);
  });

  it('stops delivery after unsubscribe', () => {
    const hub = new DebugEventHub();
    const received: DebugStreamEvent[] = [];
    const unsubscribe = hub.subscribe((event) => {
      received.push(event);
    });

    unsubscribe();
    hub.publish(createEvent('debug.status', hub.getNextSeq()));

    expect(received).toEqual([]);
  });

  it('caches latest status from snapshot and status events', () => {
    const hub = new DebugEventHub();
    const snapshotStatus = createStatus('snapshot');
    const nextStatus = createStatus('navigate');

    hub.publish({
      type: 'debug.snapshot',
      seq: hub.getNextSeq(),
      emittedAt: '2026-05-02T00:00:00.000Z',
      status: snapshotStatus,
    });
    expect(hub.getLatestStatus()).toEqual(snapshotStatus);

    hub.publish({
      type: 'debug.status',
      seq: hub.getNextSeq(),
      emittedAt: '2026-05-02T00:00:01.000Z',
      status: nextStatus,
    });
    expect(hub.getLatestStatus()).toEqual(nextStatus);
  });

  it('returns monotonically increasing sequence numbers', () => {
    const hub = new DebugEventHub();

    expect(hub.getNextSeq()).toBe(1);
    expect(hub.getNextSeq()).toBe(2);

    hub.publish(createEvent('debug.keepalive', hub.getNextSeq()));

    expect(hub.getNextSeq()).toBe(4);
  });

  it('resetForTests clears subscribers, cache, and sequence state', () => {
    const received: DebugStreamEvent[] = [];
    debugEventHub.subscribe((event) => {
      received.push(event);
    });
    debugEventHub.publish(createEvent('debug.status', debugEventHub.getNextSeq()));

    expect(received).toHaveLength(1);
    expect(debugEventHub.getLatestStatus()).not.toBeNull();

    debugEventHub.resetForTests();
    debugEventHub.publish(createEvent('debug.status', debugEventHub.getNextSeq()));

    expect(received).toHaveLength(1);
    expect(debugEventHub.getLatestStatus()).toEqual(createStatus('navigate'));
    expect(debugEventHub.getNextSeq()).toBe(2);
  });
});
