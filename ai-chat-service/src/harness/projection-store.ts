import type { DatabaseSync } from 'node:sqlite';
import type { SessionEvent as DshSessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type {
  SessionEvent as PublicSessionEvent,
  SessionEventType as PublicSessionEventType,
} from '@nebula-link-evo/shared/types/sse-events';
import type { SessionEventsDAO } from '../db/SessionEventsDAO.js';

interface ProjectionStateRow {
  projected_dsh_seq: number;
  durable_dsh_seq: number;
  deleted_at: string | null;
}

interface ProjectedPublicEvent {
  type: PublicSessionEventType;
  payload: Record<string, unknown>;
}

export interface ProjectionCatchUpResult {
  projectedDshSeq: number;
  durableDshSeq: number;
  publicEvents: PublicSessionEvent[];
}

export class HarnessProjectionCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessProjectionCorruptionError';
  }
}

/** Transactional SQLite read model over the durable DSH event prefix. */
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
    const committedEvents: PublicSessionEvent[] = [];
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
        const publicEvent = projected ? this.insertPublicEvent(sessionId, projected) : undefined;
        this.db
          .prepare(
            `INSERT INTO harness_projected_events(session_id, dsh_seq, dsh_event_type, public_seq)
             VALUES (?, ?, ?, ?)`
          )
          .run(sessionId, event.seq, event.type, publicEvent?.seq ?? null);
        if (publicEvent) committedEvents.push(publicEvent);
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
      for (const event of committedEvents)
        this.publicEvents.observeCommittedSeq(sessionId, event.seq ?? 0);
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
    if (!row)
      throw new HarnessProjectionCorruptionError(`Projection state is missing for ${sessionId}`);
    return row;
  }

  private projectEvent(
    sessionId: string,
    event: DshSessionEvent
  ): ProjectedPublicEvent | undefined {
    if (event.type === 'user/message') {
      const content = contentText(event.data.content);
      this.insertMessage(sessionId, String(event.data.id), 'user', content, event.time);
      return {
        type: 'message.created',
        payload: { sessionId, messageId: String(event.data.id), content },
      };
    }
    if (event.type === 'turn/start') {
      this.updateStatus(sessionId, 'running');
      return {
        type: 'assistant.started',
        payload: {
          sessionId,
          runId: runId(sessionId, event.data.turn),
          messageId: assistantMessageId(sessionId, event.data.turn),
        },
      };
    }
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk;
      if (chunk.type === 'text-delta') {
        return {
          type: 'assistant.delta',
          payload: {
            sessionId,
            runId: runId(sessionId, event.data.turn),
            messageId: assistantMessageId(sessionId, event.data.turn),
            text: chunk.text,
          },
        };
      }
      if (chunk.type === 'reasoning-delta') {
        return {
          type: 'assistant.thinking',
          payload: {
            sessionId,
            runId: runId(sessionId, event.data.turn),
            messageId: assistantMessageId(sessionId, event.data.turn),
            text: chunk.text,
          },
        };
      }
      return undefined;
    }
    if (event.type === 'assistant/message') {
      const id = assistantMessageId(sessionId, event.data.turn);
      this.appendAssistantMessage(
        sessionId,
        id,
        visibleText(event.data.message.content),
        event.time
      );
      return undefined;
    }
    if (event.type === 'tool/call') {
      return {
        type: 'assistant.tool_call',
        payload: {
          sessionId,
          runId: runId(sessionId, event.data.turn),
          messageId: assistantMessageId(sessionId, event.data.turn),
          toolCallId: String(event.data.callId),
          toolCall: {
            id: String(event.data.callId),
            function: { name: event.data.name },
            arguments: event.data.arguments,
          },
        },
      };
    }
    if (event.type === 'tool/result') {
      return {
        type: 'assistant.tool_result',
        payload: {
          sessionId,
          runId: runId(sessionId, event.data.turn),
          messageId: assistantMessageId(sessionId, event.data.turn),
          toolCallId: String(event.data.message.source.callId),
          result: contentText(event.data.message.content),
        },
      };
    }
    if (event.type === 'turn/end')
      return this.projectTurnEnd(sessionId, event.data.turn, event.data.reason);
    return undefined;
  }

  private projectTurnEnd(
    sessionId: string,
    turn: number,
    reason: TurnEndReason
  ): ProjectedPublicEvent {
    const common = {
      sessionId,
      runId: runId(sessionId, turn),
      messageId: assistantMessageId(sessionId, turn),
    };
    if (reason.kind === 'error') {
      this.updateStatus(sessionId, 'blocked');
      return {
        type: 'run.error',
        payload: {
          ...common,
          error: `${reason.error.code}: ${reason.error.message}`,
          ...(reason.error.code === 'TIMEOUT' ? { code: 'TIMEOUT' } : {}),
        },
      };
    }
    const terminalReason =
      reason.kind === 'max-tokens'
        ? 'max_steps_reached'
        : reason.kind === 'aborted' || reason.kind === 'interrupted'
          ? 'abort'
          : reason.kind === 'blocked'
            ? 'pause'
            : 'stop';
    this.updateStatus(
      sessionId,
      reason.kind === 'blocked'
        ? 'paused'
        : reason.kind === 'aborted' || reason.kind === 'interrupted'
          ? 'interrupted'
          : 'completed'
    );
    return { type: 'assistant.completed', payload: { ...common, terminal_reason: terminalReason } };
  }

  private insertPublicEvent(sessionId: string, event: ProjectedPublicEvent): PublicSessionEvent {
    const seq = this.nextPublicSeq(sessionId);
    this.db
      .prepare(
        `INSERT INTO session_events(session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, NULL)`
      )
      .run(sessionId, seq, event.type, JSON.stringify(event.payload), new Date().toISOString());
    return { type: event.type, seq, ...event.payload } as PublicSessionEvent;
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
      this.db.prepare('UPDATE messages SET content = content || ? WHERE id = ?').run(content, id);
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

function assertSeq(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${name} must be a non-negative integer`);
}
