import {
  AGENT_STREAM_EVENT_SCHEMA,
  type AgentStreamEventV1,
  type AgentStreamSectionV1,
} from '@nebula-link-evo/shared';
import { describe, expect, it } from 'vitest';
import { createEmptyAgentStream, reduceAgentStream, replayAgentStream } from './reducer.js';

const occurredAt = '2026-08-27T00:00:00.000Z';

function event(
  seq: number,
  payload: Omit<
    AgentStreamEventV1,
    'schema' | 'streamId' | 'turnId' | 'sectionId' | 'seq' | 'occurredAt'
  > &
    Partial<Pick<AgentStreamEventV1, 'turnId' | 'sectionId'>>
): AgentStreamEventV1 {
  return {
    schema: AGENT_STREAM_EVENT_SCHEMA,
    streamId: 'stream-1',
    turnId: payload.turnId ?? 'turn-1',
    sectionId: payload.sectionId ?? 'content-1',
    seq,
    occurredAt,
    ...payload,
  } as AgentStreamEventV1;
}

describe('Agent Stream reducer', () => {
  it('deterministically replays every event prefix', () => {
    const events = [
      event(1, { type: 'stream.state', state: 'streaming' }),
      event(2, { type: 'content.delta', delta: '你' }),
      event(3, { type: 'content.delta', delta: '好' }),
      event(4, { type: 'turn.completed', state: 'completed' }),
      event(5, { type: 'stream.state', state: 'completed' }),
    ];

    for (let length = 0; length <= events.length; length += 1) {
      const prefix = events.slice(0, length);
      const replayed = replayAgentStream(createEmptyAgentStream('stream-1'), prefix);
      const reduced = prefix.reduce(reduceAgentStream, createEmptyAgentStream('stream-1'));
      expect(replayed).toEqual(reduced);
    }
  });

  it('deduplicates sequence numbers and updates stable sections in place', () => {
    const first: AgentStreamSectionV1 = {
      type: 'activity',
      sectionId: 'tool-1',
      createdAt: occurredAt,
      updatedAt: occurredAt,
      kind: 'tool',
      state: 'running',
      title: '读取页面',
    };
    const completed = { ...first, state: 'completed' as const };
    const base = createEmptyAgentStream('stream-1');
    const running = reduceAgentStream(
      base,
      event(1, { type: 'section.upsert', sectionId: first.sectionId, section: first })
    );
    const duplicate = reduceAgentStream(
      running,
      event(1, { type: 'section.upsert', sectionId: first.sectionId, section: completed })
    );
    const final = reduceAgentStream(
      duplicate,
      event(2, { type: 'section.upsert', sectionId: first.sectionId, section: completed })
    );

    expect(duplicate).toBe(running);
    expect(final.turns[0].sections).toEqual([completed]);
  });

  it('ignores events from another stream', () => {
    const base = createEmptyAgentStream('stream-1');
    const foreign = {
      ...event(1, { type: 'content.delta', delta: 'hidden' }),
      streamId: 'stream-2',
    };
    expect(reduceAgentStream(base, foreign)).toBe(base);
  });

  it('upserts and replaces turns, removes sections and applies terminal state', () => {
    const base = createEmptyAgentStream('stream-1');
    const original = {
      turnId: 'turn-1',
      role: 'assistant' as const,
      state: 'streaming' as const,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      sections: [
        {
          type: 'content' as const,
          sectionId: 'content-1',
          createdAt: occurredAt,
          updatedAt: occurredAt,
          markdown: 'draft',
        },
      ],
    };
    const inserted = reduceAgentStream(base, event(1, { type: 'turn.upsert', turn: original }));
    const replacement = { ...original, state: 'completed' as const, sections: [] };
    const replaced = reduceAgentStream(
      inserted,
      event(2, { type: 'turn.upsert', turn: replacement })
    );
    const withSection = reduceAgentStream(
      replaced,
      event(3, { type: 'section.upsert', section: original.sections[0] })
    );
    const removed = reduceAgentStream(withSection, event(4, { type: 'section.remove' }));
    const terminal = reduceAgentStream(
      removed,
      event(5, { type: 'turn.completed', state: 'failed' })
    );

    expect(replaced.turns).toEqual([replacement]);
    expect(removed.turns[0].sections).toEqual([]);
    expect(terminal.turns[0].state).toBe('failed');
  });

  it('updates stream state without creating a turn', () => {
    const updated = reduceAgentStream(
      createEmptyAgentStream('stream-1'),
      event(1, { type: 'stream.state', state: 'recovering' })
    );
    expect(updated).toMatchObject({ state: 'recovering', turns: [] });
  });
});
