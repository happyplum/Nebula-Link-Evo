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

function writeSSEEvent(
  reply: { raw: { write: (chunk: string) => void } },
  event: SessionEvent,
  eventId: string
): void {
  const formatted = eventToSSEFormat(event, eventId);
  reply.raw.write(`event: ${formatted.event}\nid: ${eventId}\ndata: ${formatted.data}\n\n`);
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
  const activeToolCalls = conversationManager.getActiveToolCalls(sessionId);

  const assistantIds = messages.filter((m) => m.role === 'assistant').map((m) => m.id);
  const thinkingMap =
    sessionEventsDAO?.getThinkingForSession(sessionId, assistantIds) ?? new Map<string, string>();

  // Build tool result lookup: tool_call_id → result string
  const toolResultMap = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.metadata?.tool_call_id) {
      toolResultMap.set(m.metadata.tool_call_id as string, m.content);
    }
  }

  return {
    type: 'session.snapshot',
    seq: 0,
    sessionId,
    messages: messages
      .filter((m) => m.role !== 'tool')
      .map((m) => {
        const result: {
          id: string;
          role: string;
          content: string;
          thinking?: string;
          tool_calls?: import('@nebula-link-evo/shared/types/sse-events').ToolCall[];
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

        // Extract tool_calls stored in message metadata for assistant messages,
        // merging tool results from tool-role messages so the snapshot is self-contained.
        if (m.role === 'assistant' && m.metadata?.tool_calls) {
          const calls = m.metadata.tool_calls as import('@nebula-link-evo/shared/types/sse-events').ToolCall[];
          result.tool_calls = calls.map((tc) => {
            const tcId = (tc as Record<string, unknown>).id as string | undefined;
            if (tcId && toolResultMap.has(tcId)) {
              return { ...tc, result: toolResultMap.get(tcId) };
            }
            return tc;
          });
        }

        return result;
      }),
    state: runtimeState.status as SessionState,
    jobId: runtimeState.jobId,
    agentState: runtimeState.agentState,
    ...(activeToolCalls.length > 0 ? { activeToolCalls } : {}),
  };
}

const streamRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const conversationManager = (
    fastify as typeof fastify & { conversationManager: ConversationManager }
  ).conversationManager;
  const chatHandler = (fastify as typeof fastify & { chatHandler?: ChatHandler }).chatHandler;

  // GET /:id/stream - SSE streaming endpoint with full snapshot bootstrap
  fastify.get<{ Params: { id: string } }>(
    '/:id/stream',
    {
      schema: {
        description: 'SSE stream for full snapshot bootstrap and live session events',
        tags: ['Chat', 'SSE'],
        params: Type.Object({
          id: Type.String(),
        }),
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;

      const session = conversationManager.getSession(sessionId);
      if (!session) {
        reply.status(404);
        return { success: false, error: 'Session not found' };
      }

      const sessionEventsDAO =
        typeof chatHandler?.getSessionEventsDAO === 'function'
          ? chatHandler.getSessionEventsDAO() || DatabaseManager.getInstance().getSessionEventsDAO()
          : DatabaseManager.getInstance().getSessionEventsDAO();
      const eventHub =
        typeof chatHandler?.getSessionEventHub === 'function'
          ? chatHandler.getSessionEventHub()
          : SessionEventHub.getInstance();
      const lastDeliveredSeq = { value: 0 };
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

        const snapshotEvent = await buildSnapshotEvent(
          conversationManager,
          sessionId,
          sessionEventsDAO,
          session.status
        );
        writeSSEEvent(reply, snapshotEvent, '0');

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

      const timeout = setTimeout(
        () => {
          clearInterval(heartbeatInterval);
          unsubscribe();
          reply.raw.end();
        },
        5 * 60 * 1000
      );

      // Keep the handler alive until the client disconnects or timeout fires.
      // Without this, Fastify may finalize the raw response when the handler
      // returns, closing the SSE stream before live events can be delivered.
      return new Promise<void>((resolve) => {
        request.raw.on('close', () => {
          clearInterval(heartbeatInterval);
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        });
      });
    }
  );
};

export default streamRoutes;
