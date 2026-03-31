/**
 * Stream Routes - SSE streaming endpoint
 * Relative path: /:id/stream
 */
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { ChatHandler } from '../../../../conversation/chat-handler.js';
import type { ConversationManager } from '../../../../conversation/manager.js';
import type { SessionEventsDAO } from '../../../../conversation/session-events-dao.js';
import type { SessionStatus } from '../../../../conversation/types.js';
import { DatabaseManager } from '../../../../conversation/db.js';
import { SessionEventHub } from '../../../../services/session-event-hub.js';
import type { SessionEvent, SessionSnapshotEvent, SessionState } from '@nebula-link-evo/shared';
import { eventToSSEFormat } from '@nebula-link-evo/shared';
import { getRuntimeSessionState } from './runtime-state.js';

const REPLAY_FETCH_LIMIT = 10000;

function writeSSEEvent(reply: { raw: { write: (chunk: string) => void } }, event: SessionEvent, eventId: string): void {
  const formatted = eventToSSEFormat(event, eventId);
  reply.raw.write(`event: ${formatted.event}\nid: ${eventId}\ndata: ${formatted.data}\n\n`);
}

function shouldReplayFreshEvents(state: SessionState): boolean {
  return state === 'running' || state === 'blocked';
}

function parseLastEventSeq(lastEventId?: string): { isReconnect: boolean; lastSeq: number } {
  if (lastEventId === undefined) {
    return { isReconnect: false, lastSeq: 0 };
  }

  const parsedSeq = Number.parseInt(lastEventId, 10);
  if (!Number.isFinite(parsedSeq) || parsedSeq < 0) {
    return { isReconnect: false, lastSeq: 0 };
  }

  return { isReconnect: true, lastSeq: parsedSeq };
}

function writeBootstrapEvent(
  reply: { raw: { write: (chunk: string) => void } },
  event: SessionEvent,
  lastDeliveredSeq: { value: number }
): void {
  if (event.seq !== undefined) {
    if (event.seq <= lastDeliveredSeq.value) {
      return;
    }
    lastDeliveredSeq.value = event.seq;
  }

  const eventId = event.seq !== undefined ? String(event.seq) : '';
  writeSSEEvent(reply, event, eventId);
}

async function buildSnapshotEvent(
  conversationManager: ConversationManager,
  sessionId: string,
  sessionEventsDAO: SessionEventsDAO | null,
  baseStatus?: SessionStatus
): Promise<SessionSnapshotEvent> {
  const messages = conversationManager.getMessages(sessionId);
  const runtimeState = await getRuntimeSessionState(conversationManager, sessionId, baseStatus);

  const assistantIds = messages.filter((m) => m.role === 'assistant').map((m) => m.id);
  const thinkingMap = sessionEventsDAO?.getThinkingForSession(sessionId, assistantIds) ?? new Map<string, string>();

  return {
    type: 'session.snapshot',
    seq: 0,
    sessionId,
    messages: messages.map((m) => {
      const result: {
        id: string;
        role: string;
        content: string;
        thinking?: string;
        created_at: string;
      } = {
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
      };

      const thinking = thinkingMap.get(m.id);
      if (thinking) {
        result.thinking = thinking;
      }

      return result;
    }),
    state: runtimeState.status as SessionState,
    jobId: runtimeState.jobId,
    agentState: runtimeState.agentState,
  };
}

const streamRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const conversationManager = (fastify as typeof fastify & { conversationManager: ConversationManager })
    .conversationManager;
  const chatHandler = (fastify as typeof fastify & { chatHandler?: ChatHandler }).chatHandler;

  // GET /:id/stream - SSE streaming endpoint with replay support
  fastify.get<{ Params: { id: string } }>(
    '/:id/stream',
    {
      schema: {
        description: 'SSE stream for session events with replay support',
        tags: ['Chat', 'SSE'],
        params: Type.Object({
          id: Type.String(),
        }),
        querystring: Type.Object({
          lastEventId: Type.Optional(Type.String()),
        }),
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;
      const query = request.query as { lastEventId?: string };

      const session = conversationManager.getSession(sessionId);
      if (!session) {
        reply.status(404);
        return { success: false, error: 'Session not found' };
      }

      const lastEventIdHeader = request.headers['last-event-id'];
      const lastEventId = query.lastEventId ?? (lastEventIdHeader as string | undefined);
      const { isReconnect, lastSeq } = parseLastEventSeq(lastEventId);

      const sessionEventsDAO =
        typeof chatHandler?.getSessionEventsDAO === 'function'
          ? chatHandler.getSessionEventsDAO() || DatabaseManager.getInstance().getSessionEventsDAO()
          : DatabaseManager.getInstance().getSessionEventsDAO();
      const eventHub =
        typeof chatHandler?.getSessionEventHub === 'function'
          ? chatHandler.getSessionEventHub()
          : SessionEventHub.getInstance();
      const lastDeliveredSeq = { value: isReconnect ? lastSeq : 0 };
      const bufferedEvents: SessionEvent[] = [];
      let bootstrapComplete = false;

      const unsubscribe = eventHub.subscribe(sessionId, (event: SessionEvent) => {
        try {
          if (!bootstrapComplete) {
            bufferedEvents.push(event);
            return;
          }

          writeBootstrapEvent(reply, event, lastDeliveredSeq);
        } catch {
          // Ignore write errors (client disconnected)
        }
      });

      try {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
          Connection: 'keep-alive',
        });

        if (!isReconnect) {
          const snapshotEvent = await buildSnapshotEvent(
            conversationManager,
            sessionId,
            sessionEventsDAO,
            session.status
          );
          writeSSEEvent(reply, snapshotEvent, '0');

          if (shouldReplayFreshEvents(snapshotEvent.state)) {
            const events = await sessionEventsDAO.getEventsAfter(sessionId, 0, REPLAY_FETCH_LIMIT);
            for (const event of events) {
              // Skip incremental events already materialized into the snapshot
              if (event.type === 'assistant.thinking') continue;
              writeBootstrapEvent(reply, event, lastDeliveredSeq);
            }
          }
        } else {
          const minSeq = sessionEventsDAO.getMinSeq(sessionId);
          const hasGap =
            (minSeq !== null && lastSeq < minSeq - 1) ||
            (minSeq === null && lastSeq > 0);

          if (hasGap) {
            const snapshotEvent = await buildSnapshotEvent(
              conversationManager,
              sessionId,
              sessionEventsDAO,
              session.status
            );
            writeSSEEvent(reply, snapshotEvent, '');
            lastDeliveredSeq.value = minSeq !== null ? minSeq - 1 : 0;
          }

          const replayFrom = hasGap && minSeq !== null ? minSeq - 1 : lastSeq;
          const events = await sessionEventsDAO.getEventsAfter(sessionId, replayFrom, REPLAY_FETCH_LIMIT);
          for (const event of events) {
            // Skip incremental events already materialized into the snapshot
            if (hasGap && event.type === 'assistant.thinking') continue;
            writeBootstrapEvent(reply, event, lastDeliveredSeq);
          }
        }

        bootstrapComplete = true;
        for (const event of bufferedEvents) {
          writeBootstrapEvent(reply, event, lastDeliveredSeq);
        }
      } catch (error) {
        unsubscribe();
        throw error;
      }

      const heartbeatInterval = setInterval(() => {
        try {
          reply.raw.write(':heartbeat\n\n');
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15000);

      const timeout = setTimeout(() => {
        clearInterval(heartbeatInterval);
        unsubscribe();
        reply.raw.end();
      }, 5 * 60 * 1000);

      request.raw.on('close', () => {
        clearInterval(heartbeatInterval);
        clearTimeout(timeout);
        unsubscribe();
      });
    }
  );
};

export default streamRoutes;
