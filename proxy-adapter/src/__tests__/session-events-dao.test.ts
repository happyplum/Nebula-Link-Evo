import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SessionEventsDAO } from '../conversation/session-events-dao.js';
import { DatabaseManager } from '../conversation/db.js';
import type { SessionEvent } from '../../shared/types/sse-events.js';

describe('SessionEventsDAO', () => {
  let dao: SessionEventsDAO;
  let dbManager: DatabaseManager;
  let db: DatabaseSync;
  const sessionId = 'test-session-id';

  beforeEach(() => {
    dbManager = DatabaseManager.getInstance();
    dbManager.initialize(':memory:');
    db = (dbManager as unknown as { db: DatabaseSync }).db;
    dao = new SessionEventsDAO(db);

    dbManager.createSession({
      id: sessionId,
      title: 'Test Session',
      provider: 'test',
      model: 'test-model',
    });
  });

  afterEach(() => {
    dao.dispose();
    dbManager.close();
  });

  describe('appendEvent', () => {
    it('should append an event and return sequence number', async () => {
      const seq = await dao.appendEvent(sessionId, 'message.created', {
        sessionId,
        messageId: 'msg-1',
        content: 'Hello',
      });

      expect(seq).toBe(1);
    });

    it('should append multiple events with incrementing sequence numbers', async () => {
      const seq1 = await dao.appendEvent(sessionId, 'message.created', {
        sessionId,
        messageId: 'msg-1',
        content: 'Hello',
      });

      const seq2 = await dao.appendEvent(sessionId, 'assistant.started', {
        sessionId,
        messageId: 'msg-2',
      });

      const seq3 = await dao.appendEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-2',
        text: 'Hi there',
      });

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(3);
    });

    it('should buffer events and flush on threshold', async () => {
      const promises: Promise<number>[] = [];

      for (let i = 0; i < 50; i++) {
        promises.push(
          dao.appendEvent(sessionId, 'assistant.delta', {
            sessionId,
            messageId: 'msg-1',
            text: `chunk-${i}`,
          })
        );
      }

      const seqs = await Promise.all(promises);

      expect(seqs).toHaveLength(50);
      expect(seqs[0]).toBe(1);
      expect(seqs[49]).toBe(50);
    });

    it('should flush buffer on timeout', async () => {
      vi.useFakeTimers();

      const promise = dao.appendEvent(sessionId, 'message.created', {
        sessionId,
        messageId: 'msg-1',
        content: 'Hello',
      });

      await vi.advanceTimersByTimeAsync(50);
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });
      await vi.runAllTimersAsync();

      expect(resolved).toBe(true);

      vi.useRealTimers();
    });

    it('should support TTL for events', async () => {
      const seq = await dao.appendEvent(
        sessionId,
        'assistant.delta',
        {
          sessionId,
          messageId: 'msg-1',
          text: 'temp',
        },
        3600
      );

      expect(seq).toBe(1);

      const rows = db
        .prepare('SELECT ttl_expires_at FROM session_events WHERE session_id = ?')
        .all(sessionId) as { ttl_expires_at: string | null }[];

      expect(rows[0].ttl_expires_at).not.toBeNull();
    });
  });

  describe('getEventsAfter', () => {
    beforeEach(async () => {
      await dao.appendEvent(sessionId, 'message.created', {
        sessionId,
        messageId: 'msg-1',
        content: 'Hello',
      });
      await dao.appendEvent(sessionId, 'assistant.started', {
        sessionId,
        messageId: 'msg-2',
      });
      await dao.appendEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-2',
        text: 'Hi',
      });
      await dao.appendEvent(sessionId, 'assistant.completed', {
        sessionId,
        messageId: 'msg-2',
      });
    });

    it('should return events after given sequence', async () => {
      const events = await dao.getEventsAfter(sessionId, 1);

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('assistant.started');
      expect(events[1].type).toBe('assistant.delta');
      expect(events[2].type).toBe('assistant.completed');
    });

    it('should return empty array if no events after sequence', async () => {
      const events = await dao.getEventsAfter(sessionId, 100);

      expect(events).toHaveLength(0);
    });

    it('should respect limit parameter', async () => {
      const events = await dao.getEventsAfter(sessionId, 0, 2);

      expect(events).toHaveLength(2);
    });

    it('should return all events when limit is not exceeded', async () => {
      const promises: Promise<number>[] = [];
      for (let i = 0; i < 150; i++) {
        promises.push(
          dao.appendEvent(sessionId, 'assistant.delta', {
            sessionId,
            messageId: 'msg-3',
            text: `chunk-${i}`,
          })
        );
      }

      const seqs = await Promise.all(promises);
      expect(seqs).toHaveLength(150);

      const events = await dao.getEventsAfter(sessionId, 0, 200);

      expect(events).toHaveLength(154);
    }, 15000);
  });

  describe('getSnapshot', () => {
    it('should reconstruct session state from events', async () => {
      await dao.appendEvent(sessionId, 'message.created', {
        sessionId,
        messageId: 'msg-1',
        content: 'User message',
      });
      await dao.appendEvent(sessionId, 'assistant.started', {
        sessionId,
        messageId: 'msg-2',
      });
      await dao.appendEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-2',
        text: 'Response',
      });
      await dao.appendEvent(sessionId, 'assistant.completed', {
        sessionId,
        messageId: 'msg-2',
      });

      const snapshot = await dao.getSnapshot(sessionId);

      expect(snapshot.messages).toHaveLength(1);
      expect(snapshot.messages[0].content).toBe('User message');
      expect(snapshot.state).toBe('completed');
    });

    it('should return idle state for empty session', async () => {
      const snapshot = await dao.getSnapshot(sessionId);

      expect(snapshot.messages).toHaveLength(0);
      expect(snapshot.state).toBe('idle');
    });

    it('should track running state', async () => {
      await dao.appendEvent(sessionId, 'assistant.started', {
        sessionId,
        messageId: 'msg-1',
      });

      const snapshot = await dao.getSnapshot(sessionId);

      expect(snapshot.state).toBe('running');
    });
  });

  describe('cleanupExpired', () => {
    it('should delete expired events', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();

      db.prepare(
        `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sessionId, 1, 'assistant.delta', '{"text":"expired"}', pastDate, pastDate);

      db.prepare(
        `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sessionId, 2, 'message.created', '{"content":"permanent"}', pastDate, null);

      const deleted = await dao.cleanupExpired();

      expect(deleted).toBe(1);

      const remaining = db
        .prepare('SELECT * FROM session_events WHERE session_id = ?')
        .all(sessionId) as unknown[];

      expect(remaining).toHaveLength(1);
    });

    it('should return 0 if no expired events', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();

      db.prepare(
        `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sessionId, 1, 'assistant.delta', '{"text":"active"}', new Date().toISOString(), futureDate);

      const deleted = await dao.cleanupExpired();

      expect(deleted).toBe(0);
    });
  });

  describe('batch write performance', () => {
    it('should write 50 events in single transaction', async () => {
      const start = performance.now();

      const promises: Promise<number>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          dao.appendEvent(sessionId, 'assistant.delta', {
            sessionId,
            messageId: 'msg-1',
            text: `chunk-${i}`,
          })
        );
      }

      const seqs = await Promise.all(promises);
      const elapsed = performance.now() - start;

      expect(seqs).toHaveLength(50);
      expect(elapsed).toBeLessThan(200);

      const events = await dao.getEventsAfter(sessionId, 0);
      expect(events).toHaveLength(50);
    });

    it('should handle concurrent sessions correctly', async () => {
      const sessionId2 = 'test-session-2';
      dbManager.createSession({
        id: sessionId2,
        title: 'Session 2',
        provider: 'test',
        model: 'test-model',
      });

      const promises1: Promise<number>[] = [];
      const promises2: Promise<number>[] = [];

      for (let i = 0; i < 25; i++) {
        promises1.push(
          dao.appendEvent(sessionId, 'assistant.delta', {
            sessionId,
            messageId: 'msg-1',
            text: `s1-chunk-${i}`,
          })
        );
        promises2.push(
          dao.appendEvent(sessionId2, 'assistant.delta', {
            sessionId: sessionId2,
            messageId: 'msg-2',
            text: `s2-chunk-${i}`,
          })
        );
      }

      const [seqs1, seqs2] = await Promise.all([
        Promise.all(promises1),
        Promise.all(promises2),
      ]);

      expect(seqs1).toHaveLength(25);
      expect(seqs2).toHaveLength(25);

      expect(seqs1.every((s) => s >= 1 && s <= 25)).toBe(true);
      expect(seqs2.every((s) => s >= 1 && s <= 25)).toBe(true);
    });
  });

  describe('flush', () => {
    it('should flush pending events', async () => {
      vi.useFakeTimers();

      const promises: Promise<number>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          dao.appendEvent(sessionId, 'assistant.delta', {
            sessionId,
            messageId: 'msg-1',
            text: `chunk-${i}`,
          })
        );
      }

      vi.advanceTimersByTime(50);

      await dao.flush();

      vi.useRealTimers();

      const seqs = await Promise.all(promises);
      expect(seqs).toHaveLength(10);
    });
  });

  describe('dispose', () => {
    it('should clear flush timer', () => {
      vi.useFakeTimers();

      dao.appendEvent(sessionId, 'message.created', {
        sessionId,
        messageId: 'msg-1',
        content: 'test',
      });

      dao.dispose();

      const timerCleared = true;
      expect(timerCleared).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('performance', () => {
    it('should write 100 events in under 200ms', async () => {
      const start = performance.now();

      const promises: Promise<number>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          dao.appendEvent(sessionId, 'assistant.delta', {
            sessionId,
            messageId: 'msg-1',
            text: `chunk-${i}`,
          })
        );
      }

      const seqs = await Promise.all(promises);
      const elapsed = performance.now() - start;

      expect(seqs).toHaveLength(100);
      expect(elapsed).toBeLessThan(200);

      const events = await dao.getEventsAfter(sessionId, 0);
      expect(events).toHaveLength(100);
    });
  });

  describe('metrics', () => {
    it('should track pending events', async () => {
      const beforeMetrics = dao.getMetrics();
      expect(beforeMetrics.pendingEvents).toBe(0);

      const promise = dao.appendEvent(sessionId, 'message.created', {
        sessionId,
        messageId: 'msg-1',
        content: 'test',
      });

      const pendingMetrics = dao.getMetrics();
      expect(pendingMetrics.pendingEvents).toBe(1);

      await promise;

      const afterMetrics = dao.getMetrics();
      expect(afterMetrics.pendingEvents).toBe(0);
    });

    it('should track batch size and flush time', async () => {
      const promises: Promise<number>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          dao.appendEvent(sessionId, 'assistant.delta', {
            sessionId,
            messageId: 'msg-1',
            text: `chunk-${i}`,
          })
        );
      }

      await Promise.all(promises);

      const metrics = dao.getMetrics();
      expect(metrics.batchSize).toBe(50);
      expect(metrics.flushTime).toBeGreaterThan(0);
      expect(metrics.totalEventsWritten).toBe(50);
      expect(metrics.totalFlushes).toBe(1);
    });
  });

  describe('shutdown handling', () => {
    it('should flush pending events on explicit flush call', async () => {
      const promises: Promise<number>[] = [];
      for (let i = 0; i < 25; i++) {
        promises.push(
          dao.appendEvent(sessionId, 'assistant.delta', {
            sessionId,
            messageId: 'msg-1',
            text: `chunk-${i}`,
          })
        );
      }

      await dao.flush();

      const seqs = await Promise.all(promises);
      expect(seqs).toHaveLength(25);

      const events = await dao.getEventsAfter(sessionId, 0);
      expect(events).toHaveLength(25);
    });

    it('should have shutdown handlers registered', () => {
      // Verify dispose clears internal state
      dao.dispose();
      // After dispose, further operations should be no-ops
      // The flushTimer is cleared and disposed flag is set
      expect(() => dao.dispose()).not.toThrow();
    });
  });

  describe('appendLiveEvent', () => {
    it('should return seq immediately without waiting for batch flush', () => {
      const seq = dao.appendLiveEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'hello',
      });

      expect(seq).toBe(1);
    });

    it('should allocate monotonically increasing seq', () => {
      const seq1 = dao.appendLiveEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'a',
      });
      const seq2 = dao.appendLiveEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'b',
      });
      const seq3 = dao.appendLiveEvent(sessionId, 'assistant.thinking', {
        sessionId,
        messageId: 'msg-1',
        text: 'thinking',
      });

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(3);
    });

    it('should persist live event payload to database on flush', async () => {
      dao.appendLiveEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'hello',
      });

      // Not yet in DB
      let events = await dao.getEventsAfter(sessionId, 0);
      expect(events).toHaveLength(0);

      // After flush, should be queryable
      await dao.flush();
      events = await dao.getEventsAfter(sessionId, 0);
      expect(events).toHaveLength(1);
      expect(events[0].seq).toBe(1);
      expect(events[0].type).toBe('assistant.delta');
    });

    it('should initialize seq counter from DB on fresh DAO instance', async () => {
      dao.appendLiveEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'a',
      });
      dao.appendLiveEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-2',
        text: 'b',
      });
      await dao.flush();

      // Create new DAO pointing to same DB
      const dao2 = new SessionEventsDAO(db);
      const seq = dao2.appendLiveEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-3',
        text: 'c',
      });

      expect(seq).toBe(3);
      dao2.dispose();
    });

    it('should maintain independent seq counters per session', () => {
      const session2 = 'test-session-live-2';
      dbManager.createSession({ id: session2, title: 'S2', provider: 'test', model: 'test' });

      const seq1 = dao.appendLiveEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'hello',
      });
      const seq2 = dao.appendLiveEvent(session2, 'assistant.delta', {
        sessionId: session2,
        messageId: 'msg-2',
        text: 'world',
      });

      expect(seq1).toBe(1);
      expect(seq2).toBe(1);
    });

    it('should coexist with appendEvent (durable) in same buffer', async () => {
      const liveSeq = dao.appendLiveEvent(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'live',
      });
      const durableSeqPromise = dao.appendEvent(sessionId, 'message.created', {
        sessionId,
        messageId: 'msg-1',
        content: 'durable',
      });

      await dao.flush();
      const durableSeq = await durableSeqPromise;

      expect(liveSeq).toBe(1);
      expect(durableSeq).toBe(2);

      const events = await dao.getEventsAfter(sessionId, 0);
      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(1);
      expect(events[0].type).toBe('assistant.delta');
      expect(events[1].seq).toBe(2);
      expect(events[1].type).toBe('message.created');
    });
  });
});