import {
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  type AgentStreamEventV1,
  type AgentStreamSectionV1,
  type AgentStreamSnapshotV1,
  type AgentStreamTurnV1,
} from '@nebula-link-evo/shared';

export function createEmptyAgentStream(streamId: string): AgentStreamSnapshotV1 {
  return {
    schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
    streamId,
    seq: 0,
    state: 'idle',
    generatedAt: new Date(0).toISOString(),
    turns: [],
  };
}

function replaceSection(
  sections: AgentStreamSectionV1[],
  section: AgentStreamSectionV1
): AgentStreamSectionV1[] {
  const index = sections.findIndex((candidate) => candidate.sectionId === section.sectionId);
  if (index < 0) return [...sections, section];
  const next = [...sections];
  next[index] = section;
  return next;
}

function updateTurn(
  turns: AgentStreamTurnV1[],
  turnId: string,
  updater: (turn: AgentStreamTurnV1) => AgentStreamTurnV1,
  occurredAt: string
): AgentStreamTurnV1[] {
  const index = turns.findIndex((turn) => turn.turnId === turnId);
  if (index < 0) {
    const created: AgentStreamTurnV1 = {
      turnId,
      role: 'assistant',
      state: 'streaming',
      createdAt: occurredAt,
      updatedAt: occurredAt,
      sections: [],
    };
    return [...turns, updater(created)];
  }
  const next = [...turns];
  next[index] = updater(next[index]);
  return next;
}

export function reduceAgentStream(
  snapshot: AgentStreamSnapshotV1,
  event: AgentStreamEventV1
): AgentStreamSnapshotV1 {
  if (event.streamId !== snapshot.streamId || event.seq <= snapshot.seq) return snapshot;

  let turns = snapshot.turns;
  let state = snapshot.state;

  switch (event.type) {
    case 'stream.state':
      state = event.state;
      break;
    case 'turn.upsert': {
      const index = turns.findIndex((turn) => turn.turnId === event.turn.turnId);
      if (index < 0) {
        turns = [...turns, event.turn];
      } else {
        turns = [...turns];
        turns[index] = event.turn;
      }
      break;
    }
    case 'section.upsert':
      turns = updateTurn(
        turns,
        event.turnId,
        (turn) => ({
          ...turn,
          updatedAt: event.occurredAt,
          sections: replaceSection(turn.sections, event.section),
        }),
        event.occurredAt
      );
      break;
    case 'content.delta':
      turns = updateTurn(
        turns,
        event.turnId,
        (turn) => {
          const section = turn.sections.find(
            (candidate) => candidate.sectionId === event.sectionId
          );
          const current = section?.type === 'content' ? section : undefined;
          const nextSection: AgentStreamSectionV1 = {
            type: 'content',
            sectionId: event.sectionId,
            createdAt: current?.createdAt ?? event.occurredAt,
            updatedAt: event.occurredAt,
            markdown: `${current?.markdown ?? ''}${event.delta}`,
            streaming: true,
          };
          return {
            ...turn,
            updatedAt: event.occurredAt,
            sections: replaceSection(turn.sections, nextSection),
          };
        },
        event.occurredAt
      );
      break;
    case 'section.remove':
      turns = updateTurn(
        turns,
        event.turnId,
        (turn) => ({
          ...turn,
          updatedAt: event.occurredAt,
          sections: turn.sections.filter((section) => section.sectionId !== event.sectionId),
        }),
        event.occurredAt
      );
      break;
    case 'turn.completed':
      turns = updateTurn(
        turns,
        event.turnId,
        (turn) => ({ ...turn, state: event.state, updatedAt: event.occurredAt }),
        event.occurredAt
      );
      break;
  }

  return {
    ...snapshot,
    seq: event.seq,
    state,
    generatedAt: event.occurredAt,
    turns,
  };
}

export function replayAgentStream(
  snapshot: AgentStreamSnapshotV1,
  events: readonly AgentStreamEventV1[]
): AgentStreamSnapshotV1 {
  return events.reduce(reduceAgentStream, snapshot);
}
