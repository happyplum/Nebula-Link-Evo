import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_STREAM_EVENT_SCHEMA,
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  type AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import { reduceAgentStream } from '@nebula-link-evo/shared';
import { useAgentStreamConnection } from './index.js';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly close = vi.fn();
  readonly listeners = new Map<string, (event: MessageEvent) => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }
  emit(type: string, value: unknown) {
    this.listeners.get(type)?.({
      data: typeof value === 'string' ? value : JSON.stringify(value),
    } as MessageEvent);
  }
}
const time = '2026-08-27T08:00:00.000Z';
const snapshot: AgentStreamSnapshotV1 = {
  schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
  streamId: 'one',
  seq: 0,
  state: 'streaming',
  generatedAt: time,
  turns: [],
};
const event = {
  schema: AGENT_STREAM_EVENT_SCHEMA,
  streamId: 'one',
  seq: 1,
  turnId: 'assistant',
  sectionId: 'content',
  occurredAt: time,
  type: 'content.delta',
  delta: '保留',
};
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const latest = () => FakeEventSource.instances.at(-1) as FakeEventSource;
const flush = () => {
  for (const callback of [...frames.values()]) callback(0);
  frames.clear();
};
const setup = (overrides = {}) => {
  const onSnapshot = vi.fn();
  const onEvents = vi.fn();
  const props = {
    endpoint: '/one',
    streamId: 'one',
    enabled: true,
    onSnapshot,
    onEvents,
    ...overrides,
  };
  return {
    ...renderHook((options) => useAgentStreamConnection(options), { initialProps: props }),
    onSnapshot,
    onEvents,
  };
};

