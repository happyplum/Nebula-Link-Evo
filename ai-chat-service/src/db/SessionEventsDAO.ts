import { DatabaseSync } from 'node:sqlite';
import type {
  SessionEvent,
  SessionEventType,
  SessionState as SseSessionState,
} from '@nebula-link-evo/shared/types/sse-events';
import type { Message } from './types.js';

interface BufferedEvent {
  readonly sessionId: string;
  readonly eventType: SessionEventType;
  readonly payload: string;
  readonly ttlSeconds?: number;
  readonly seq?: number;
  readonly resolve: (seq: number) => void;
  readonly reject: (error: Error) => void;
}

interface SessionEventRow {
  readonly id: number;
  readonly session_id: string;
  readonly seq: number;
  readonly event_type: string;
  readonly payload: string;
  readonly created_at: string;
  readonly ttl_expires_at: string | null;
}

interface SnapshotResult {
  readonly messages: Message[];
  readonly state: SseSessionState;
}

const FLUSH_INTERVAL_MS = 100;
const FLUSH_THRESHOLD = 50;
const MAX_REPLAY_LIMIT = 10000;

// allow: SIZE_OK — T6 keeps SessionEventsDAO method parity with the existing proxy DAO; split after T7 consumers move here.

export interface SessionEventsDAOMetrics {
  readonly batchSize: number;
  readonly flushTime: number;
  readonly pendingEvents: number;
  readonly totalEventsWritten: number;
  readonly totalFlushes: number;
}

export class SessionEventsDAO {
  private buffer: BufferedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private isFlushing = false;
  private disposed = false;
  private shutdownHandlersRegistered = false;
  private sessionSeqCounters = new Map<string, number>();
  private metrics = {
    batchSize: 0,
    flushTime: 0,
    pendingEvents: 0,
    totalEventsWritten: 0,
    totalFlushes: 0,
  } satisfies SessionEventsDAOMetrics;

  constructor(private readonly db: DatabaseSync) {
    this.registerShutdownHandlers();
  }

