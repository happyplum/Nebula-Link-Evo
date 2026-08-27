import type { DatabaseSync } from 'node:sqlite';
import type { SessionEvent as DshSessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import {
  AGENT_STREAM_EVENT_SCHEMA,
  type AgentStreamEventV1,
  type AgentStreamSectionV1,
  type AgentStreamTurnV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import type { SessionEventsDAO } from '../db/SessionEventsDAO.js';

interface ProjectionStateRow {
  projected_dsh_seq: number;
  durable_dsh_seq: number;
  deleted_at: string | null;
}

type ProjectedAgentEvent = AgentStreamEventV1 extends infer Event
  ? Event extends AgentStreamEventV1
    ? Omit<Event, 'schema' | 'streamId' | 'seq'>
    : never
  : never;

export interface ProjectionCatchUpResult {
  projectedDshSeq: number;
  durableDshSeq: number;
  publicEvents: AgentStreamEventV1[];
}

export class HarnessProjectionCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessProjectionCorruptionError';
  }
}

/** Transactional user-facing projection over a committed DSH event prefix. */
export class HarnessProjectionStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly publicEvents: SessionEventsDAO
  ) {}

  catchUp(
    sessionId: string,
    durableDshSeq: number,
    events: readonly DshSessionEvent[],
    durableRevision?: string,
    options: { allowDeleted?: boolean } = {}
  ): ProjectionCatchUpResult {
    assertSeq(durableDshSeq, 'durableDshSeq');
    this.db.exec('BEGIN IMMEDIATE');
    const committedEvents: AgentStreamEventV1[] = [];
    try {
      this.ensureProjection(sessionId);
      const state = this.getState(sessionId);
      if (state.deleted_at && !options.allowDeleted) {
        throw new HarnessProjectionCorruptionError(
          `Session ${sessionId} is deleted and cannot be projected`
        );
      }
      if (state.projected_dsh_seq > durableDshSeq) {
        throw new HarnessProjectionCorruptionError(
          `Projection cursor ${state.projected_dsh_seq} exceeds durable DSH seq ${durableDshSeq} for ${sessionId}`
        );
      }

      let nextDshSeq = state.projected_dsh_seq;
      for (const event of events) {
        if (event.seq < nextDshSeq) continue;
        if (event.seq !== nextDshSeq || event.seq >= durableDshSeq) {
          throw new HarnessProjectionCorruptionError(
            `Non-contiguous DSH projection for ${sessionId}: expected ${nextDshSeq}, got ${event.seq}`
          );
        }
        const projected = this.projectEvent(sessionId, event);
        let lastPublicSeq: number | null = null;
        for (const candidate of projected) {
          const publicEvent = this.insertPublicEvent(sessionId, candidate);
          committedEvents.push(publicEvent);
          lastPublicSeq = publicEvent.seq;
        }
        this.db
          .prepare(
            `INSERT INTO harness_projected_events(session_id, dsh_seq, dsh_event_type, public_seq)
             VALUES (?, ?, ?, ?)`
          )
          .run(sessionId, event.seq, event.type, lastPublicSeq);
        nextDshSeq += 1;
      }
      if (nextDshSeq !== durableDshSeq) {
        throw new HarnessProjectionCorruptionError(
          `Durable DSH suffix for ${sessionId} ended at ${nextDshSeq}, expected ${durableDshSeq}`
        );
      }
      this.db
        .prepare(
          `UPDATE harness_session_projection
           SET projected_dsh_seq = ?, durable_dsh_seq = ?, durable_revision = ?
           WHERE session_id = ?`
        )
        .run(nextDshSeq, durableDshSeq, durableRevision ?? null, sessionId);
      this.db.exec('COMMIT');
      for (const event of committedEvents) {
        this.publicEvents.observeCommittedSeq(sessionId, event.seq);
      }
      return { projectedDshSeq: nextDshSeq, durableDshSeq, publicEvents: committedEvents };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  state(sessionId: string): { projectedDshSeq: number; durableDshSeq: number; deleted: boolean } {
    this.ensureProjection(sessionId);
    const row = this.getState(sessionId);
    return {
      projectedDshSeq: row.projected_dsh_seq,
      durableDshSeq: row.durable_dsh_seq,
      deleted: row.deleted_at !== null,
    };
  }

  tombstone(sessionId: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.ensureProjection(sessionId);
      this.db
        .prepare('UPDATE harness_session_projection SET deleted_at = ? WHERE session_id = ?')
        .run(new Date().toISOString(), sessionId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private ensureProjection(sessionId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO harness_session_projection(
           session_id, projected_dsh_seq, durable_dsh_seq
         ) VALUES (?, 0, 0)`
      )
      .run(sessionId);
  }

  private getState(sessionId: string): ProjectionStateRow {
    const row = this.db
      .prepare(
        `SELECT projected_dsh_seq, durable_dsh_seq, deleted_at
         FROM harness_session_projection WHERE session_id = ?`
      )
      .get(sessionId) as ProjectionStateRow | undefined;
    if (!row) {
      throw new HarnessProjectionCorruptionError(`Projection state is missing for ${sessionId}`);
    }
    return row;
  }

  private projectEvent(sessionId: string, event: DshSessionEvent): ProjectedAgentEvent[] {
    const occurredAt = new Date(event.time).toISOString();
    if (event.type === 'user/message') {
      const content = contentText(event.data.content);
      const messageId = String(event.data.id);
      this.insertMessage(sessionId, messageId, 'user', content, event.time);
      const turnId = `user:${messageId}`;
      return [
        turnUpsert(
          turnId,
          'user',
          textSection('user', `user:${messageId}`, content, occurredAt, false),
          occurredAt
        ),
      ];
    }
    if (event.type === 'turn/start') {
      this.updateStatus(sessionId, 'running');
      const turnId = runId(sessionId, event.data.turn);
      return [
        turnUpsert(
          turnId,
          'assistant',
          reasoningSection(turnId, occurredAt, 'running'),
          occurredAt
        ),
        streamState(turnId, 'streaming', occurredAt),
      ];
    }
    if (event.type === 'assistant/chunk') {
      const turnId = runId(sessionId, event.data.turn);
      const chunk = event.data.chunk;
      if (chunk.type === 'text-delta') {
        return [
          {
            type: 'content.delta',
            turnId,
            sectionId: `${turnId}:content`,
            occurredAt,
            delta: chunk.text,
          },
        ];
      }
      if (chunk.type === 'reasoning-delta') {
        return [sectionUpsert(turnId, reasoningSection(turnId, occurredAt, 'running'), occurredAt)];
      }
      return [];
    }
    if (event.type === 'assistant/message') {
      const turnId = runId(sessionId, event.data.turn);
      const id = assistantMessageId(sessionId, event.data.turn);
      const content = visibleText(event.data.message.content);
      this.appendAssistantMessage(sessionId, id, content, event.time);
      return [
        sectionUpsert(
          turnId,
          textSection('content', `${turnId}:content`, content, occurredAt, false),
          occurredAt
        ),
      ];
    }
    if (event.type === 'tool/call') {
      const turnId = runId(sessionId, event.data.turn);
      const callId = String(event.data.callId);
      return [
        sectionUpsert(
          turnId,
          activitySection(callId, occurredAt, 'running', safeName(event.data.name)),
          occurredAt
        ),
      ];
    }
    if (event.type === 'tool/result') {
      const turnId = runId(sessionId, event.data.turn);
      const callId = String(event.data.message.source.callId);
      const result = event.data.message.content[0];
      const errorCode = event.data.error?.code;
      const state =
        errorCode === 'OUTCOME_UNKNOWN'
          ? 'outcome_unknown'
          : errorCode === 'TOOL_NOT_STARTED'
            ? 'skipped'
            : result.isError === true
              ? 'failed'
              : 'completed';
      return [
        sectionUpsert(
          turnId,
          activitySection(
            callId,
            occurredAt,
            state,
            '工具执行',
            state === 'outcome_unknown'
              ? '工具结果未知，不会自动重试。'
              : state === 'skipped'
                ? '工具未开始执行。'
                : state === 'failed'
                  ? `工具执行失败：${safeName(errorCode ?? 'execution_failed')}`
                  : '工具已完成，详细结果通过受控证据查看。'
          ),
          occurredAt
        ),
      ];
    }
    if (event.type === 'turn/end') {
      return this.projectTurnEnd(sessionId, event.data.turn, event.data.reason, occurredAt);
    }
    return [];
  }

  private projectTurnEnd(
    sessionId: string,
    turn: number,
    reason: TurnEndReason,
    occurredAt: string
  ): ProjectedAgentEvent[] {
    const turnId = runId(sessionId, turn);
    const reasoning = sectionUpsert(
      turnId,
      reasoningSection(turnId, occurredAt, reason.kind === 'error' ? 'failed' : 'completed'),
      occurredAt
    );
    if (reason.kind === 'error') {
      this.updateStatus(sessionId, 'blocked');
      return [
        reasoning,
        sectionUpsert(
          turnId,
          {
            type: 'error',
            sectionId: `${turnId}:error`,
            createdAt: occurredAt,
            updatedAt: occurredAt,
            title: '本轮执行失败',
            message: safeError(reason.error.message),
            code: reason.error.code,
            recoverable: reason.error.code === 'TIMEOUT',
          },
          occurredAt
        ),
        turnCompleted(turnId, 'failed', occurredAt),
        streamState(turnId, 'failed', occurredAt),
      ];
    }
    const cancelled = reason.kind === 'aborted' || reason.kind === 'interrupted';
    const paused = reason.kind === 'blocked';
    this.updateStatus(sessionId, paused ? 'paused' : cancelled ? 'interrupted' : 'completed');
    return [
      reasoning,
      turnCompleted(turnId, cancelled ? 'cancelled' : 'completed', occurredAt),
      streamState(turnId, paused ? 'paused' : cancelled ? 'cancelled' : 'completed', occurredAt),
    ];
  }

  private insertPublicEvent(sessionId: string, event: ProjectedAgentEvent): AgentStreamEventV1 {
    const seq = this.nextPublicSeq(sessionId);
    const publicEvent = {
      schema: AGENT_STREAM_EVENT_SCHEMA,
      streamId: sessionId,
      seq,
      ...event,
    } as AgentStreamEventV1;
    this.db
      .prepare(
        `INSERT INTO session_events(session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, 'agent_stream.event', ?, ?, NULL)`
      )
      .run(sessionId, seq, JSON.stringify(publicEvent), event.occurredAt);
    return publicEvent;
  }

  private nextPublicSeq(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM session_events WHERE session_id = ?')
      .get(sessionId) as { seq: number };
    return row.seq + 1;
  }

  private insertMessage(
    sessionId: string,
    id: string,
    role: 'user' | 'assistant',
    content: string,
    time: number
  ): void {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO messages(id, session_id, role, content, created_at, metadata, idempotency_key)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(id, sessionId, role, content, new Date(time).toISOString());
    if (Number(result.changes) > 0) this.bumpMessageCount(sessionId);
  }

  private appendAssistantMessage(
    sessionId: string,
    id: string,
    content: string,
    time: number
  ): void {
    const existing = this.db.prepare('SELECT id FROM messages WHERE id = ?').get(id);
    if (existing) {
      this.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id);
      return;
    }
    this.insertMessage(sessionId, id, 'assistant', content, time);
  }

  private bumpMessageCount(sessionId: string): void {
    this.db
      .prepare('UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), sessionId);
  }

  private updateStatus(sessionId: string, status: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE sessions_state
         SET status = ?, last_active_at = ?, updated_at = ?, version = version + 1
         WHERE session_id = ?`
      )
      .run(status, now, now, sessionId);
  }
}

function textSection(
  type: 'user' | 'content',
  sectionId: string,
  markdown: string,
  occurredAt: string,
  streaming: boolean
): AgentStreamSectionV1 {
  return { type, sectionId, createdAt: occurredAt, updatedAt: occurredAt, markdown, streaming };
}

function reasoningSection(
  turnId: string,
  occurredAt: string,
  state: 'running' | 'completed' | 'failed'
): Extract<AgentStreamSectionV1, { type: 'reasoning' }> {
  return {
    type: 'reasoning',
    sectionId: `${turnId}:reasoning`,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    visibility: 'summary',
    summary: state === 'running' ? '正在分析上下文与可用能力' : '已完成分析与决策',
    state,
  };
}

function activitySection(
  callId: string,
  occurredAt: string,
  state: Extract<AgentStreamSectionV1, { type: 'activity' }>['state'],
  title: string,
  summary?: string
): Extract<AgentStreamSectionV1, { type: 'activity' }> {
  return {
    type: 'activity',
    sectionId: `tool:${callId}`,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    kind: title.includes('browser') ? 'browser' : 'tool',
    state,
    title,
    ...(summary ? { summary } : {}),
  };
}

function turnUpsert(
  turnId: string,
  role: AgentStreamTurnV1['role'],
  section: AgentStreamSectionV1,
  occurredAt: string
): ProjectedAgentEvent {
  return {
    type: 'turn.upsert',
    turnId,
    sectionId: section.sectionId,
    occurredAt,
    turn: {
      turnId,
      role,
      state: role === 'assistant' ? 'streaming' : 'completed',
      createdAt: occurredAt,
      updatedAt: occurredAt,
      sections: [section],
    },
  };
}

function sectionUpsert(
  turnId: string,
  section: AgentStreamSectionV1,
  occurredAt: string
): ProjectedAgentEvent {
  return { type: 'section.upsert', turnId, sectionId: section.sectionId, occurredAt, section };
}

function streamState(
  turnId: string,
  state: Extract<AgentStreamEventV1, { type: 'stream.state' }>['state'],
  occurredAt: string
): ProjectedAgentEvent {
  return { type: 'stream.state', turnId, sectionId: `${turnId}:state`, occurredAt, state };
}

function turnCompleted(
  turnId: string,
  state: Extract<AgentStreamEventV1, { type: 'turn.completed' }>['state'],
  occurredAt: string
): ProjectedAgentEvent {
  return { type: 'turn.completed', turnId, sectionId: `${turnId}:summary`, occurredAt, state };
}

function contentText(content: readonly ContentBlock[]): string {
  return content
    .flatMap((block) => {
      if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') {
        return [block.text];
      }
      if (block.type === 'tool-result' && Array.isArray(block.content)) {
        return [contentText(block.content)];
      }
      if (block.type === 'image') return ['[image]'];
      return [];
    })
    .join('');
}

function visibleText(content: readonly ContentBlock[]): string {
  return content
    .flatMap((block) => {
      if (block.type === 'text') return [block.text];
      if (block.type === 'image') return ['[image]'];
      return [];
    })
    .join('');
}

function runId(sessionId: string, turn: number): string {
  return `${sessionId}:turn:${turn}`;
}

function assistantMessageId(sessionId: string, turn: number): string {
  return `${sessionId}:assistant:${turn}`;
}

function safeName(value: unknown): string {
  const normalized = String(value ?? '工具执行')
    .replace(/[\r\n\t]/gu, ' ')
    .trim();
  return normalized.slice(0, 120) || '工具执行';
}

function safeError(value: unknown): string {
  const normalized = String(value ?? '执行失败').replace(
    /(?:authorization|bearer|token|secret|password|lease)[=: ]+[^\s,;]+/giu,
    '[已脱敏]'
  );
  return normalized.slice(0, 4096);
}

function assertSeq(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}
