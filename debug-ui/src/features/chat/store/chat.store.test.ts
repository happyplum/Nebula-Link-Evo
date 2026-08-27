import {
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  type AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from './chat.store.js';
import {
  selectActiveActivity,
  selectActiveSession,
  selectActiveSessionId,
  selectConnectivityResult,
  selectIsLoadingSessions,
  selectSessions,
  selectStreamingState,
} from './chat.store.js';

const occurredAt = '2026-08-27T08:00:00.000Z';

function snapshot(turnId: string): AgentStreamSnapshotV1 {
  return {
    schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
    streamId: 'session-1',
    seq: 1,
    state: 'streaming',
    generatedAt: occurredAt,
    turns: [
      {
        turnId,
        role: 'user',
        state: 'completed',
        createdAt: occurredAt,
        updatedAt: occurredAt,
        sections: [
          {
            type: 'user',
            sectionId: `${turnId}:content`,
            createdAt: occurredAt,
            updatedAt: occurredAt,
            markdown: '检查结算页',
          },
        ],
      },
    ],
  };
}

describe('chat activity store', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('在服务端 snapshot 先于 POST 响应时仍去重乐观用户 turn', () => {
    const store = useChatStore.getState();
    const optimisticId = store.addOptimisticTurn('session-1', '检查结算页');
    store.setActivitySnapshot('session-1', snapshot('user:message-1'));
    store.reconcileOptimisticTurn('session-1', optimisticId, 'message-1');

    expect(useChatStore.getState().activityBySession['session-1'].turns).toHaveLength(1);
    expect(useChatStore.getState().activityBySession['session-1'].turns[0]?.turnId).toBe(
      'user:message-1'
    );
  });

  it('忽略重复 seq 并原位更新稳定 section', () => {
    const store = useChatStore.getState();
    store.setActivitySnapshot('session-1', { ...snapshot('user:message-1'), turns: [], seq: 0 });
    const base = {
      schema: 'nebula.ai.agent-stream.event/1.0' as const,
      streamId: 'session-1',
      turnId: 'assistant:1',
      sectionId: 'tool:1',
      occurredAt,
      type: 'section.upsert' as const,
    };
    store.applyActivityEvent('session-1', {
      ...base,
      seq: 1,
      section: {
        type: 'activity',
        sectionId: 'tool:1',
        createdAt: occurredAt,
        updatedAt: occurredAt,
        kind: 'tool',
        state: 'running',
        title: '读取页面',
      },
    });
    store.applyActivityEvent('session-1', {
      ...base,
      seq: 1,
      section: {
        type: 'activity',
        sectionId: 'tool:1',
        createdAt: occurredAt,
        updatedAt: occurredAt,
        kind: 'tool',
        state: 'failed',
        title: '不应覆盖',
      },
    });

    expect(useChatStore.getState().activityBySession['session-1']).toMatchObject({
      seq: 1,
      turns: [{ sections: [{ state: 'running', title: '读取页面' }] }],
    });
  });

  it('维护会话、活动和连接状态，并在删除当前会话时清理关联活动', () => {
    const store = useChatStore.getState();
    store.setSessions([{ id: 'session-1', title: '一' }]);
    store.addSession({ id: 'session-2', title: '二' });
    store.setActiveSession('session-1');
    store.setActivitySnapshot('session-1', snapshot('user:message-1'));
    store.setIsLoadingSessions(true);
    store.setConnectivityResult({ ok: true, latencyMs: 12, message: '正常' });

    const state = useChatStore.getState();
    expect(selectSessions(state).map((session) => session.id)).toEqual(['session-2', 'session-1']);
    expect(selectActiveSessionId(state)).toBe('session-1');
    expect(selectActiveSession(state)?.title).toBe('一');
    expect(selectActiveActivity(state)?.streamId).toBe('session-1');
    expect(selectIsLoadingSessions(state)).toBe(true);
    expect(selectConnectivityResult(state)?.latencyMs).toBe(12);

    store.removeSession('session-1');
    expect(selectActiveSession(useChatStore.getState())).toBeNull();
    expect(selectActiveActivity(useChatStore.getState())).toBeNull();
    expect(useChatStore.getState().activityBySession['session-1']).toBeUndefined();
  });

  it('对账乐观 turn 时同时覆盖、去重并安全处理未知会话', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'temp-id' });
    const store = useChatStore.getState();
    const optimisticId = store.addOptimisticTurn('session-1', '检查结算页');
    expect(optimisticId).toBe('optimistic:temp-id');
    store.reconcileOptimisticTurn('session-1', optimisticId, 'message-1');
    expect(useChatStore.getState().activityBySession['session-1'].turns[0]).toMatchObject({
      turnId: 'user:message-1',
      sections: [{ sectionId: 'user:message-1:content' }],
    });

    const before = useChatStore.getState();
    store.reconcileOptimisticTurn('missing', 'optimistic:missing', 'message-2');
    expect(useChatStore.getState()).toBe(before);
    vi.unstubAllGlobals();
  });

  it.each([
    ['idle', 'idle'],
    ['streaming', 'streaming'],
    ['paused', 'paused'],
    ['blocked', 'paused'],
    ['error', 'failed'],
  ] as const)('将本地 %s 状态映射为活动流 %s', (localState, expected) => {
    const store = useChatStore.getState();
    store.setStreamingState(localState);
    expect(useChatStore.getState().activityBySession).toEqual({});

    store.setActiveSession('session-1');
    store.setStreamingState(localState);
    expect(useChatStore.getState().activityBySession['session-1']?.state).toBe(expected);
    expect(selectStreamingState(useChatStore.getState())).toBe(
      expected === 'failed' ? 'error' : expected === 'paused' ? 'paused' : expected
    );
  });

  it.each(['completed', 'cancelled'] as const)('将终态 %s 投影为本地 idle', (state) => {
    useChatStore.getState().setActiveSession('session-1');
    useChatStore.getState().setActivitySnapshot('session-1', {
      ...snapshot('user:message-1'),
      state,
    });
    expect(selectStreamingState(useChatStore.getState())).toBe('idle');
  });
});
