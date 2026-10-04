import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  SnapshotFirstSseWriter,
  encodeSseJsonFrame,
  mapChatRuntimeStateToAgentStreamState,
} from '@nebula-link-evo/shared';
import type {
  AgentStreamEventV1,
  AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import type { ChatHandler } from '../../conversation/chat-handler.js';
import type { ConversationManager } from '../../conversation/manager.js';
import type { ConversationJobQueue } from '../../services/conversation-job-queue.js';
import type { ChatSessionController } from '../../services/chat-session-controller.js';
import { buildChatAgentStreamSnapshot } from '../../agent-stream/snapshot.js';

const STREAM_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no',
  Connection: 'keep-alive',
} as const;
const MAX_BUFFERED_EVENTS = 256;
const HEARTBEAT_INTERVAL_MS = 15_000;
const STREAM_TIMEOUT_MS = 5 * 60 * 1000;

async function buildSnapshot(
  conversationManager: ConversationManager,
  sessionId: string,
  chatHandler: ChatHandler,
  jobQueue: ConversationJobQueue | undefined,
  controller: ChatSessionController
): Promise<AgentStreamSnapshotV1> {
  const runtime = await controller.getStatus(sessionId);
  const pending = jobQueue?.getPendingJobs(sessionId) ?? [];
  const runtimeState = pending.some((job) => job.status === 'queued')
    ? 'streaming'
    : mapChatRuntimeStateToAgentStreamState(runtime.status);
  const events = await chatHandler.getSessionEventsDAO().getEventsAfter(sessionId, 0);
  return buildChatAgentStreamSnapshot(
    sessionId,
    conversationManager.getMessages(sessionId),
    events,
    runtimeState
  );
}

const streamRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const conversationManager = (
    fastify as typeof fastify & { conversationManager: ConversationManager }
  ).conversationManager;
  const chatHandler = (fastify as typeof fastify & { chatHandler?: ChatHandler }).chatHandler;
  const jobQueue = (fastify as typeof fastify & { jobQueue?: ConversationJobQueue }).jobQueue;

  fastify.get<{ Params: { id: string } }>(
    '/:id/stream',
    {
      schema: {
        description: 'Snapshot-first user-facing Agent activity stream',
        tags: ['Chat', 'SSE'],
        params: Type.Object({ id: Type.String() }),
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;
      if (!conversationManager.getSession(sessionId)) {
        reply.status(404);
        return { success: false, error: 'Session not found' };
      }

      const writer = new SnapshotFirstSseWriter<AgentStreamSnapshotV1, AgentStreamEventV1>({
        target: reply.raw,
        statusCode: 200,
        headers: STREAM_HEADERS,
        getSnapshot: () =>
          buildSnapshot(
            conversationManager,
            sessionId,
            chatHandler,
            jobQueue,
            fastify.chatSessionController
          ),
        getSnapshotSeq: (snapshot) => snapshot.seq,
        getEventSeq: (event) => event.seq,
        encodeSnapshot: (snapshot) =>
          encodeSseJsonFrame({
            event: 'agent_stream.snapshot',
            id: String(snapshot.seq),
            data: snapshot,
          }),
        encodeEvent: (event) =>
          encodeSseJsonFrame({
            event: 'agent_stream.event',
            id: String(event.seq),
            data: event,
          }),
        feed: {
          subscribe: (listener) =>
            chatHandler.getSessionEventHub().subscribe(sessionId, listener),
        },
        maxBufferedEvents: MAX_BUFFERED_EVENTS,
        deduplicate: true,
        heartbeat: {
          intervalMs: HEARTBEAT_INTERVAL_MS,
          createChunk: () => ':heartbeat\n\n',
        },
        timeoutMs: STREAM_TIMEOUT_MS,
      });
      await writer.start();

      return new Promise<void>((resolve) => {
        request.raw.on('close', () => {
          writer.close();
          resolve();
        });
      });
    }
  );
};

export default streamRoutes;
