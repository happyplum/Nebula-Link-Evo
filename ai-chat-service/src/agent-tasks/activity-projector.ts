import {
  AGENT_STREAM_EVENT_SCHEMA,
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  type AgentStreamActivityState,
  type AgentStreamEventV1,
  type AgentStreamSnapshotV1,
  type AgentStreamState,
} from '@nebula-link-evo/shared/types/agent-stream';
import type { AgentTaskEventRecord } from './repository.js';
import type { AgentTaskStatus, AgentTaskView } from './types.js';

const EVENTS_PER_SOURCE = 4;
type AgentStreamEventBody = AgentStreamEventV1 extends infer Event
  ? Event extends AgentStreamEventV1
    ? Omit<Event, 'schema' | 'streamId' | 'turnId' | 'seq' | 'occurredAt'>
    : never
  : never;

export function projectAgentTaskEvent(event: AgentTaskEventRecord): AgentStreamEventV1[] {
  const turnId = `task:${event.taskId}`;
  const base = {
    schema: AGENT_STREAM_EVENT_SCHEMA,
    streamId: event.taskId,
    turnId,
    occurredAt: event.occurredAt,
  } as const;
  const projected: AgentStreamEventV1[] = [];
  const append = (value: AgentStreamEventBody) => {
    projected.push({
      ...base,
      seq: event.seq * EVENTS_PER_SOURCE + projected.length,
      ...value,
    } as AgentStreamEventV1);
  };

  switch (event.type) {
    case 'agent_task.created':
      append(
        activity(turnId, event.occurredAt, 'agent', 'queued', 'Agent 任务', '任务已创建，等待执行')
      );
      break;
    case 'agent_task.state_changed': {
      const status = String(event.payload.to ?? 'interrupted') as AgentTaskStatus;
      append(
        activity(
          turnId,
          event.occurredAt,
          'agent',
          activityState(status),
          'Agent 任务',
          stateSummary(status)
        )
      );
      append({
        type: 'stream.state',
        sectionId: `${turnId}:state`,
        state: streamState(status),
      });
      break;
    }
    case 'agent_task.model_turn': {
      const running = event.payload.phase === 'started';
      append({
        type: 'section.upsert',
        sectionId: `${turnId}:reasoning`,
        section: {
          type: 'reasoning',
          sectionId: `${turnId}:reasoning`,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          visibility: 'summary',
          summary: running ? '正在分析任务、证据与可用能力' : '已完成任务分析与决策',
          state: running ? 'running' : 'completed',
        },
      });
      break;
    }
    case 'agent_task.skill_loaded':
    case 'agent_task.skill_execute':
    case 'agent_task.skill_result':
    case 'agent_task.skill_failure': {
      const failed = event.type === 'agent_task.skill_failure';
      const completed = event.type === 'agent_task.skill_result';
      const state = failed ? 'failed' : completed ? 'completed' : 'running';
      const skillId = safeText(event.payload.skillId, 'Skill');
      append({
        type: 'section.upsert',
        sectionId: `${turnId}:skill:${skillId}`,
        section: {
          type: 'activity',
          sectionId: `${turnId}:skill:${skillId}`,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          kind: 'skill',
          state,
          title: skillId,
          summary: failed
            ? 'Skill 执行失败'
            : completed
              ? 'Skill 执行完成'
              : 'Skill 已固定并开始执行',
          ...(typeof event.payload.version === 'string' ? { version: event.payload.version } : {}),
          ...(typeof event.payload.contentHash === 'string'
            ? { contentHash: event.payload.contentHash }
            : {}),
        },
      });
      break;
    }
    case 'agent_task.tool_call':
    case 'agent_task.tool_result': {
      const toolCallId = safeText(event.payload.toolCallId, `seq-${event.seq}`);
      const toolName = safeText(event.payload.toolName, '工具执行');
      const completed = event.type === 'agent_task.tool_result';
      const failed = completed && event.payload.status === 'failed';
      append({
        type: 'section.upsert',
        sectionId: `${turnId}:tool:${toolCallId}`,
        section: {
          type: 'activity',
          sectionId: `${turnId}:tool:${toolCallId}`,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          kind: /browser-control|operation_/u.test(toolName) ? 'browser' : 'tool',
          state: failed ? 'failed' : completed ? 'completed' : 'running',
          title: toolName,
          summary: failed
            ? `工具失败：${safeText(event.payload.errorCode, 'execution_failed')}`
            : completed
              ? '工具已完成，详细结果通过受控证据查看。'
              : '工具正在执行',
          ...(typeof event.payload.operationId === 'string'
            ? { artifactRefs: [`browser-operation:${event.payload.operationId}`] }
            : {}),
        },
      });
      break;
    }
    case 'agent_task.content':
      append({
        type: 'section.upsert',
        sectionId: `${turnId}:content`,
        section: {
          type: 'content',
          sectionId: `${turnId}:content`,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          markdown: safeText(event.payload.markdown, ''),
          streaming: false,
        },
      });
      break;
    case 'agent_task.budget_updated':
      append({
        type: 'section.upsert',
        sectionId: `${turnId}:usage`,
        section: {
          type: 'turn-summary',
          sectionId: `${turnId}:usage`,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          summary: '本轮资源使用已结算',
          usage: {
            inputTokens: finiteNumber(event.payload.inputTokens),
            outputTokens: finiteNumber(event.payload.outputTokens),
            budgetUsed: finiteNumber(event.payload.totalTokens),
          },
        },
      });
      break;
    case 'agent_task.command.accepted':
    case 'agent_task.command.rejected':
      append({
        type: 'section.upsert',
        sectionId: `${turnId}:command:${event.entityId}`,
        section: {
          type: 'notice',
          sectionId: `${turnId}:command:${event.entityId}`,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          tone: event.type.endsWith('accepted') ? 'info' : 'warning',
          title: event.type.endsWith('accepted') ? '控制操作已接受' : '控制操作被拒绝',
        },
      });
      break;
    default:
      break;
  }
  return projected;
}

