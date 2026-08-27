import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type {
  AgentStreamEventV1,
  AgentStreamSnapshotV1,
  AgentStreamState,
} from '@nebula-link-evo/shared/types/agent-stream';
import type { ChatHandler } from '../../../../conversation/chat-handler.js';
import type { ConversationManager } from '../../../../conversation/manager.js';
import type { ConversationJobQueue } from '../../../../services/conversation-job-queue.js';
import type { ChatSessionController } from '../../../../services/chat-session-controller.js';
import { BoundedSseWriter } from '../../../../services/sse-writer.js';
import { buildChatAgentStreamSnapshot } from '../../../../agent-stream/snapshot.js';
import { getRuntimeSessionState } from './runtime-state.js';

function writeSse(
  writer: BoundedSseWriter,
  type: 'agent_stream.snapshot' | 'agent_stream.event',
  seq: number,
  data: AgentStreamSnapshotV1 | AgentStreamEventV1
): void {
  writer.push(`event: ${type}\nid: ${seq}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function buildSnapshot(
  conversationManager: ConversationManager,
  sessionId: string,
  chatHandler: ChatHandler,
  jobQueue?: ConversationJobQueue,
  controller?: ChatSessionController
): Promise<AgentStreamSnapshotV1> {
  const runtime = await getRuntimeSessionState(conversationManager, sessionId, controller);
  const pending = jobQueue?.getPendingJobs(sessionId) ?? [];
  const runtimeState = pending.some((job) => job.status === 'queued')
    ? 'streaming'
    : mapRuntimeState(runtime.status);
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

      const buffered: AgentStreamEventV1[] = [];
      let bootstrapComplete = false;
      let lastSeq = 0;
      let unsubscribe = (): void => {};
      const writer = new BoundedSseWriter(reply.raw, { onClose: () => unsubscribe() });
      unsubscribe = chatHandler.getSessionEventHub().subscribe(sessionId, (event) => {
        try {
          if (!bootstrapComplete) {
            if (buffered.length >= 256) {
              writer.close('overflow', true);
              return;
            }
            buffered.push(event);
            return;
          }
          if (event.seq <= lastSeq) return;
          writeSse(writer, 'agent_stream.event', event.seq, event);
          lastSeq = event.seq;
        } catch {
          // The writer close callback owns subscription cleanup.
        }
      });

      try {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
          Connection: 'keep-alive',
        });
        const snapshot = await buildSnapshot(
          conversationManager,
          sessionId,
          chatHandler,
          jobQueue,
          fastify.chatSessionController
        );
        writeSse(writer, 'agent_stream.snapshot', snapshot.seq, snapshot);
        lastSeq = snapshot.seq;
        bootstrapComplete = true;
        for (const event of buffered) {
          if (event.seq <= lastSeq) continue;
          writeSse(writer, 'agent_stream.event', event.seq, event);
          lastSeq = event.seq;
        }
      } catch (error) {
        unsubscribe();
        throw error;
      }

      const heartbeat = setInterval(() => {
        try {
          writer.push(':heartbeat\n\n');
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);
      const timeout = setTimeout(
        () => {
          clearInterval(heartbeat);
          unsubscribe();
          writer.close('closed', true);
        },
        5 * 60 * 1000
      );

      return new Promise<void>((resolve) => {
        request.raw.on('close', () => {
          clearInterval(heartbeat);
          clearTimeout(timeout);
          unsubscribe();
          writer.close();
          resolve();
        });
      });
    }
  );
};

export default streamRoutes;

function mapRuntimeState(status: string): AgentStreamState {
  switch (status) {
    case 'running':
      return 'streaming';
    case 'paused':
    case 'blocked':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'interrupted':
      return 'recovering';
    default:
      return 'idle';
  }
}
