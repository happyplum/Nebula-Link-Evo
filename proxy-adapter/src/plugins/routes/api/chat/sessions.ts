/**
 * Session Routes - Session CRUD operations
 * Relative paths: /, /:id, /:id/messages
 */
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, Static } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import type { ChatHandler } from '../../../../conversation/chat-handler.js';
import type { ConversationManager } from '../../../../conversation/manager.js';
import { ConversationJobQueue } from '../../../../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../../../../services/stream-persist-worker.js';
import { SessionLock } from '../../../../services/session-lock.js';
import { SessionEventHub } from '../../../../services/session-event-hub.js';
import { DatabaseManager } from '../../../../conversation/db.js';
import { ServiceUnavailableError } from '../../../../errors/http-errors.js';
import type { MessageCreatedEvent } from '@nebula-link-evo/shared';
import { connectivityGateService } from '../../../../services/connectivity-gate-service.js';
import { TaskService } from '../../../../services/index.js';
import { validateProviderModel } from '../../../../config/validator.js';
import {
  AgentStateSchema,
  SessionStatusSchema,
  getRuntimeSessionState,
} from './runtime-state.js';

// Schemas
const SessionResponseSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  created_at: Type.String(),
  updated_at: Type.String(),
  summary: Type.Union([Type.String(), Type.Null()]),
  message_count: Type.Number(),
  provider: Type.String(),
  model: Type.String(),
  status: Type.Optional(SessionStatusSchema),
  jobId: Type.Optional(Type.String()),
  agentState: Type.Optional(AgentStateSchema),
});

const SessionListResponseSchema = Type.Array(SessionResponseSchema);

const CreateSessionBodySchema = Type.Object({
  title: Type.Optional(Type.String()),
  provider: Type.String({ minLength: 1 }),
  model: Type.String({ minLength: 1 }),
});

const CreateSessionResponseSchema = Type.Object({
  success: Type.Boolean(),
  session: SessionResponseSchema,
});

const MessageResponseSchema = Type.Object({
  id: Type.String(),
  session_id: Type.String(),
  role: Type.String(),
  content: Type.String(),
  created_at: Type.String(),
  metadata: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
});

const MessageListResponseSchema = Type.Array(MessageResponseSchema);

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
});

const AsyncMessageResponseSchema = Type.Object({
  jobId: Type.String(),
  runId: Type.String(),
  sessionId: Type.String(),
  messageId: Type.String(),
});

const sessionRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const conversationManager = (fastify as typeof fastify & { conversationManager: ConversationManager })
    .conversationManager;
  const chatHandler = (fastify as typeof fastify & { chatHandler: ChatHandler }).chatHandler;
  const persistWorker = new StreamPersistWorker();
  const jobQueue = new ConversationJobQueue(persistWorker);

  // POST / - Create a new session
  fastify.post<{ Body: Static<typeof CreateSessionBodySchema> }>(
    '/',
    {
      schema: {
        description: 'Create a new chat session',
        tags: ['Chat'],
        body: CreateSessionBodySchema,
        response: {
          201: CreateSessionResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      schemaErrorFormatter: (errors, dataVar) => {
        const errorMessages = errors.map((err) => {
          if (err.keyword === 'required') {
            return `Property '${err.params.missingProperty}' is required`;
          }
          if (err.keyword === 'minLength') {
            const path = err.instancePath.substring(1) || err.params?.missingProperty || 'field';
            return `Property '${path}' must not be empty`;
          }
          return err.message || `Validation error in ${dataVar}`;
        });
        return new Error(errorMessages.join('; '));
      },
    },
    async (request, reply) => {
      try {
        const { title = '新会话', provider, model } = request.body || {};
        const config = TaskService.getInstance().getConfig();
        if (config === null) {
          reply.status(500);
          return { error: 'Server configuration unavailable' };
        }
        const result = validateProviderModel(config, provider, model);
        if (!result.valid) {
          reply.status(400);
          return { error: result.errors.join('; ') };
        }

        const sessionId = randomUUID();

        const session = conversationManager.createSession({
          id: sessionId,
          title,
          provider,
          model,
        });

        await conversationManager.createSessionState({
          sessionId: session.id,
          status: 'idle',
        });

        reply.status(201);
        return {
          success: true,
          session: {
            ...session,
            status: 'idle',
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        request.log.error({ error: errorMessage }, 'Failed to create session');
        reply.status(500);
        return { error: errorMessage };
      }
    }
  );

  // GET / - List sessions
  fastify.get<{ Querystring: { limit?: number; offset?: number } }>(
    '/',
    {
      schema: {
        description: 'Get list of all chat sessions',
        tags: ['Chat'],
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
        }),
        response: {
          200: SessionListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const limit = request.query.limit ? parseInt(String(request.query.limit), 10) : undefined;
      const offset = request.query.offset ? parseInt(String(request.query.offset), 10) : undefined;

      try {
        const sessions = conversationManager.listSessions({ limit, offset });
        const enrichedSessions = await Promise.all(
          sessions.map(async (session) => {
            const runtimeState = await getRuntimeSessionState(
              conversationManager,
              session.id,
              session.status
            );
            return {
              ...session,
              status: runtimeState.status,
              jobId: runtimeState.jobId,
              agentState: runtimeState.agentState,
            };
          })
        );
        return enrichedSessions;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        request.log.error({ error: errorMessage }, 'Failed to get sessions');
        reply.status(500);
        return { error: errorMessage };
      }
    }
  );

  // GET /:id - Get session details
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Get details of a specific chat session',
        tags: ['Chat'],
        params: Type.Object({
          id: Type.String(),
        }),
        response: {
          200: SessionResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;

      try {
        const session = conversationManager.getSession(sessionId);

        if (!session) {
          reply.status(404);
          return { error: `Session ${sessionId} not found` };
        }

        const runtimeState = await getRuntimeSessionState(
          conversationManager,
          sessionId,
          session.status
        );

        return {
          ...session,
          status: runtimeState.status,
          jobId: runtimeState.jobId,
          agentState: runtimeState.agentState,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        request.log.error({ error: errorMessage, sessionId }, 'Failed to get session');
        reply.status(500);
        return { error: errorMessage };
      }
    }
  );

  // DELETE /:id - Delete a session
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        description: 'Delete a specific chat session',
        tags: ['Chat'],
        params: Type.Object({
          id: Type.String(),
        }),
        response: {
          200: Type.Object({ success: Type.Boolean() }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;

      try {
        const session = conversationManager.getSession(sessionId);

        if (!session) {
          reply.status(404);
          return { error: `Session ${sessionId} not found` };
        }

        conversationManager.deleteSession(sessionId);
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        request.log.error({ error: errorMessage, sessionId }, 'Failed to delete session');
        reply.status(500);
        return { error: errorMessage };
      }
    }
  );

  // GET /:id/messages - Get message history
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: number; offset?: number };
  }>(
    '/:id/messages',
    {
      schema: {
        description: 'Get message history for a specific session',
        tags: ['Chat'],
        params: Type.Object({
          id: Type.String(),
        }),
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
        }),
        response: {
          200: MessageListResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;
      const { limit, offset } = request.query;

      try {
        const session = conversationManager.getSession(sessionId);

        if (!session) {
          reply.status(404);
          return { error: `Session ${sessionId} not found` };
        }

        const messages = conversationManager.getMessages(sessionId, { limit, offset });
        return messages;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        request.log.error({ error: errorMessage, sessionId }, 'Failed to get messages');
        reply.status(500);
        return { error: errorMessage };
      }
    }
  );

  // POST /:id/messages - Async message endpoint
  fastify.post<{
    Params: { id: string };
    Body: { content: string; screenshot?: string };
  }>(
    '/:id/messages',
    {
      schema: {
        description: 'Send message and queue for async processing',
        tags: ['Chat'],
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({
          content: Type.String(),
          screenshot: Type.Optional(Type.String()),
        }),
        response: {
          202: AsyncMessageResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;
      const { content, screenshot } = request.body;
      const sessionLock = SessionLock.getInstance();
      const db = DatabaseManager.getInstance();
      const sessionEventsDAO = db.getSessionEventsDAO();
      const sessionEventHub =
        typeof chatHandler.getSessionEventHub === 'function'
          ? chatHandler.getSessionEventHub()
          : SessionEventHub.getInstance();
      const runId = randomUUID();

      try {
        if (!content || content.trim() === '') {
          reply.status(400);
          return { error: 'Message content is required' };
        }

        // Fail-close gate: Check connectivity before allowing new messages
        if (connectivityGateService.isConnectivityFailed()) {
          reply.status(503);
          return { error: 'Connectivity test required' };
        }

        const session = conversationManager.getSession(sessionId);
        if (!session) {
          reply.status(404);
          return { error: `Session ${sessionId} not found` };
        }

        const acquired = sessionLock.acquire(sessionId, runId);
        if (!acquired) {
          reply.status(409);
          return { error: `Session ${sessionId} is currently being processed` };
        }

        let messageId: string;
        let jobId: string;

        try {
          const message = conversationManager.addMessage(sessionId, {
            role: 'user',
            content: content.trim(),
          });
          messageId = message.id;

          const eventPayload: Omit<MessageCreatedEvent, 'type'> = {
            sessionId,
            messageId,
            content: content.trim(),
          };
          const createdSeq = await sessionEventsDAO.appendEvent(sessionId, 'message.created', eventPayload);
          sessionEventHub.publish(sessionId, {
            type: 'message.created',
            seq: createdSeq,
            ...eventPayload,
          });

          jobId = await jobQueue.enqueue({
            sessionId,
            execute: async (_context) => {
              try {
                await chatHandler.handleChatSend('http', {
                  sessionId,
                  message: content.trim(),
                  skipAddMessage: true,
                  screenshot,
                });
              } finally {
                sessionLock.release(sessionId, runId);
              }
            },
          });
        } catch (innerError) {
          sessionLock.release(sessionId, runId);
          const errorMessage = innerError instanceof Error ? innerError.message : String(innerError);
          const errorPayload = {
            sessionId,
            error: errorMessage,
          };
          const errorSeq = await sessionEventsDAO.appendEvent(sessionId, 'run.error', errorPayload);
          sessionEventHub.publish(sessionId, {
            type: 'run.error',
            seq: errorSeq,
            ...errorPayload,
          });
          throw innerError;
        }

        reply.status(202);
        return { jobId, runId, sessionId, messageId };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        request.log.error({ error: errorMessage, sessionId }, 'Failed to send message');

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

export default sessionRoutes;
