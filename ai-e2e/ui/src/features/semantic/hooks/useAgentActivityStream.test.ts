import { act, renderHook } from '@testing-library/react';
import {
  AGENT_STREAM_EVENT_SCHEMA,
  AGENT_STREAM_SNAPSHOT_SCHEMA,
} from '@nebula-link-evo/shared/types/agent-stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentActivityStream } from './useAgentActivityStream.js';

class MockEventSource {
  static instances: MockEventSource[] = [];
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  readonly close = vi.fn();
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, value: unknown) {
    const event = new MessageEvent(type, {
      data: typeof value === 'string' ? value : JSON.stringify(value),
    });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const occurredAt = '2026-08-27T08:00:00.000Z';

describe('useAgentActivityStream', () => {
  let scheduledFrame: FrameRequestCallback | null;

  beforeEach(() => {
    MockEventSource.instances = [];
    scheduledFrame = null;
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('从 snapshot 恢复并批量归并增量', () => {
    const { result } = renderHook(() =>
      useAgentActivityStream({
        endpoint: '/api/v1/runs/run-1/activity',
        streamId: 'run-1',
        enabled: true,
      })
    );
    const source = MockEventSource.instances[0];
    act(() => {
      source?.emit('agent_stream.snapshot', {
        schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
        streamId: 'run-1',
        seq: 0,
        state: 'streaming',
        generatedAt: occurredAt,
        turns: [],
      });
      source?.emit('agent_stream.event', {
        schema: AGENT_STREAM_EVENT_SCHEMA,
        streamId: 'run-1',
        turnId: 'task-1',
        sectionId: 'tool-1',
        seq: 1,
        occurredAt,
        type: 'section.upsert',
        section: {
          type: 'activity',
          sectionId: 'tool-1',
          createdAt: occurredAt,
          updatedAt: occurredAt,
          kind: 'tool',
          state: 'running',
          title: '读取页面',
        },
      });
    });

    expect(result.current.snapshot?.seq).toBe(0);
    act(() => scheduledFrame?.(0));
    expect(result.current.snapshot).toMatchObject({
      seq: 1,
      turns: [{ sections: [{ type: 'activity', title: '读取页面' }] }],
    });
  });

  it('禁用时不连接，损坏事件不会破坏已有 snapshot', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useAgentActivityStream({
          endpoint: '/api/v1/runs/run-1/activity',
          streamId: 'run-1',
          enabled,
        }),
      { initialProps: { enabled: false } }
    );
    expect(MockEventSource.instances).toHaveLength(0);
    rerender({ enabled: true });
    act(() => MockEventSource.instances[0]?.emit('agent_stream.event', '{bad-json'));
    expect(result.current.snapshot).toBeNull();
  });

  it('断线和手动恢复保留当前 snapshot，旧上下文切换前的 render 立即隐藏内容', () => {
    const renders: Array<number | null> = [];
    const { result, rerender } = renderHook(
      ({ endpoint, streamId }) => {
        const activity = useAgentActivityStream({ endpoint, streamId, enabled: true });
        renders.push(activity.snapshot?.seq ?? null);
        return activity;
      },
      { initialProps: { endpoint: '/api/v1/runs/run-1/activity', streamId: 'run-1' } }
    );
    const source = MockEventSource.instances[0];
    act(() =>
      source?.emit('agent_stream.snapshot', {
        schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
        streamId: 'run-1',
        seq: 7,
        state: 'completed',
        generatedAt: occurredAt,
        turns: [],
      })
    );
    act(() => source?.onerror?.());
    expect(result.current.snapshot?.seq).toBe(7);
    expect(result.current.status).toBe('reconnecting');
    act(() => result.current.reconnect());
    expect(result.current.snapshot?.seq).toBe(7);
    renders.length = 0;
    rerender({ endpoint: '/api/v1/authoring-jobs/job-1/activity', streamId: 'job-1' });
    expect(renders.every((seq) => seq === null)).toBe(true);
    act(() =>
      source?.emit('agent_stream.snapshot', {
        schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
        streamId: 'run-1',
        seq: 8,
        state: 'completed',
        generatedAt: occurredAt,
        turns: [],
      })
    );
    expect(result.current.snapshot).toBeNull();
  });

  it('相同 streamId 更换 endpoint 也不会在 effect 前显示旧快照', () => {
    const renders: Array<number | null> = [];
    const { rerender } = renderHook(
      ({ endpoint }) => {
        const activity = useAgentActivityStream({ endpoint, streamId: 'run-1', enabled: true });
        renders.push(activity.snapshot?.seq ?? null);
        return activity;
      },
      { initialProps: { endpoint: '/one' } }
    );
    act(() =>
      MockEventSource.instances[0]?.emit('agent_stream.snapshot', {
        schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
        streamId: 'run-1',
        seq: 9,
        state: 'completed',
        generatedAt: occurredAt,
        turns: [],
      })
    );
    renders.length = 0;
    rerender({ endpoint: '/two' });
    expect(renders.every((seq) => seq === null)).toBe(true);
  });
});
