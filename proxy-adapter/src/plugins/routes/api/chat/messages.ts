/**
 * Message Routes - Legacy message endpoint
 * Relative path: /
 */
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, Static } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import type { ConversationManager } from '../../../../conversation/manager.js';
import { StreamPersistWorker } from '../../../../services/stream-persist-worker.js';
import { ConversationJobQueue } from '../../../../services/conversation-job-queue.js';
import { ServiceUnavailableError } from '../../../../errors/http-errors.js';
import { SessionLock } from '../../../../services/session-lock.js';

// Schemas
const SendMessageRequestSchema = Type.Object({
  sessionId: Type.String(),
  message: Type.String(),
  context: Type.Optional(
    Type.Object({
      maxSteps: Type.Optional(Type.Number()),
    })
  ),
});

type SendMessageRequest = Static<typeof SendMessageRequestSchema>;

const SendMessageResponseSchema = Type.Object({
  jobId: Type.String(),
  status: Type.String(),
  idempotencyKey: Type.Optional(Type.String()),
  message: Type.Optional(
    Type.Object({
      id: Type.String(),
      session_id: Type.String(),
      role: Type.String(),
      content: Type.String(),
      created_at: Type.String(),
      metadata: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
      idempotency_key: Type.Optional(Type.String()),
    })
  ),
});

const QueueFullResponseSchema = Type.Object({
  error: Type.String(),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
});

const messageRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const conversationManager = (fastify as any).conversationManager as ConversationManager;
  const persistWorker = new StreamPersistWorker();
  const jobQueue = new ConversationJobQueue(persistWorker);

  // POST / - Send message (legacy endpoint)
  fastify.post<{ Body: SendMessageRequest }>(
    '/',
    {
      schema: {
        description: 'Send a message to a chat session',
        tags: ['Chat'],
        body: SendMessageRequestSchema,
        response: {
          200: SendMessageResponseSchema,
          429: QueueFullResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          208: SendMessageResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { sessionId, message } = request.body;
      const sessionLock = SessionLock.getInstance();

      try {
        const idempotencyKey = (request.headers['x-idempotency-key'] as string) || randomUUID();

        if (sessionLock.isLocked(sessionId)) {
          reply.status(409);
          return { error: `Session ${sessionId} is currently being processed` };
        }

        const session = conversationManager.getSession(sessionId);
        if (!session) {
          reply.status(404);
          return { error: `Session ${sessionId} not found` };
        }

        const existingMessage = conversationManager.getMessageByIdempotencyKey(idempotencyKey);
        if (existingMessage) {
          reply.status(208);
          return { jobId: '', status: 'completed', message: existingMessage, idempotencyKey };
        }

        conversationManager.addMessage(sessionId, {
          role: 'user',
          content: message,
          idempotencyKey,
        });

        const jobId = await jobQueue.enqueue({
          sessionId,
          execute: async (_context) => {
            await (fastify as any).chatHandler.handleChatSend('http', {
              sessionId,
              message,
              skipAddMessage: true,
            });
          },
        });

        return { jobId, status: 'queued', idempotencyKey };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        request.log.error({ error: errorMessage }, 'Failed to send message');

        if (error instanceof ServiceUnavailableError) {
          reply.status(429);
          return { error: errorMessage };
        }

        if (reply.statusCode < 400) {
          reply.status(500);
        }

        return { error: errorMessage };
      }
    }
  );
};

export default messageRoutes;