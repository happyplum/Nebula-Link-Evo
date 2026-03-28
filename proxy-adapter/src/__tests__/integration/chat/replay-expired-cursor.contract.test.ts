import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationManager } from '../../../conversation/manager.js';
import { DatabaseManager } from '../../../conversation/db.js';
import { SessionEventsDAO } from '../../../conversation/session-events-dao.js';

describe('replay expired-cursor contract', () => {
  let manager: ConversationManager;
  let dao: SessionEventsDAO;
  let sessionId: string;

  beforeEach(() => {
    DatabaseManager.resetInstance();
    manager = new ConversationManager(':memory:');
    manager.initialize();
    dao = DatabaseManager.getInstance().getSessionEventsDAO();

    sessionId = `replay-expired-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    manager.createSession({
      id: sessionId,
      title: 'replay-expired',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });
  });

  afterEach(async () => {
    await manager.close();
  });

  describe('getMinSeq', () => {
    it('returns null for session with no events', () => {
      expect(dao.getMinSeq(sessionId)).toBeNull();
    });

    it('returns 1 for first event written', () => {
      dao.appendEventSync(sessionId, 'assistant.started', {
        sessionId,
        messageId: 'msg-1',
      });
      expect(dao.getMinSeq(sessionId)).toBe(1);
    });

    it('returns updated min after TTL cleanup deletes earliest events', async () => {
      dao.appendEventSync(sessionId, 'message.created', {
        sessionId,
        messageId: 'msg-1',
        content: 'hi',
      }, 1);
      dao.appendEventSync(sessionId, 'assistant.started', {
        sessionId,
        messageId: 'msg-1',
      }, 1);
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'persistent',
      });

      expect(dao.getMinSeq(sessionId)).toBe(1);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      const deleted = await dao.cleanupExpired();
      expect(deleted).toBe(2);
      expect(dao.getMinSeq(sessionId)).toBe(3);

      vi.useRealTimers();
    });

    it('returns null when all events are TTL-deleted', async () => {
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'ephemeral-1',
      }, 1);
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'ephemeral-2',
      }, 1);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      await dao.cleanupExpired();
      expect(dao.getMinSeq(sessionId)).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('getEventsAfter with stale cursor', () => {
    it('returns events from min available seq when cursor is stale', async () => {
      for (let i = 1; i <= 10; i++) {
        dao.appendEventSync(sessionId, 'assistant.delta', {
          sessionId,
          messageId: 'msg-1',
          text: `chunk-${i}`,
        }, i <= 5 ? 1 : undefined);
      }

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      await dao.cleanupExpired();
      expect(dao.getMinSeq(sessionId)).toBe(6);

      const events = await dao.getEventsAfter(sessionId, 3, 100);
      expect(events).toHaveLength(5);
      expect(events[0].seq).toBe(6);
      expect(events[events.length - 1].seq).toBe(10);

      vi.useRealTimers();
    });

    it('returns empty when all events expired and cursor is stale', async () => {
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'gone',
      }, 1);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      await dao.cleanupExpired();

      const events = await dao.getEventsAfter(sessionId, 0, 100);
      expect(events).toHaveLength(0);

      vi.useRealTimers();
    });

    it('no crash when cursor points below deleted range', async () => {
      dao.appendEventSync(sessionId, 'assistant.started', {
        sessionId,
        messageId: 'msg-1',
      }, 1);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      await dao.cleanupExpired();

      const events = await dao.getEventsAfter(sessionId, 999, 100);
      expect(events).toHaveLength(0);

      vi.useRealTimers();
    });
  });

  describe('gap detection contract', () => {
    it('detects gap when lastSeq < minSeq - 1', async () => {
      for (let i = 1; i <= 10; i++) {
        dao.appendEventSync(sessionId, 'assistant.delta', {
          sessionId,
          messageId: 'msg-1',
          text: `chunk-${i}`,
        }, i <= 7 ? 1 : undefined);
      }

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      await dao.cleanupExpired();
      const minSeq = dao.getMinSeq(sessionId);
      expect(minSeq).toBe(8);

      const lastSeq = 3;
      const hasGap = minSeq !== null && lastSeq < minSeq - 1;
      expect(hasGap).toBe(true);

      const replayFrom = minSeq !== null ? minSeq - 1 : lastSeq;
      const events = await dao.getEventsAfter(sessionId, replayFrom, 100);
      expect(events).toHaveLength(3);
      expect(events[0].seq).toBe(8);

      vi.useRealTimers();
    });

    it('no gap when lastSeq equals minSeq - 1', async () => {
      dao.appendEventSync(sessionId, 'assistant.started', {
        sessionId,
        messageId: 'msg-1',
      }, 1);
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'kept',
      });

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      await dao.cleanupExpired();
      const minSeq = dao.getMinSeq(sessionId);
      expect(minSeq).toBe(2);

      const lastSeq = 1;
      const hasGap = minSeq !== null && lastSeq < minSeq - 1;
      expect(hasGap).toBe(false);

      vi.useRealTimers();
    });

    it('detects gap when all events expired and client had events', async () => {
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'gone',
      }, 1);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      await dao.cleanupExpired();
      const minSeq = dao.getMinSeq(sessionId);

      const lastSeq = 1;
      const hasGap =
        (minSeq !== null && lastSeq < minSeq - 1) ||
        (minSeq === null && lastSeq > 0);
      expect(hasGap).toBe(true);

      vi.useRealTimers();
    });

    it('no gap when all events expired and client had none (lastSeq=0)', async () => {
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: 'gone',
      }, 1);

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      await dao.cleanupExpired();
      const minSeq = dao.getMinSeq(sessionId);

      const lastSeq = 0;
      const hasGap =
        (minSeq !== null && lastSeq < minSeq - 1) ||
        (minSeq === null && lastSeq > 0);
      expect(hasGap).toBe(false);

      vi.useRealTimers();
    });
  });
});
