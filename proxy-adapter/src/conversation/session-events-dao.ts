import { DatabaseSync } from 'node:sqlite';
import type { SessionEvent, SessionEventType, SessionState } from '../../../shared/types/sse-events.js';
import type { Message } from './types.js';

interface BufferedEvent {
  sessionId: string;
  eventType: SessionEventType;
  payload: string;
  ttlSeconds?: number;
  resolve: (seq: number) => void;
  reject: (error: Error) => void;
}

interface SessionEventRow {
  id: number;
  session_id: string;
  seq: number;
  event_type: string;
  payload: string;
  created_at: string;
  ttl_expires_at: string | null;
}

interface SnapshotResult {
  messages: Message[];
  state: SessionState;
}

const FLUSH_INTERVAL_MS = 100;
const FLUSH_THRESHOLD = 50;
const MAX_REPLAY_LIMIT = 10000;

export interface SessionEventsDAOMetrics {
  /** Number of events in the last batch flush */
  batchSize: number;
  /** Time in ms for the last flush operation */
  flushTime: number;
  /** Number of events currently pending in buffer */
  pendingEvents: number;
  /** Total events written since instantiation */
  totalEventsWritten: number;
  /** Total number of flush operations */
  totalFlushes: number;
}

export class SessionEventsDAO {
  private db: DatabaseSync;
  private buffer: BufferedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private isFlushing = false;
  private disposed = false;
  private shutdownHandlersRegistered = false;
  private metrics: SessionEventsDAOMetrics = {
    batchSize: 0,
    flushTime: 0,
    pendingEvents: 0,
    totalEventsWritten: 0,
    totalFlushes: 0,
  };

  constructor(db: DatabaseSync) {
    this.db = db;
    this.registerShutdownHandlers();
  }