describe('useAgentStreamConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    frames = new Map();
    frameId = 0;
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frames.delete(id))
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('only a matching valid snapshot becomes live; drops pre-snapshot deltas and malformed input', () => {
    const { result, onSnapshot, onEvents } = setup();
    expect(result.current.status).toBe('connecting');
    act(() => {
      latest().onopen?.();
      latest().emit('agent_stream.event', event);
      for (const value of ['{bad', null, {}, { ...snapshot, streamId: 'other' }])
        latest().emit('agent_stream.snapshot', value);
    });
    expect(result.current.status).toBe('connecting');
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    act(() => latest().emit('agent_stream.snapshot', snapshot));
    expect(result.current.status).toBe('live');
    expect(onSnapshot).toHaveBeenCalledWith(snapshot);
    act(() => {
      for (const value of ['{bad', null, {}, { ...event, streamId: 'other' }])
        latest().emit('agent_stream.event', value);
      latest().listeners.get('agent_stream.event')?.({ data: 1 } as MessageEvent);
      flush();
    });
    expect(onEvents).not.toHaveBeenCalled();
  });

  it('batches events once and leaves duplicate sequence replay to the shared sink', () => {
    let state = snapshot;
    const sink = vi.fn((events) => {
      state = events.reduce(reduceAgentStream, state);
    });
    setup({ onEvents: sink });
    act(() => {
      latest().emit('agent_stream.snapshot', snapshot);
      latest().emit('agent_stream.event', event);
      latest().emit('agent_stream.event', event);
      latest().emit('agent_stream.event', { ...event, seq: 2, delta: '内容' });
    });
    expect(frames.size).toBe(1);
    expect(sink).not.toHaveBeenCalled();
    act(flush);
    expect(sink).toHaveBeenCalledWith([event, event, { ...event, seq: 2, delta: '内容' }]);
    expect(state).toMatchObject({ seq: 2, turns: [{ sections: [{ markdown: '保留内容' }] }] });
  });

  it('a new snapshot supersedes the pending batch, including an already queued old frame callback', () => {
    const { onEvents } = setup();
    act(() => {
      latest().emit('agent_stream.snapshot', snapshot);
      latest().emit('agent_stream.event', event);
    });
    const staleFrame = [...frames.values()][0];
    act(() => {
      latest().emit('agent_stream.snapshot', { ...snapshot, seq: 10 });
      latest().emit('agent_stream.event', { ...event, seq: 11 });
      staleFrame?.(0);
    });
    expect(onEvents).not.toHaveBeenCalled();
    act(flush);
    expect(onEvents).toHaveBeenCalledExactlyOnceWith([{ ...event, seq: 11 }]);
  });

  it('retries without a limit at 1/2/4/8/16/30 seconds and onopen never resets backoff', () => {
    const { result } = setup();
    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000];
    for (const [index, delay] of delays.entries()) {
      const previous = latest();
      act(() => {
        previous.onopen?.();
        previous.onerror?.();
        previous.onerror?.();
      });
      expect(previous.close).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('reconnecting');
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(FakeEventSource.instances).toHaveLength(index + 1);
      act(() => vi.advanceTimersByTime(1));
      expect(FakeEventSource.instances).toHaveLength(index + 2);
    }
  });

  it('only valid snapshots reset backoff', () => {
    setup();
    act(() => {
      latest().onerror?.();
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      latest().emit('agent_stream.snapshot', { ...snapshot, streamId: 'other' });
      latest().onerror?.();
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      latest().emit('agent_stream.snapshot', snapshot);
      latest().onerror?.();
    });
    act(() => vi.advanceTimersByTime(999));
    expect(FakeEventSource.instances).toHaveLength(3);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it('manual reconnect immediately replaces the source and clears the retry timer', () => {
    const { result } = setup();
    act(() => latest().onerror?.());
    act(() => result.current.reconnect());
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.status).toBe('reconnecting');
    act(() => {
      latest().onerror?.();
      vi.advanceTimersByTime(1999);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it.each(['disconnect', 'disabled', 'unmount'] as const)(
    '%s closes and drops pending work without applying it',
    (action) => {
      const hook = setup();
      act(() => {
        latest().emit('agent_stream.snapshot', snapshot);
        latest().emit('agent_stream.event', event);
      });
      const oldSource = latest();
      const oldFrame = [...frames.values()][0];
      if (action === 'disabled')
        hook.rerender({
          endpoint: '/one',
          streamId: 'one',
          enabled: false,
          onSnapshot: hook.onSnapshot,
          onEvents: hook.onEvents,
        });
      else if (action === 'unmount') hook.unmount();
      else act(() => hook.result.current.disconnect());
      act(() => {
        oldFrame?.(0);
        oldSource.onerror?.();
        oldSource.emit('agent_stream.snapshot', snapshot);
        oldSource.emit('agent_stream.event', event);
      });
      expect(oldSource.close).toHaveBeenCalledTimes(1);
      expect(hook.onEvents).not.toHaveBeenCalled();
      expect(hook.onSnapshot).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(frames.size).toBe(0);
      if (action !== 'unmount') expect(hook.result.current.status).toBe('disconnected');
    }
  );

  it.each(['disconnect', 'disabled', 'unmount'] as const)('%s clears retry resources', (action) => {
    const hook = setup();
    act(() => latest().onerror?.());
    if (action === 'disabled')
      hook.rerender({
        endpoint: '/one',
        streamId: 'one',
        enabled: false,
        onSnapshot: hook.onSnapshot,
        onEvents: hook.onEvents,
      });
    else if (action === 'unmount') hook.unmount();
    else act(() => hook.result.current.disconnect());
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { endpoint: '/two', streamId: 'one' },
    { endpoint: '/one', streamId: 'two' },
  ])('isolates old source and RAF on context switch: %o', (context) => {
    const hook = setup();
    act(() => {
      latest().emit('agent_stream.snapshot', snapshot);
      latest().emit('agent_stream.event', event);
    });
    const oldSource = latest();
    const oldFrame = [...frames.values()][0];
    hook.rerender({
      ...context,
      enabled: true,
      onSnapshot: hook.onSnapshot,
      onEvents: hook.onEvents,
    });
    act(() => {
      oldSource.onopen?.();
      oldSource.onerror?.();
      oldFrame?.(0);
      oldSource.emit('agent_stream.snapshot', snapshot);
      oldSource.emit('agent_stream.event', event);
    });
    expect(hook.result.current.status).toBe('connecting');
    expect(hook.onSnapshot).toHaveBeenCalledTimes(1);
    expect(hook.onEvents).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    act(() => latest().emit('agent_stream.snapshot', { ...snapshot, streamId: context.streamId }));
    expect(hook.result.current.status).toBe('live');
  });

  it('isolates stale timer callbacks even if cancellation races with delivery', () => {
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    const hook = setup();
    act(() => latest().onerror?.());
    const oldTimer = timerSpy.mock.calls.at(-1)?.[0] as () => void;
    act(() => {
      hook.result.current.reconnect();
      oldTimer();
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => latest().onerror?.());
    const contextTimer = timerSpy.mock.calls.at(-1)?.[0] as () => void;
    hook.rerender({
      endpoint: '/two',
      streamId: 'two',
      enabled: true,
      onSnapshot: hook.onSnapshot,
      onEvents: hook.onEvents,
    });
    act(() => contextTimer());
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it('an error drops pending deltas and obsolete callbacks cannot affect the replacement', () => {
    const hook = setup();
    act(() => {
      latest().emit('agent_stream.snapshot', snapshot);
      latest().emit('agent_stream.event', event);
    });
    const oldSource = latest();
    const oldFrame = [...frames.values()][0];
    act(() => {
      oldSource.onerror?.();
      vi.advanceTimersByTime(1000);
      latest().emit('agent_stream.snapshot', snapshot);
    });
    act(() => {
      oldSource.emit('agent_stream.snapshot', snapshot);
      oldSource.emit('agent_stream.event', event);
      oldSource.onerror?.();
      oldFrame?.(0);
    });
    expect(hook.result.current.status).toBe('live');
    expect(hook.onSnapshot).toHaveBeenCalledTimes(2);
    expect(hook.onEvents).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not connect while disabled, with no stream, or without EventSource', () => {
    setup({ enabled: false });
    setup({ streamId: '' });
    vi.stubGlobal('EventSource', undefined);
    const { result } = setup();
    act(() => {
      result.current.reconnect();
      result.current.disconnect();
    });
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.status).toBe('disconnected');
  });

  it('uses the latest callbacks without reopening the connection', () => {
    const hook = setup();
    const onSnapshot = vi.fn();
    const onEvents = vi.fn();
    hook.rerender({ endpoint: '/one', streamId: 'one', enabled: true, onSnapshot, onEvents });
    act(() => {
      latest().emit('agent_stream.snapshot', snapshot);
      latest().emit('agent_stream.event', event);
      flush();
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(hook.onSnapshot).not.toHaveBeenCalled();
    expect(onSnapshot).toHaveBeenCalledWith(snapshot);
    expect(onEvents).toHaveBeenCalledWith([event]);
  });

  it('re-enabling the same context never renders live before a new snapshot', () => {
    const renders: string[] = [];
    const { result, rerender } = renderHook(
      ({ enabled }) => {
        const connection = useAgentStreamConnection({
          endpoint: '/one',
          streamId: 'one',
          enabled,
          onSnapshot: vi.fn(),
          onEvents: vi.fn(),
        });
        renders.push(connection.status);
        return connection;
      },
      { initialProps: { enabled: true } }
    );
    act(() => latest().emit('agent_stream.snapshot', snapshot));
    expect(result.current.status).toBe('live');
    rerender({ enabled: false });
    renders.length = 0;
    rerender({ enabled: true });
    expect(renders).not.toContain('live');
    expect(result.current.status).toBe('connecting');
    act(() => latest().emit('agent_stream.snapshot', snapshot));
    expect(result.current.status).toBe('live');
  });
});
