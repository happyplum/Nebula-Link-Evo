import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConversationManager } from '../../../conversation/manager.js';
import { DatabaseManager } from '../../../conversation/db.js';
import { SessionEventsDAO } from '../../../conversation/session-events-dao.js';
import type { SessionEvent } from '@nebula-link-evo/shared';

describe('replay after-seq contract', () => {
  let manager: ConversationManager;
  let dao: SessionEventsDAO;
  let sessionId: string;

  beforeEach(() => {
    DatabaseManager.resetInstance();
    manager = new ConversationManager(':memory:');
    manager.initialize();
    dao = DatabaseManager.getInstance().getSessionEventsDAO();

    sessionId = `replay-after-seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    manager.createSession({
      id: sessionId,
      title: 'replay-after-seq',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });
  });

  afterEach(async () => {
    await manager.close();
  });

  it('returns events in ascending seq order after lastSeq', async () => {
    for (let i = 1; i <= 10; i++) {
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: `chunk-${i}`,
      });
    }

    const events = await dao.getEventsAfter(sessionId, 3, 100);

    expect(events).toHaveLength(7);
    for (let i = 0; i < events.length - 1; i++) {
      expect(events[i].seq).toBeDefined();
      expect(events[i + 1].seq).toBeDefined();
      expect(events[i].seq!).toBeLessThan(events[i + 1].seq!);
    }
    expect(events[0].seq).toBe(4);
    expect(events[events.length - 1].seq).toBe(10);
  });

  it('returns empty array when lastSeq equals or exceeds max seq', async () => {
    dao.appendEventSync(sessionId, 'assistant.started', {
      sessionId,
      messageId: 'msg-1',
    });
    dao.appendEventSync(sessionId, 'assistant.delta', {
      sessionId,
      messageId: 'msg-1',
      text: 'hello',
    });

    const eventsAtMax = await dao.getEventsAfter(sessionId, 2, 100);
    expect(eventsAtMax).toHaveLength(0);

    const eventsBeyondMax = await dao.getEventsAfter(sessionId, 999, 100);
    expect(eventsBeyondMax).toHaveLength(0);
  });

  it('returns all events when lastSeq is 0', async () => {
    dao.appendEventSync(sessionId, 'message.created', {
      sessionId,
      messageId: 'msg-1',
      content: 'hi',
    });
    dao.appendEventSync(sessionId, 'assistant.started', {
      sessionId,
      messageId: 'msg-1',
    });

    const events = await dao.getEventsAfter(sessionId, 0, 100);
    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(1);
    expect(events[1].seq).toBe(2);
  });

  it('respects the limit parameter', async () => {
    for (let i = 1; i <= 20; i++) {
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: `chunk-${i}`,
      });
    }

    const events = await dao.getEventsAfter(sessionId, 0, 5);
    expect(events).toHaveLength(5);
    expect(events[events.length - 1].seq).toBe(5);
  });

  it('no duplicates across consecutive replay calls', async () => {
    for (let i = 1; i <= 5; i++) {
      dao.appendEventSync(sessionId, 'assistant.delta', {
        sessionId,
        messageId: 'msg-1',
        text: `chunk-${i}`,
      });
    }

    const batch1 = await dao.getEventsAfter(sessionId, 0, 3);
    const lastSeq = batch1[batch1.length - 1].seq!;
    const batch2 = await dao.getEventsAfter(sessionId, lastSeq, 3);

    const batch1Seqs = batch1.map((e) => e.seq);
    const batch2Seqs = batch2.map((e) => e.seq);

    const overlap = batch1Seqs.filter((s) => batch2Seqs.includes(s));
    expect(overlap).toHaveLength(0);

    const allSeqs = [...batch1Seqs, ...batch2Seqs];
    const uniqueSeqs = new Set(allSeqs);
    expect(uniqueSeqs.size).toBe(allSeqs.length);
  });

  it('deduplicates replayed events against lastDeliveredSeq pattern', () => {
    const lastDeliveredSeq = { value: 3 };

    const events: SessionEvent[] = [
      { type: 'assistant.delta', seq: 2, sessionId, messageId: 'msg-1', text: 'old' },
      { type: 'assistant.delta', seq: 3, sessionId, messageId: 'msg-1', text: 'dup' },
      { type: 'assistant.delta', seq: 4, sessionId, messageId: 'msg-1', text: 'new' },
      { type: 'assistant.delta', seq: 5, sessionId, messageId: 'msg-1', text: 'newer' },
    ];

    const delivered: SessionEvent[] = [];
    for (const event of events) {
      if (event.seq !== undefined && event.seq <= lastDeliveredSeq.value) {
        continue;
      }
      if (event.seq !== undefined) {
        lastDeliveredSeq.value = event.seq;
      }
      delivered.push(event);
    }

    expect(delivered).toHaveLength(2);
    expect(delivered[0].seq).toBe(4);
    expect(delivered[1].seq).toBe(5);
  });

  it('getMinSeq returns null for empty session', () => {
    expect(dao.getMinSeq(sessionId)).toBeNull();
  });

  it('getMinSeq returns correct minimum after writes', () => {
    dao.appendEventSync(sessionId, 'assistant.started', {
      sessionId,
      messageId: 'msg-1',
    });
    dao.appendEventSync(sessionId, 'assistant.delta', {
      sessionId,
      messageId: 'msg-1',
      text: 'hello',
    });
    dao.appendEventSync(sessionId, 'assistant.completed', {
      sessionId,
      messageId: 'msg-1',
      terminalReason: 'stop',
    });

    expect(dao.getMinSeq(sessionId)).toBe(1);
  });
});
