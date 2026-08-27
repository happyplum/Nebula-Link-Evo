import { act, renderHook } from '@testing-library/react';
import {
  AGENT_STREAM_EVENT_SCHEMA,
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  type AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../store/chat.store.js';
import { useChatStream } from './useChatStream.js';

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly close = vi.fn();

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
const emptySnapshot: AgentStreamSnapshotV1 = {
  schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
  streamId: 'session-1',
  seq: 0,
  state: 'streaming',
  generatedAt: occurredAt,
  turns: [],
};

describe('useChatStream', () => {
  let scheduledFrame: FrameRequestCallback | null;

  beforeEach(() => {
    useChatStore.getState().reset();
    MockEventSource.instances = [];
    scheduledFrame = null;
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('以 snapshot 启动并在单个 animation frame 内批量应用 live event', () => {
    renderHook(() => useChatStream({ sessionId: 'session-1' }));
    const source = MockEventSource.instances[0];
    expect(source?.url).toBe('/api/v1/chat/sessions/session-1/stream');

    act(() => {
      source?.emit('agent_stream.snapshot', emptySnapshot);
      source?.emit('agent_stream.event', {
        schema: AGENT_STREAM_EVENT_SCHEMA,
        streamId: 'session-1',
        turnId: 'assistant:1',
        sectionId: 'content:1',
        seq: 1,
        occurredAt,
        type: 'content.delta',
        delta: '中间',
      });
      source?.emit('agent_stream.event', {
        schema: AGENT_STREAM_EVENT_SCHEMA,
        streamId: 'session-1',
        turnId: 'assistant:1',
        sectionId: 'content:1',
        seq: 2,
        occurredAt,
        type: 'content.delta',
        delta: '答复',
      });
    });

    expect(useChatStore.getState().activityBySession['session-1']?.seq).toBe(0);
    act(() => scheduledFrame?.(0));
    expect(useChatStore.getState().activityBySession['session-1']).toMatchObject({
      seq: 2,
      turns: [{ sections: [{ type: 'content', markdown: '中间答复' }] }],
    });
  });

  it('忽略错误 stream、未知协议和损坏 JSON', () => {
    renderHook(() => useChatStream({ sessionId: 'session-1' }));
    const source = MockEventSource.instances[0];
    act(() => {
      source?.emit('agent_stream.snapshot', emptySnapshot);
      source?.emit('agent_stream.event', '{not-json');
      source?.emit('agent_stream.event', { type: 'assistant.delta', seq: 1 });
      source?.emit('agent_stream.event', {
        schema: AGENT_STREAM_EVENT_SCHEMA,
        streamId: 'session-2',
        turnId: 'assistant:1',
        sectionId: 'content:1',
        seq: 1,
        occurredAt,
        type: 'content.delta',
        delta: '不可见',
      });
    });

    expect(scheduledFrame).toBeNull();
    expect(useChatStore.getState().activityBySession['session-1']?.turns).toEqual([]);
  });

  it('连接成功后清除错误，disconnect 会关闭连接并清理待处理 frame', () => {
    const { result } = renderHook(() => useChatStream({ sessionId: 'session-1' }));
    const source = MockEventSource.instances[0];

    act(() => source?.onopen?.());
    expect(result.current.isConnected).toBe(true);
    act(() => {
      source?.emit('agent_stream.event', {
        schema: AGENT_STREAM_EVENT_SCHEMA,
        streamId: 'session-1',
        turnId: 'assistant:1',
        sectionId: 'content:1',
        seq: 1,
        occurredAt,
        type: 'content.delta',
        delta: '落盘',
      });
      result.current.disconnect();
    });

    expect(source?.close).toHaveBeenCalled();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(useChatStore.getState().activityBySession['session-1']?.seq).toBe(1);
    expect(result.current).toMatchObject({ isConnected: false, error: null });
  });

  it('错误时指数退避重连，连续六次失败后暴露错误状态', () => {
    vi.useFakeTimers();
    useChatStore.getState().setActiveSession('session-1');
    const { result } = renderHook(() => useChatStream({ sessionId: 'session-1' }));

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const source = MockEventSource.instances.at(-1);
      act(() => source?.onerror?.());
      if (attempt < 5) {
        act(() => vi.runOnlyPendingTimers());
      }
    }

    expect(MockEventSource.instances).toHaveLength(6);
    expect(result.current.error).toBe('活动流连接失败，请手动重试。');
    expect(useChatStore.getState().activityBySession['session-1']?.state).toBe('failed');

    act(() => result.current.reconnect());
    expect(MockEventSource.instances).toHaveLength(7);
    vi.useRealTimers();
  });

  it('disabled 或空 session 不连接，切换 session 后只接受新流', () => {
    const { rerender } = renderHook(
      ({ sessionId, enabled }) => useChatStream({ sessionId, enabled }),
      { initialProps: { sessionId: null as string | null, enabled: true } }
    );
    expect(MockEventSource.instances).toHaveLength(0);

    rerender({ sessionId: 'session-1', enabled: false });
    expect(MockEventSource.instances).toHaveLength(0);
    rerender({ sessionId: 'session-2', enabled: true });
    expect(MockEventSource.instances[0]?.url).toContain('session-2');

    act(() => {
      MockEventSource.instances[0]?.emit('agent_stream.snapshot', {
        ...emptySnapshot,
        streamId: 'session-1',
      });
      MockEventSource.instances[0]?.emit('agent_stream.snapshot', {
        ...emptySnapshot,
        streamId: 'session-2',
      });
    });
    expect(useChatStore.getState().activityBySession['session-1']).toBeUndefined();
    expect(useChatStore.getState().activityBySession['session-2']).toBeDefined();
  });
});
