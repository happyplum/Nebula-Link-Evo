import { describe, expect, it } from 'vitest';
import type { AgentTaskEventRecord } from './repository.js';
import { buildAgentTaskActivitySnapshot, projectAgentTaskEvent } from './activity-projector.js';
import type { AgentTaskView } from './types.js';

const occurredAt = '2026-08-27T08:00:00.000Z';

function event(seq: number, type: string, payload: Record<string, unknown>): AgentTaskEventRecord {
  return {
    id: `event-${seq}`,
    taskId: 'task-1',
    seq,
    type,
    entityType: 'task',
    entityId: 'task-1',
    stateVersion: seq,
    payload,
    occurredAt,
    createdAt: occurredAt,
  };
}

describe('Agent Task 活动投影', () => {
  it('以稳定展示序列投影 Skill、Tool、思考摘要与预算', () => {
    const projected = [
      event(1, 'agent_task.skill_loaded', {
        skillId: 'browser-check',
        version: '1.2.0',
        contentHash: 'sha256:fixed',
      }),
      event(2, 'agent_task.model_turn', { phase: 'started', rawReasoning: '不得公开' }),
      event(3, 'agent_task.tool_call', {
        toolCallId: 'call-1',
        toolName: 'browser-control.operation_execute',
        arguments: { leaseToken: 'secret-token' },
      }),
      event(4, 'agent_task.tool_result', {
        toolCallId: 'call-1',
        toolName: 'browser-control.operation_execute',
        operationId: 'op-1',
        result: { page: 'private-result' },
      }),
      event(5, 'agent_task.budget_updated', {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      }),
    ].flatMap(projectAgentTaskEvent);

    expect(projected.map((item) => item.seq)).toEqual([4, 8, 12, 16, 20]);
    expect(JSON.stringify(projected)).not.toContain('不得公开');
    expect(JSON.stringify(projected)).not.toContain('secret-token');
    expect(JSON.stringify(projected)).not.toContain('private-result');
    expect(projected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'section.upsert',
          section: expect.objectContaining({
            type: 'activity',
            kind: 'skill',
            version: '1.2.0',
            contentHash: 'sha256:fixed',
          }),
        }),
        expect.objectContaining({
          type: 'section.upsert',
          section: expect.objectContaining({ type: 'reasoning', visibility: 'summary' }),
        }),
        expect.objectContaining({
          type: 'section.upsert',
          section: expect.objectContaining({
            type: 'activity',
            kind: 'browser',
            state: 'completed',
            artifactRefs: ['browser-operation:op-1'],
          }),
        }),
      ])
    );
  });

  it('使用 durable 事件时间并区分中断的 outcome_unknown', () => {
    const projected = projectAgentTaskEvent(
      event(7, 'agent_task.state_changed', { to: 'interrupted' })
    );
    expect(projected[0]).toMatchObject({
      occurredAt,
      section: {
        createdAt: occurredAt,
        updatedAt: occurredAt,
        state: 'outcome_unknown',
      },
    });
    expect(projected[1]).toMatchObject({ type: 'stream.state', state: 'recovering' });
  });

  it('从完整事件序列恢复最终活动状态', () => {
    const task = {
      schema: 'nebula.ai.agent-task/1.0',
      taskId: 'task-1',
      clientTaskId: 'client-1',
      status: 'completed',
      stateVersion: 3,
      eventSeq: 3,
      toolCalls: [],
      createdAt: occurredAt,
      updatedAt: occurredAt,
    } satisfies AgentTaskView;
    const snapshot = buildAgentTaskActivitySnapshot(task, [
      event(1, 'agent_task.created', {}),
      event(2, 'agent_task.state_changed', { to: 'running' }),
      event(3, 'agent_task.state_changed', { to: 'completed' }),
    ]);
    const activity = snapshot.turns[0]?.sections.find((section) => section.type === 'activity');

    expect(snapshot.state).toBe('completed');
    expect(activity).toMatchObject({ state: 'completed', summary: '任务已完成' });
  });
});