export function buildAgentTaskActivitySnapshot(
  task: AgentTaskView,
  events: readonly AgentTaskEventRecord[]
): AgentStreamSnapshotV1 {
  const projected = events.flatMap(projectAgentTaskEvent);
  const now = task.updatedAt;
  return {
    schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
    streamId: task.taskId,
    seq: projected.at(-1)?.seq ?? 0,
    state: streamState(task.status),
    generatedAt: now,
    turns: [
      {
        turnId: `task:${task.taskId}`,
        role: 'assistant',
        state:
          task.status === 'completed'
            ? 'completed'
            : task.status === 'failed'
              ? 'failed'
              : task.status === 'cancelled'
                ? 'cancelled'
                : 'streaming',
        createdAt: task.createdAt,
        updatedAt: now,
        sections: replaySections(projected),
      },
    ],
  };
}

function replaySections(events: readonly AgentStreamEventV1[]) {
  const sections = new Map<
    string,
    Extract<AgentStreamEventV1, { type: 'section.upsert' }>['section']
  >();
  for (const event of events) {
    if (event.type === 'section.upsert') sections.set(event.sectionId, event.section);
    if (event.type === 'section.remove') sections.delete(event.sectionId);
  }
  return [...sections.values()];
}

function activity(
  turnId: string,
  occurredAt: string,
  kind: 'agent',
  state: AgentStreamActivityState,
  title: string,
  summary: string
): Omit<
  Extract<AgentStreamEventV1, { type: 'section.upsert' }>,
  'schema' | 'streamId' | 'turnId' | 'seq' | 'occurredAt'
> {
  const sectionId = `${turnId}:agent`;
  return {
    type: 'section.upsert',
    sectionId,
    section: {
      type: 'activity',
      sectionId,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      kind,
      state,
      title,
      summary,
    },
  };
}

function activityState(status: AgentTaskStatus): AgentStreamActivityState {
  if (status === 'created') return 'queued';
  if (status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'cancelled') return 'cancelled';
  return 'outcome_unknown';
}

function streamState(status: AgentTaskStatus): AgentStreamState {
  if (status === 'running' || status === 'created') return 'streaming';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'paused' || status === 'blocked') return 'paused';
  return 'recovering';
}

function stateSummary(status: AgentTaskStatus): string {
  const labels: Record<AgentTaskStatus, string> = {
    created: '任务已创建',
    running: '任务正在执行',
    paused: '任务已暂停，可从安全边界恢复',
    completed: '任务已完成',
    failed: '任务执行失败',
    interrupted: '任务中断，结果状态待确认',
    blocked: '任务等待外部条件',
    cancelled: '任务已取消',
  };
  return labels[status];
}

function safeText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value : fallback;
  return text
    .replace(/(?:authorization|bearer|token|secret|password|lease)[=: ]+[^\s,;]+/giu, '[已脱敏]')
    .slice(0, 4096);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
