import {
  createEmptyAgentStream,
  replayAgentStream,
  type AgentStreamEventV1,
  type AgentStreamSnapshotV1,
  type AgentStreamState,
  type AgentStreamTurnV1,
} from '@nebula-link-evo/shared';
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

  const snapshot = replayAgentStream({ ...createEmptyAgentStream(streamId), turns }, events);
  return { ...snapshot, state, generatedAt: new Date().toISOString() };
}

function messageTurnId(streamId: string, messageId: string, role: 'user' | 'assistant'): string {
  if (role === 'user') return `user:${messageId}`;
  const prefix = `${streamId}:assistant:`;
  return messageId.startsWith(prefix)
    ? `${streamId}:turn:${messageId.slice(prefix.length)}`
    : `assistant:${messageId}`;
}
