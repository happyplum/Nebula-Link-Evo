import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import {
  AGENT_STREAM_EVENT_SCHEMA,
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  type AgentStreamEventV1,
  type AgentStreamSectionV1,
  type AgentStreamSnapshotV1,
  type AgentStreamTurnV1,
} from '@nebula-link-evo/shared/types/agent-stream';

export type ActivityContext = { type: 'authoring' | 'run'; id: string };

interface ActivityRow {
  seq: number;
  event_json: string;
}

interface ControlEventRow {
  seq: number;
  type: string;
  entity_type: string;
  entity_id: string;
  payload_json: string;
  occurred_at: string;
}

interface AuthoringMessageRow {
  seq: number;
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

const CONTROL_SOURCE_PREFIX = 'semantic-control';
const MESSAGE_SOURCE_ID = 'semantic-authoring-messages';

export class AgentActivityRepository {
  private readonly emitter = new EventEmitter();

  constructor(private readonly db: Database.Database) {}

  hasContext(context: ActivityContext): boolean {
    const table = context.type === 'authoring' ? 'authoring_jobs' : 'test_runs';
    return Boolean(this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(context.id));
  }

  append(
    context: ActivityContext,
    sourceTaskId: string,
    sourceEvent: AgentStreamEventV1,
    links: {
      pageTaskId?: string;
      authoringTaskId?: string;
      todoId?: string;
      pageDefinitionId?: string;
      functionalModuleId?: string;
    } = {}
  ): AgentStreamEventV1 | null {
    const existing = this.db
      .prepare(
        `SELECT seq, event_json FROM semantic_agent_activity_events
         WHERE context_type = ? AND context_id = ? AND source_task_id = ? AND source_seq = ?`
      )
      .get(context.type, context.id, sourceTaskId, sourceEvent.seq) as ActivityRow | undefined;
    if (existing) return null;

    const transaction = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM semantic_agent_activity_events
           WHERE context_type = ? AND context_id = ?`
        )
        .get(context.type, context.id) as { seq: number };
      const event: AgentStreamEventV1 = {
        ...sourceEvent,
        schema: AGENT_STREAM_EVENT_SCHEMA,
        streamId: context.id,
        seq: row.seq,
      };
      this.db
        .prepare(
          `INSERT INTO semantic_agent_activity_events(
             context_type, context_id, seq, source_task_id, source_seq, event_json,
             page_task_id, authoring_task_id, todo_id, page_definition_id,
             functional_module_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          context.type,
          context.id,
          event.seq,
          sourceTaskId,
          sourceEvent.seq,
          JSON.stringify(event),
          links.pageTaskId ?? null,
          links.authoringTaskId ?? null,
          links.todoId ?? null,
          links.pageDefinitionId ?? null,
          links.functionalModuleId ?? null,
          sourceEvent.occurredAt
        );
      this.db
        .prepare(
          `INSERT INTO semantic_agent_activity_cursors(
             context_type, context_id, source_task_id, last_activity_seq, updated_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(context_type, context_id, source_task_id) DO UPDATE SET
             last_activity_seq = MAX(last_activity_seq, excluded.last_activity_seq),
             updated_at = excluded.updated_at`
        )
        .run(context.type, context.id, sourceTaskId, sourceEvent.seq, sourceEvent.occurredAt);
      return event;
    });
    const event = transaction();
    this.emitter.emit(key(context), event);
    return event;
  }

  cursor(context: ActivityContext, sourceTaskId: string): number {
    const row = this.db
      .prepare(
        `SELECT last_activity_seq FROM semantic_agent_activity_cursors
         WHERE context_type = ? AND context_id = ? AND source_task_id = ?`
      )
      .get(context.type, context.id, sourceTaskId) as { last_activity_seq: number } | undefined;
    return row?.last_activity_seq ?? 0;
  }

  syncControlEvents(context: ActivityContext): number {
    const controlSourceId = `${CONTROL_SOURCE_PREFIX}:${context.type}`;
    const afterControlSeq = this.cursor(context, controlSourceId);
    const table = context.type === 'authoring' ? 'authoring_events' : 'run_events';
    const contextColumn = context.type === 'authoring' ? 'job_id' : 'run_id';
    const controlRows = this.db
      .prepare(
        `SELECT seq, type, entity_type, entity_id, payload_json, occurred_at
         FROM ${table} WHERE ${contextColumn} = ? AND seq > ? ORDER BY seq`
      )
      .all(context.id, afterControlSeq) as ControlEventRow[];
    const messageRows =
      context.type === 'authoring'
        ? (this.db
            .prepare(
              `SELECT messages.rowid AS seq, messages.id, messages.role, messages.content,
                      messages.created_at
               FROM authoring_chat_messages AS messages
               JOIN authoring_context_threads AS threads ON threads.id = messages.thread_id
               WHERE threads.job_id = ? AND messages.rowid > ?
               ORDER BY messages.rowid`
            )
            .all(context.id, this.cursor(context, MESSAGE_SOURCE_ID)) as AuthoringMessageRow[])
        : [];
    const pending = [
      ...controlRows.map((row) => ({
        kind: 'control' as const,
        sourceId: controlSourceId,
        sourceSeq: row.seq,
        occurredAt: row.occurred_at,
        row,
      })),
      ...messageRows.map((row) => ({
        kind: 'message' as const,
        sourceId: MESSAGE_SOURCE_ID,
        sourceSeq: row.seq,
        occurredAt: row.created_at,
        row,
      })),
    ].sort((left, right) =>
      left.occurredAt === right.occurredAt
        ? left.sourceId.localeCompare(right.sourceId) || left.sourceSeq - right.sourceSeq
        : left.occurredAt.localeCompare(right.occurredAt)
    );
    for (const item of pending) {
      if (item.kind === 'message') {
        this.append(context, item.sourceId, projectAuthoringMessage(context, item.row));
        continue;
      }
      const projected = projectControlEvent(context, item.row);
      if (projected) this.append(context, item.sourceId, projected);
      else this.advanceCursor(context, item.sourceId, item.sourceSeq, item.occurredAt);
    }
    return pending.length;
  }

  list(context: ActivityContext, afterSeq = 0, limit = 500): AgentStreamEventV1[] {
    this.syncControlEvents(context);
    return (
      this.db
        .prepare(
          `SELECT seq, event_json FROM semantic_agent_activity_events
           WHERE context_type = ? AND context_id = ? AND seq > ? ORDER BY seq LIMIT ?`
        )
        .all(
          context.type,
          context.id,
          afterSeq,
          Math.min(Math.max(limit, 1), 1000)
        ) as ActivityRow[]
    ).map((row) => ({ ...(JSON.parse(row.event_json) as AgentStreamEventV1), seq: row.seq }));
  }

  snapshot(context: ActivityContext): AgentStreamSnapshotV1 {
    const events: AgentStreamEventV1[] = [];
    let afterSeq = 0;
    while (true) {
      const batch = this.list(context, afterSeq, 1000);
      events.push(...batch);
      if (batch.length < 1000) break;
      afterSeq = batch[batch.length - 1].seq;
    }
    const turns = new Map<string, AgentStreamTurnV1>();
    for (const event of events) applyEvent(turns, event);
    const sections = [...turns.values()].flatMap((turn) => turn.sections);
    const activities = sections.filter(
      (section): section is Extract<AgentStreamSectionV1, { type: 'activity' }> =>
        section.type === 'activity'
    );
    const state = activities.some(
      (activity) => activity.state === 'running' || activity.state === 'queued'
    )
      ? 'streaming'
      : activities.some((activity) => activity.state === 'blocked')
        ? 'paused'
        : activities.some((activity) => activity.state === 'outcome_unknown')
          ? 'recovering'
          : activities.some((activity) => activity.state === 'failed')
            ? 'failed'
            : events.length
              ? 'completed'
              : 'idle';
    return {
      schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
      streamId: context.id,
      seq: events.at(-1)?.seq ?? 0,
      state,
      generatedAt: events.at(-1)?.occurredAt ?? new Date().toISOString(),
      turns: [...turns.values()],
    };
  }

  subscribe(context: ActivityContext, listener: (event: AgentStreamEventV1) => void): () => void {
    const eventName = key(context);
    this.emitter.on(eventName, listener);
    return () => this.emitter.off(eventName, listener);
  }

  private advanceCursor(
    context: ActivityContext,
    sourceTaskId: string,
    sourceSeq: number,
    occurredAt: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO semantic_agent_activity_cursors(
           context_type, context_id, source_task_id, last_activity_seq, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(context_type, context_id, source_task_id) DO UPDATE SET
           last_activity_seq = MAX(last_activity_seq, excluded.last_activity_seq),
           updated_at = excluded.updated_at`
      )
      .run(context.type, context.id, sourceTaskId, sourceSeq, occurredAt);
  }
}

function projectAuthoringMessage(
  context: Extract<ActivityContext, { type: 'authoring' }> | ActivityContext,
  row: AuthoringMessageRow
): AgentStreamEventV1 {
  const turnId = `authoring:${context.id}:message:${row.id}`;
  const sectionId = `${turnId}:content`;
  return {
    schema: AGENT_STREAM_EVENT_SCHEMA,
    streamId: context.id,
    turnId,
    sectionId,
    seq: row.seq,
    occurredAt: row.created_at,
    type: 'turn.upsert',
    turn: {
      turnId,
      role: row.role,
      state: 'completed',
      createdAt: row.created_at,
      updatedAt: row.created_at,
      sections: [
        {
          type: row.role === 'user' ? 'user' : 'content',
          sectionId,
          createdAt: row.created_at,
          updatedAt: row.created_at,
          markdown: row.content,
        },
      ],
    },
  };
}

function projectControlEvent(
  context: ActivityContext,
  row: ControlEventRow
): AgentStreamEventV1 | null {
  const payload = parsePayload(row.payload_json);
  const turnId = `${context.type}:${context.id}:control`;
  const base = {
    schema: AGENT_STREAM_EVENT_SCHEMA,
    streamId: context.id,
    turnId,
    seq: row.seq,
    occurredAt: row.occurred_at,
  } as const;
  const sectionBase = {
    createdAt: row.occurred_at,
    updatedAt: row.occurred_at,
  };

  if (row.type === 'decision.requested') {
    const sectionId = `decision:${row.entity_id}`;
    return {
      ...base,
      type: 'section.upsert',
      sectionId,
      section: {
        ...sectionBase,
        type: 'decision',
        sectionId,
        decisionId: row.entity_id,
        title: context.type === 'authoring' ? '候选影响范围等待审批' : '运行结果等待决策',
        summary: '结构化决策已持久化，文本本身不会改变业务状态。',
        state: 'waiting',
      },
    };
  }
  if (row.type === 'decision.applied') {
    const sectionId = `decision:${stringValue(payload.decisionId) ?? row.entity_id}`;
    return {
      ...base,
      type: 'section.upsert',
      sectionId,
      section: {
        ...sectionBase,
        type: 'decision',
        sectionId,
        decisionId: stringValue(payload.decisionId) ?? row.entity_id,
        title: '结构化决策已应用',
        state: decisionRejected(payload) ? 'rejected' : 'approved',
      },
    };
  }

  if (context.type === 'authoring') {
    const sectionId = `authoring:${row.entity_type}:${row.entity_id}`;
    if (row.type === 'asset.candidate_created') {
      return activityEvent(
        base,
        sectionId,
        'edit',
        'completed',
        '候选修改已生成',
        '等待影响检查或验证'
      );
    }
    if (row.type === 'asset.candidate_queued_at_safe_boundary') {
      return activityEvent(base, sectionId, 'command', 'queued', '候选修改等待安全边界');
    }
    if (
      row.type === 'asset.candidate_verification_started' ||
      row.type === 'authoring.verification_scheduled'
    ) {
      return activityEvent(base, sectionId, 'browser', 'running', '正在用真实浏览器验证候选');
    }
    if (row.type === 'asset.candidate_activated') {
      return noticeEvent(base, sectionId, 'success', '候选已验证并原子激活');
    }
    if (row.type === 'asset.candidate_rejected') {
      return activityEvent(base, sectionId, 'edit', 'cancelled', '候选修改未应用');
    }
    if (row.type === 'asset.candidate_failed') {
      return activityEvent(base, sectionId, 'edit', 'failed', '候选验证失败，当前版本保持不变');
    }
    if (row.type === 'authoring_task.created') {
      return activityEvent(
        base,
        sectionId,
        'agent',
        stateFromValue(payload.state),
        '编排任务已创建'
      );
    }
    if (row.type === 'authoring_task.state_changed') {
      return activityEvent(
        base,
        sectionId,
        'agent',
        stateFromValue(payload.to),
        '编排任务状态已更新'
      );
    }
    if (row.type === 'authoring_attempt.completed') {
      return activityEvent(
        base,
        sectionId,
        'agent',
        stateFromValue(payload.taskState ?? payload.status),
        '编排尝试已结算'
      );
    }
    if (row.type === 'authoring.created') {
      return activityEvent(base, sectionId, 'agent', 'queued', '编排作业已创建');
    }
    if (row.type === 'authoring.state_changed' || row.type === 'authoring.settled') {
      return activityEvent(
        base,
        sectionId,
        'agent',
        stateFromValue(payload.to ?? payload.lifecycle),
        '编排作业状态已更新'
      );
    }
    if (row.type === 'authoring.cancelled') {
      return activityEvent(base, sectionId, 'agent', 'cancelled', '编排作业已取消');
    }
    return null;
  }

  const sectionId = `run:${row.entity_type}:${row.entity_id}`;
  if (row.type === 'run.created') {
    return activityEvent(base, sectionId, 'agent', 'queued', '运行已创建');
  }
  if (row.type === 'run.lifecycle_changed') {
    return activityEvent(base, sectionId, 'agent', stateFromValue(payload.to), '运行状态已更新');
  }
  if (row.type === 'run.completed') {
    return activityEvent(base, sectionId, 'agent', stateFromValue(payload.lifecycle), '运行已结算');
  }
  if (row.type === 'page_task.started') {
    return activityEvent(base, sectionId, 'agent', 'running', '页面 Agent 已开始执行');
  }
  if (row.type === 'todo.state_changed') {
    return activityEvent(
      base,
      sectionId,
      'agent',
      stateFromValue(payload.to),
      '运行 TODO 状态已更新',
      stringValue(payload.to)
    );
  }
  if (row.type === 'attempt.completed') {
    return activityEvent(
      base,
      sectionId,
      'evidence',
      stateFromValue(payload.todoState ?? payload.result),
      '执行尝试已结算'
    );
  }
  if (row.type === 'side_effect_policy.evaluated') {
    return noticeEvent(
      base,
      sectionId,
      payload.result === 'denied' ? 'warning' : 'info',
      payload.result === 'denied' ? '副作用策略拒绝执行' : '副作用策略检查完成'
    );
  }
  return null;
}

function activityEvent(
  base: Pick<AgentStreamEventV1, 'schema' | 'streamId' | 'turnId' | 'seq' | 'occurredAt'>,
  sectionId: string,
  kind: Extract<AgentStreamSectionV1, { type: 'activity' }>['kind'],
  state: Extract<AgentStreamSectionV1, { type: 'activity' }>['state'],
  title: string,
  summary?: string
): AgentStreamEventV1 {
  return {
    ...base,
    type: 'section.upsert',
    sectionId,
    section: {
      type: 'activity',
      sectionId,
      createdAt: base.occurredAt,
      updatedAt: base.occurredAt,
      kind,
      state,
      title,
      ...(summary ? { summary } : {}),
    },
  };
}

function noticeEvent(
  base: Pick<AgentStreamEventV1, 'schema' | 'streamId' | 'turnId' | 'seq' | 'occurredAt'>,
  sectionId: string,
  tone: 'info' | 'success' | 'warning',
  title: string
): AgentStreamEventV1 {
  return {
    ...base,
    type: 'section.upsert',
    sectionId,
    section: {
      type: 'notice',
      sectionId,
      createdAt: base.occurredAt,
      updatedAt: base.occurredAt,
      tone,
      title,
    },
  };
}

function stateFromValue(
  value: unknown
): Extract<AgentStreamSectionV1, { type: 'activity' }>['state'] {
  if (
    value === 'created' ||
    value === 'ready' ||
    value === 'pending' ||
    value === 'waiting_dependencies'
  )
    return 'queued';
  if (value === 'running' || value === 'verifying') return 'running';
  if (value === 'completed' || value === 'passed' || value === 'succeeded' || value === 'activated')
    return 'completed';
  if (value === 'failed' || value === 'invalid') return 'failed';
  if (value === 'paused' || value === 'blocked' || value === 'waiting_decision') return 'blocked';
  if (value === 'cancelled' || value === 'cancelling' || value === 'rejected') return 'cancelled';
  if (value === 'skipped') return 'skipped';
  if (value === 'interrupted' || value === 'outcome_unknown') return 'outcome_unknown';
  return 'completed';
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function decisionRejected(payload: Record<string, unknown>): boolean {
  return (
    payload.answer === 'reject' || payload.answerKey === 'reject' || payload.answerKey === 'fail'
  );
}

function applyEvent(turns: Map<string, AgentStreamTurnV1>, event: AgentStreamEventV1): void {
  if (event.type === 'stream.state') return;
  if (event.type === 'turn.upsert') {
    turns.set(event.turnId, event.turn);
    return;
  }
  const current = turns.get(event.turnId) ?? {
    turnId: event.turnId,
    role: 'assistant',
    state: 'streaming',
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt,
    sections: [],
  };
  if (event.type === 'section.upsert') {
    const sections = [...current.sections];
    const index = sections.findIndex((section) => section.sectionId === event.sectionId);
    if (index < 0) sections.push(event.section);
    else sections[index] = event.section;
    turns.set(event.turnId, { ...current, updatedAt: event.occurredAt, sections });
  } else if (event.type === 'section.remove') {
    turns.set(event.turnId, {
      ...current,
      updatedAt: event.occurredAt,
      sections: current.sections.filter((section) => section.sectionId !== event.sectionId),
    });
  } else if (event.type === 'turn.completed') {
    turns.set(event.turnId, { ...current, state: event.state, updatedAt: event.occurredAt });
  } else if (event.type === 'content.delta') {
    const sections = [...current.sections];
    const index = sections.findIndex((section) => section.sectionId === event.sectionId);
    const existing = index >= 0 ? sections[index] : undefined;
    const content: AgentStreamSectionV1 = {
      type: 'content',
      sectionId: event.sectionId,
      createdAt: existing?.createdAt ?? event.occurredAt,
      updatedAt: event.occurredAt,
      markdown: `${existing?.type === 'content' ? existing.markdown : ''}${event.delta}`,
      streaming: true,
    };
    if (index < 0) sections.push(content);
    else sections[index] = content;
    turns.set(event.turnId, { ...current, updatedAt: event.occurredAt, sections });
  }
}

function key(context: ActivityContext): string {
  return `${context.type}:${context.id}`;
}