  /**
   * Append an event to the batch buffer.
   * Returns the sequence number assigned to this event.
   */
  async appendEvent(
    sessionId: string,
    eventType: SessionEventType,
    payload: Record<string, unknown>,
    ttlSeconds?: number
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const payloadStr = JSON.stringify(payload);
      this.buffer.push({
        sessionId,
        eventType,
        payload: payloadStr,
        ttlSeconds,
        resolve,
        reject,
      });

      if (this.buffer.length >= FLUSH_THRESHOLD) {
        this.flushBuffer();
      } else {
        this.scheduleFlush();
      }
    });
  }

  /**
   * Append an event with immediate durable write.
   * This bypasses the batch buffer and throws on write failure.
   */
  appendEventSync(
    sessionId: string,
    eventType: SessionEventType,
    payload: Record<string, unknown>,
    ttlSeconds?: number
  ): number {
    this.flushSync();

    const now = new Date();
    const seq = this.getNextSeq(sessionId);
    const createdAt = now.toISOString();
    const payloadStr = JSON.stringify(payload);
    const ttlExpiresAt = ttlSeconds
      ? new Date(now.getTime() + ttlSeconds * 1000).toISOString()
      : null;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const stmt = this.db.prepare(
        `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      stmt.run(sessionId, seq, eventType, payloadStr, createdAt, ttlExpiresAt);
      this.db.exec('COMMIT');

      this.metrics.batchSize = 1;
      this.metrics.flushTime = 0;
      this.metrics.totalEventsWritten += 1;
      this.metrics.totalFlushes += 1;

      return seq;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Get events after a given sequence number.
   * Returns up to `limit` events in order.
   * If `lastSeq` is below the minimum available seq (e.g. TTL-deleted gap),
   * events are returned starting from the earliest available seq.
   */
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
    const rows = stmt.all(sessionId, effectiveLastSeq, clampedLimit) as SessionEventRow[];
    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * Get the minimum available sequence number for a session.
   * Returns null if no events exist for the session.
   * Reflects only non-deleted events (TTL cleanup physically removes rows).
   */
  getMinSeq(sessionId: string): number | null {
    const stmt = this.db.prepare(
      `SELECT MIN(seq) as min_seq FROM session_events WHERE session_id = ?`
    );
    const row = stmt.get(sessionId) as { min_seq: number | null };
    return row.min_seq;
  }

  /**
   * Get session snapshot by replaying events.
   * Reconstructs messages and current state from event stream.
   */
  async getSnapshot(sessionId: string): Promise<SnapshotResult> {
    const stmt = this.db.prepare(
      `SELECT * FROM session_events
       WHERE session_id = ?
       ORDER BY seq ASC`
    );
    const rows = stmt.all(sessionId) as SessionEventRow[];

    const messages: Message[] = [];
    let state: SessionState = 'idle';

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

  /**
   * Map thinking content to real message IDs by positional ordering.
   *
   * Events use temp IDs (msg_xxx) but messages in the DB have real UUIDs.
   * We correlate by position: Nth assistant.started → Nth assistant message.
   */
  getThinkingForSession(
    sessionId: string,
    assistantMessageIds: string[]
  ): Map<string, string> {
    const thinkingMap = new Map<string, string>();
    if (assistantMessageIds.length === 0) return thinkingMap;

    // 1. Get assistant.started events in seq order → extract temp messageIds
    const startedStmt = this.db.prepare(
      `SELECT payload FROM session_events
       WHERE session_id = ? AND event_type = 'assistant.started'
       ORDER BY seq ASC`
    );
    const startedRows = startedStmt.all(sessionId) as Array<{ payload: string }>;
    const tempMessageIds: string[] = [];
    for (const row of startedRows) {
      try {
        const payload = JSON.parse(row.payload) as { messageId: string };
        tempMessageIds.push(payload.messageId);
      } catch {
        // Skip malformed
      }
    }

    if (tempMessageIds.length === 0) return thinkingMap;

    // 2. Get all thinking events grouped by temp messageId
    const thinkingStmt = this.db.prepare(
      `SELECT payload FROM session_events
       WHERE session_id = ? AND event_type = 'assistant.thinking'
       ORDER BY seq ASC`
    );
    const thinkingRows = thinkingStmt.all(sessionId) as Array<{ payload: string }>;
    const thinkingByTextId = new Map<string, string>();
    for (const row of thinkingRows) {
      try {
        const payload = JSON.parse(row.payload) as { messageId: string; text: string };
        const existing = thinkingByTextId.get(payload.messageId) || '';
        thinkingByTextId.set(payload.messageId, existing + payload.text);
      } catch {
        // Skip malformed
      }
    }

    // 3. Map by position: Nth tempMessageId → Nth real UUID
    const mapLen = Math.min(tempMessageIds.length, assistantMessageIds.length);
    for (let i = 0; i < mapLen; i++) {
      const thinking = thinkingByTextId.get(tempMessageIds[i]);
      if (thinking) {
        thinkingMap.set(assistantMessageIds[i], thinking);
      }
    }

    return thinkingMap;
  }

  /**
   * Delete expired events based on TTL.
   * Returns the number of deleted rows.
   */
  async cleanupExpired(): Promise<number> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `DELETE FROM session_events WHERE ttl_expires_at IS NOT NULL AND ttl_expires_at < ?`
    );
    const result = stmt.run(now);
    return result.changes;
  }

  /**
   * Force flush any pending events.
   * Call before closing the database connection.
   */
  async flush(): Promise<void> {
    if (this.flushPromise) {
      await this.flushPromise;
    }
    if (this.buffer.length > 0) {
      await this.flushBuffer();
    }
  }

  /**
   * Force flush pending buffered events immediately in the current call stack.
   */
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

  /**
   * Clear the flush timer. Call when disposing the DAO.
   */
  dispose(): void {
    this.disposed = true;
    this.unregisterShutdownHandlers();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Get current metrics for monitoring.
   */
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
    if (this.disposed) return;
    await this.flush();
  };

  private handleSignal = async (): Promise<void> => {
    if (this.disposed) return;
    await this.flush();
  };

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushBuffer();
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

  private async executeBatch(events: BufferedEvent[]): Promise<void> {
    this.executeBatchSync(events);
  }

  private executeBatchSync(events: BufferedEvent[]): void {
    if (events.length === 0) {
      return;
    }

    const flushStart = performance.now();
    const now = new Date();
    const ttlCache = new Map<string, string>();
    const resolvedEvents: Array<{ event: BufferedEvent; seq: number }> = [];

    try {
      this.db.exec('BEGIN IMMEDIATE');

      for (const event of events) {
        let ttlExpiresAt: string | null = null;
        if (event.ttlSeconds) {
          ttlExpiresAt = ttlCache.get(event.sessionId) ?? 
            new Date(now.getTime() + event.ttlSeconds * 1000).toISOString();
          ttlCache.set(event.sessionId, ttlExpiresAt);
        }

        const seq = this.getNextSeq(event.sessionId);
        const createdAt = now.toISOString();

        const stmt = this.db.prepare(
          `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        stmt.run(
          event.sessionId,
          seq,
          event.eventType,
          event.payload,
          createdAt,
          ttlExpiresAt
        );
        resolvedEvents.push({ event, seq });
      }

      this.db.exec('COMMIT');

      for (const resolved of resolvedEvents) {
        resolved.event.resolve(resolved.seq);
      }

      // Update metrics on success
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

  private getNextSeq(sessionId: string): number {
    const stmt = this.db.prepare(
      `SELECT COALESCE(MAX(seq), 0) as max_seq FROM session_events WHERE session_id = ?`
    );
    const row = stmt.get(sessionId) as { max_seq: number };
    return row.max_seq + 1;
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
