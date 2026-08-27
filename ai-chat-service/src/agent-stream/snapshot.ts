import {
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  type AgentStreamEventV1,
  type AgentStreamSnapshotV1,
  type AgentStreamState,
  type AgentStreamTurnV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import type { Message } from '../db/types.js';

export function buildChatAgentStreamSnapshot(
  streamId: string,
  messages: readonly Message[],
  events: readonly AgentStreamEventV1[],
  state: AgentStreamState
): AgentStreamSnapshotV1 {
  const turns = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message): AgentStreamTurnV1 => {
      const role = message.role as 'user' | 'assistant';
      const turnId = messageTurnId(streamId, message.id, role);
      const sectionId = role === 'user' ? `user:${message.id}` : `${turnId}:content`;
      return {
        turnId,
        role,
        state: 'completed',
        createdAt: message.created_at,
        updatedAt: message.created_at,
        sections: [
          {
            type: role === 'user' ? 'user' : 'content',
            sectionId,
            createdAt: message.created_at,
            updatedAt: message.created_at,
            markdown: message.content,
            streaming: false,
          },
        ],
      };
    });

  let snapshot: AgentStreamSnapshotV1 = {
    schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
    streamId,
    seq: 0,
    state,
    generatedAt: new Date().toISOString(),
    turns,
  };
  for (const event of events) snapshot = applyEvent(snapshot, event);
  return { ...snapshot, state, generatedAt: new Date().toISOString() };
}

function applyEvent(
  snapshot: AgentStreamSnapshotV1,
  event: AgentStreamEventV1
): AgentStreamSnapshotV1 {
  if (event.streamId !== snapshot.streamId || event.seq <= snapshot.seq) return snapshot;
  const turns = [...snapshot.turns];
  let state = snapshot.state;
  const index = turns.findIndex((turn) => turn.turnId === event.turnId);
  const current =
    index >= 0
      ? turns[index]
      : {
          turnId: event.turnId,
          role: 'assistant' as const,
          state: 'streaming' as const,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          sections: [],
        };

  if (event.type === 'stream.state') {
    state = event.state;
  } else if (event.type === 'turn.upsert') {
    if (index < 0) turns.push(event.turn);
    else turns[index] = event.turn;
  } else {
    let next = current;
    if (event.type === 'section.upsert') {
      const sections = [...current.sections];
      const sectionIndex = sections.findIndex(
        (section) => section.sectionId === event.section.sectionId
      );
      if (sectionIndex < 0) sections.push(event.section);
      else sections[sectionIndex] = event.section;
      next = { ...current, updatedAt: event.occurredAt, sections };
    } else if (event.type === 'content.delta') {
      const sections = [...current.sections];
      const sectionIndex = sections.findIndex(
        (section) => section.sectionId === event.sectionId && section.type === 'content'
      );
      if (sectionIndex < 0) {
        sections.push({
          type: 'content',
          sectionId: event.sectionId,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          markdown: event.delta,
          streaming: true,
        });
      } else {
        const section = sections[sectionIndex];
        if (section?.type === 'content') {
          sections[sectionIndex] = {
            ...section,
            updatedAt: event.occurredAt,
            markdown: `${section.markdown}${event.delta}`,
            streaming: true,
          };
        }
      }
      next = { ...current, updatedAt: event.occurredAt, sections };
    } else if (event.type === 'section.remove') {
      next = {
        ...current,
        updatedAt: event.occurredAt,
        sections: current.sections.filter((section) => section.sectionId !== event.sectionId),
      };
    } else if (event.type === 'turn.completed') {
      next = { ...current, state: event.state, updatedAt: event.occurredAt };
    }
    if (index < 0) turns.push(next);
    else turns[index] = next;
  }
  return {
    ...snapshot,
    seq: event.seq,
    state,
    generatedAt: event.occurredAt,
    turns,
  };
}

function messageTurnId(streamId: string, messageId: string, role: 'user' | 'assistant'): string {
  if (role === 'user') return `user:${messageId}`;
  const prefix = `${streamId}:assistant:`;
  return messageId.startsWith(prefix)
    ? `${streamId}:turn:${messageId.slice(prefix.length)}`
    : `assistant:${messageId}`;
}
