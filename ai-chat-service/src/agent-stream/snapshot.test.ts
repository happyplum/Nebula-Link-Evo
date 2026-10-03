import { AGENT_STREAM_EVENT_SCHEMA, type AgentStreamEventV1 } from '@nebula-link-evo/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../db/types.js';
import { buildChatAgentStreamSnapshot } from './snapshot.js';

const occurredAt = '2026-08-27T00:00:00.000Z';
const now = '2026-10-03T00:00:00.000Z';
const streamId = 'chat-1';
const turnId = 'chat-1:turn:request-1';
function message(id: string, role: Message['role'], content: string): Message {
  return { id, role, content, session_id: streamId, created_at: occurredAt, metadata: null };
}
const base = {
  schema: AGENT_STREAM_EVENT_SCHEMA,
  streamId,
  turnId,
  sectionId: `${turnId}:content`,
  occurredAt,
};
afterEach(() => vi.useRealTimers());

describe('Chat Agent Stream snapshot', () => {
  it('maps durable user/assistant messages and preserves persisted stream state and current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const messages = [
      message('system-1', 'system', 'system'),
      message('tool-1', 'tool', 'tool'),
      message('user-1', 'user', 'question'),
      message('chat-1:assistant:request-1', 'assistant', 'answer'),
      message('legacy-1', 'assistant', 'historical'),
    ];
    const events: AgentStreamEventV1[] = [
      { ...base, seq: 1, type: 'content.delta', delta: ' continued' },
      { ...base, seq: 1, type: 'content.delta', delta: ' duplicate' },
      { ...base, seq: 3, type: 'stream.state', state: 'completed' },
      { ...base, streamId: 'foreign', seq: 4, type: 'content.delta', delta: ' hidden' },
    ];
    const snapshot = buildChatAgentStreamSnapshot(streamId, messages, events, 'paused');
    expect(snapshot).toMatchObject({ state: 'paused', seq: 3, generatedAt: now });
    expect(snapshot.turns.map((turn) => turn.turnId)).toEqual([
      'user:user-1',
      turnId,
      'assistant:legacy-1',
    ]);
    expect(snapshot.turns[0].sections).toEqual([
      expect.objectContaining({ type: 'user', markdown: 'question' }),
    ]);
    expect(snapshot.turns[1].sections).toEqual([
      expect.objectContaining({ type: 'content', markdown: 'answer continued' }),
    ]);
    expect(messages[3].content).toBe('answer');
  });

  it('replaces a non-content section with the same id before applying deltas', () => {
    const events: AgentStreamEventV1[] = [
      {
        ...base,
        seq: 1,
        type: 'section.upsert',
        section: {
          type: 'notice',
          sectionId: base.sectionId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          tone: 'info',
          title: 'draft',
        },
      },
      { ...base, seq: 2, type: 'content.delta', delta: 'replacement' },
      { ...base, seq: 3, type: 'content.delta', delta: ' text' },
    ];
    const snapshot = buildChatAgentStreamSnapshot(streamId, [], events, 'streaming');
    expect(snapshot.turns[0].sections).toEqual([
      expect.objectContaining({
        type: 'content',
        sectionId: base.sectionId,
        markdown: 'replacement text',
      }),
    ]);
  });

  it('keeps empty persisted state and stamps empty snapshots with current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    expect(buildChatAgentStreamSnapshot(streamId, [], [], 'recovering')).toMatchObject({
      state: 'recovering',
      seq: 0,
      generatedAt: now,
      turns: [],
    });
  });
});