  async appendEvent(
    sessionId: string,
    eventType: SessionEventType,
    payload: Record<string, unknown>,
    ttlSeconds?: number
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.buffer.push({
        sessionId,
        eventType,
        payload: JSON.stringify(payload),
        ttlSeconds,
        resolve,
        reject,
      });

      if (this.buffer.length >= FLUSH_THRESHOLD) {
        void this.flushBuffer();
      } else {
        this.scheduleFlush();
      }
    });
  }

  appendEventSync(
    sessionId: string,
    eventType: SessionEventType,
    payload: Record<string, unknown>,
    ttlSeconds?: number
  ): number {
    this.flushSync();

    const now = new Date();
    const createdAt = now.toISOString();
    const ttlExpiresAt = ttlSeconds
      ? new Date(now.getTime() + ttlSeconds * 1000).toISOString()
      : null;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const seq = this.allocateSeq(sessionId);
      const stmt = this.db.prepare(
        `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      stmt.run(sessionId, seq, eventType, JSON.stringify(payload), createdAt, ttlExpiresAt);
      this.db.exec('COMMIT');

      this.metrics.batchSize = 1;
      this.metrics.flushTime = 0;
      this.metrics.totalEventsWritten += 1;
      this.metrics.totalFlushes += 1;

      return seq;
    } catch (error) {
      this.db.exec('ROLLBACK');
      const counter = this.sessionSeqCounters.get(sessionId);
      if (counter !== undefined) {
        this.sessionSeqCounters.set(sessionId, counter - 1);
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  appendLiveEvent(
    sessionId: string,
    eventType: SessionEventType,
    payload: Record<string, unknown>,
    ttlSeconds?: number
  ): number {
    const seq = this.allocateSeq(sessionId);

    this.buffer.push({
      sessionId,
      eventType,
      payload: JSON.stringify(payload),
      ttlSeconds,
      seq,
      resolve: () => {},
      reject: () => {},
    });

    if (this.buffer.length >= FLUSH_THRESHOLD) {
      void this.flushBuffer();
    } else {
      this.scheduleFlush();
    }

    return seq;
  }

  async getEventsAfter(
    sessionId: string,
    lastSeq: number,
    limit: number = MAX_REPLAY_LIMIT
  ): Promise<SessionEvent[]> {
    const clampedLimit = Math.min(limit, MAX_REPLAY_LIMIT);
    const minSeq = this.getMinSeq(sessionId);
    const effectiveLastSeq = minSeq !== null && lastSeq < minSeq ? minSeq - 1 : lastSeq;
    const stmt = this.db.prepare(
      `SELECT * FROM session_events
       WHERE session_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?`
    );
    const rows = stmt.all(
      sessionId,
      effectiveLastSeq,
      clampedLimit
    ) as unknown as SessionEventRow[];
    return rows.map((row) => this.rowToEvent(row));
  }

  getMinSeq(sessionId: string): number | null {
    const stmt = this.db.prepare(
      `SELECT MIN(seq) as min_seq FROM session_events WHERE session_id = ?`
    );
    const row = stmt.get(sessionId) as { readonly min_seq: number | null };
    return row.min_seq;
  }

  getLastSeq(sessionId: string): number | null {
    const stmt = this.db.prepare(
      `SELECT MAX(seq) as max_seq FROM session_events WHERE session_id = ?`
    );
    const row = stmt.get(sessionId) as { readonly max_seq: number | null };
    return row.max_seq;
  }

  /** Advance the in-process allocator after another transaction committed a public event. */
  observeCommittedSeq(sessionId: string, seq: number): void {
    const current = this.sessionSeqCounters.get(sessionId) ?? this.getLastSeq(sessionId) ?? 0;
    if (seq > current) this.sessionSeqCounters.set(sessionId, seq);
  }

  async getSnapshot(sessionId: string): Promise<SnapshotResult> {
    const stmt = this.db.prepare(
      `SELECT * FROM session_events
       WHERE session_id = ?
       ORDER BY seq ASC`
    );
    const rows = stmt.all(sessionId) as unknown as SessionEventRow[];

    const messages: Message[] = [];
    let state: SseSessionState = 'idle';

    for (const row of rows) {
      const event = this.rowToEvent(row);
      switch (event.type) {
        case 'message.created':
          messages.push({
            id: event.messageId,
            session_id: event.sessionId,
            role: 'user',
            content: event.content,
            created_at: new Date().toISOString(),
            metadata: null,
          });
          break;
        case 'assistant.started':
          state = 'running';
          break;
        case 'assistant.completed':
          state = 'completed';
          break;
        case 'run.error':
          state = 'idle';
          break;
      }
    }

    return { messages, state };
  }

  getThinkingForSession(
    sessionId: string,
    assistantMessageIds: readonly string[]
  ): Map<string, string> {
    const thinkingMap = new Map<string, string>();
    if (assistantMessageIds.length === 0) {
      return thinkingMap;
    }

    const startedStmt = this.db.prepare(
      `SELECT payload FROM session_events
       WHERE session_id = ? AND event_type = 'assistant.started'
       ORDER BY seq ASC`
    );
    const startedRows = startedStmt.all(sessionId) as Array<{ readonly payload: string }>;
    const tempMessageIds: string[] = [];
    for (const row of startedRows) {
      try {
        const payload = JSON.parse(row.payload) as { readonly messageId: string };
        tempMessageIds.push(payload.messageId);
      } catch {
        // Skip malformed historical payloads.
      }
    }

    if (tempMessageIds.length === 0) {
      return thinkingMap;
    }

    const thinkingStmt = this.db.prepare(
      `SELECT payload FROM session_events
       WHERE session_id = ? AND event_type = 'assistant.thinking'
       ORDER BY seq ASC`
    );
    const thinkingRows = thinkingStmt.all(sessionId) as Array<{ readonly payload: string }>;
    const thinkingByTextId = new Map<string, string>();
    for (const row of thinkingRows) {
      try {
        const payload = JSON.parse(row.payload) as {
          readonly messageId: string;
          readonly text: string;
        };
        const existing = thinkingByTextId.get(payload.messageId) || '';
        thinkingByTextId.set(payload.messageId, existing + payload.text);
      } catch {
        // Skip malformed historical payloads.
      }
    }

    const mapLen = Math.min(tempMessageIds.length, assistantMessageIds.length);
    for (let i = 0; i < mapLen; i += 1) {
      const tempMessageId = tempMessageIds[i];
      const assistantMessageId = assistantMessageIds[i];
      if (tempMessageId === undefined || assistantMessageId === undefined) {
        continue;
      }
      const thinking = thinkingByTextId.get(tempMessageId);
      if (thinking) {
        thinkingMap.set(assistantMessageId, thinking);
      }
    }

    return thinkingMap;
  }

  async cleanupExpired(): Promise<number> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `DELETE FROM session_events WHERE ttl_expires_at IS NOT NULL AND ttl_expires_at < ?`
    );
    const result = stmt.run(now);
    return Number(result.changes);
  }

  async flush(): Promise<void> {
    if (this.flushPromise) {
      await this.flushPromise;
    }
    if (this.buffer.length > 0) {
      await this.flushBuffer();
    }
  }

  flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.flushPromise) {
      throw new Error('Cannot flush synchronously while async flush is in progress');
    }

    while (this.buffer.length > 0) {
      const eventsToFlush = this.buffer.splice(0, this.buffer.length);
      this.executeBatchSync(eventsToFlush);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unregisterShutdownHandlers();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  getMetrics(): SessionEventsDAOMetrics {
    return {
      ...this.metrics,
      pendingEvents: this.buffer.length,
    };
  }

  private registerShutdownHandlers(): void {
    if (this.shutdownHandlersRegistered) {
      return;
    }
    this.shutdownHandlersRegistered = true;
    process.on('beforeExit', this.handleBeforeExit);
    process.on('SIGINT', this.handleSignal);
    process.on('SIGTERM', this.handleSignal);
  }

  private unregisterShutdownHandlers(): void {
    if (!this.shutdownHandlersRegistered) {
      return;
    }
    this.shutdownHandlersRegistered = false;
    process.off('beforeExit', this.handleBeforeExit);
    process.off('SIGINT', this.handleSignal);
    process.off('SIGTERM', this.handleSignal);
  }

  private handleBeforeExit = async (): Promise<void> => {
    if (!this.disposed) {
      await this.flush();
    }
  };

  private handleSignal = async (): Promise<void> => {
    if (!this.disposed) {
      await this.flush();
    }
  };

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushBuffer();
    }, FLUSH_INTERVAL_MS);
  }

  private async flushBuffer(): Promise<void> {
    if (this.disposed || this.isFlushing || this.buffer.length === 0) {
      return;
    }

    this.isFlushing = true;
    const eventsToFlush = this.buffer.splice(0, this.buffer.length);
    this.flushPromise = this.executeBatch(eventsToFlush);

    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
      this.isFlushing = false;
    }

    if (this.buffer.length > 0) {
      await this.flushBuffer();
    }
  }

  private async executeBatch(events: readonly BufferedEvent[]): Promise<void> {
    this.executeBatchSync(events);
  }

  private executeBatchSync(events: readonly BufferedEvent[]): void {
    if (events.length === 0) {
      return;
    }

    const flushStart = performance.now();
    const now = new Date();
    const ttlCache = new Map<string, string>();
    const resolvedEvents: Array<{ readonly event: BufferedEvent; readonly seq: number }> = [];

    try {
      this.db.exec('BEGIN IMMEDIATE');

      for (const event of events) {
        let ttlExpiresAt: string | null = null;
        if (event.ttlSeconds) {
          ttlExpiresAt =
            ttlCache.get(event.sessionId) ??
            new Date(now.getTime() + event.ttlSeconds * 1000).toISOString();
          ttlCache.set(event.sessionId, ttlExpiresAt);
        }

        const seq = event.seq ?? this.allocateSeq(event.sessionId);
        const createdAt = now.toISOString();
        const stmt = this.db.prepare(
          `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        stmt.run(event.sessionId, seq, event.eventType, event.payload, createdAt, ttlExpiresAt);
        resolvedEvents.push({ event, seq });
      }

      this.db.exec('COMMIT');

      for (const resolved of resolvedEvents) {
        resolved.event.resolve(resolved.seq);
      }

      const flushEnd = performance.now();
      this.metrics.batchSize = events.length;
      this.metrics.flushTime = Math.round(flushEnd - flushStart);
      this.metrics.totalEventsWritten += events.length;
      this.metrics.totalFlushes += 1;
    } catch (error) {
      this.db.exec('ROLLBACK');
      for (const event of events) {
        event.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private allocateSeq(sessionId: string): number {
    let counter = this.sessionSeqCounters.get(sessionId);
    if (counter === undefined) {
      const stmt = this.db.prepare(
        `SELECT COALESCE(MAX(seq), 0) as max_seq FROM session_events WHERE session_id = ?`
      );
      const row = stmt.get(sessionId) as { readonly max_seq: number };
      counter = row.max_seq + 1;
      this.sessionSeqCounters.set(sessionId, counter);
    }
    const seq = counter;
    this.sessionSeqCounters.set(sessionId, counter + 1);
    return seq;
  }

  private rowToEvent(row: SessionEventRow): SessionEvent {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    return {
      seq: row.seq,
      type: row.event_type as SessionEvent['type'],
      ...payload,
    } as SessionEvent;
  }
}
