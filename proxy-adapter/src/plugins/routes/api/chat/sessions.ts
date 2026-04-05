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
import { MAX_SCREENSHOT_SIZE_BYTES, type MessageCreatedEvent } from '@nebula-link-evo/shared';
import { connectivityGateService } from '../../../../services/connectivity-gate-service.js';
import { TaskService } from '../../../../services/index.js';
import { validateProviderModel } from '../../../../config/validator.js';
import { AgentStateSchema, SessionStatusSchema, getRuntimeSessionState } from './runtime-state.js';

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
  vision_provider: Type.Union([Type.String(), Type.Null()]),
  vision_model: Type.Union([Type.String(), Type.Null()]),
  status: Type.Optional(SessionStatusSchema),
  jobId: Type.Optional(Type.String()),
  agentState: Type.Optional(AgentStateSchema),
});

const SessionListResponseSchema = Type.Array(SessionResponseSchema);

const CreateSessionBodySchema = Type.Object({
  title: Type.Optional(Type.String()),
  provider: Type.String({ minLength: 1 }),
  model: Type.String({ minLength: 1 }),
  vision_provider: Type.Optional(Type.String()),
  vision_model: Type.Optional(Type.String()),
});

const CreateSessionResponseSchema = Type.Object({
  success: Type.Boolean(),
  session: SessionResponseSchema,
});

const MessageResponseSchema = Type.Object({
  id: Type.String(),
  role: Type.String(),
  content: Type.String(),
  thinking: Type.Optional(Type.String()),
  created_at: Type.String(),
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

const UpdateModelsBodySchema = Type.Object({
  decision: Type.Optional(
    Type.Object({
      provider: Type.String({ minLength: 1 }),
      model: Type.String({ minLength: 1 }),
    })
  ),
  vision: Type.Optional(
    Type.Object({
      provider: Type.String({ minLength: 1 }),
      model: Type.String({ minLength: 1 }),
    })
  ),
});

const UpdateModelsResponseSchema = Type.Object({
  session: SessionResponseSchema,
});

const sessionRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const conversationManager = (
    fastify as typeof fastify & { conversationManager: ConversationManager }
  ).conversationManager;
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
        const {
          title = '新会话',
          provider,
          model,
          vision_provider,
          vision_model,
        } = request.body || {};
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

        // Check provider availability after config validation passes
        const registry = TaskService.getInstance().getRegistry();
        if (registry && !registry.isAvailable(provider)) {
          const errorDetail = registry.getAvailabilityError(provider);
          throw new ServiceUnavailableError(
            `Provider '${provider}' is currently unavailable${errorDetail ? `: ${errorDetail}` : ''}`
          );
        }
        if (vision_provider && registry && !registry.isAvailable(vision_provider)) {
          const errorDetail = registry.getAvailabilityError(vision_provider);
          throw new ServiceUnavailableError(
            `Provider '${vision_provider}' is currently unavailable${errorDetail ? `: ${errorDetail}` : ''}`
          );
        }

        const sessionId = randomUUID();

        const session = conversationManager.createSession({
          id: sessionId,
          title,
          provider,
          model,
          vision_provider,
          vision_model,
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
        if (error instanceof ServiceUnavailableError) {
          reply.status(503);
          return { error: error.message };
        }
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

  // PATCH /:id/models - Update session model configuration
  fastify.patch<{ Params: { id: string }; Body: Static<typeof UpdateModelsBodySchema> }>(
    '/:id/models',
    {
      schema: {
        description:
          'Update model configuration for a session. Change takes effect on the next step.',
        tags: ['Chat'],
        params: Type.Object({ id: Type.String() }),
        body: UpdateModelsBodySchema,
        response: {
          200: UpdateModelsResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;
      const { decision, vision } = request.body || {};

      if (!decision && !vision) {
        reply.status(400);
        return { error: 'At least one of "decision" or "vision" must be provided' };
      }

      try {
        const session = conversationManager.getSession(sessionId);
        if (!session) {
          reply.status(404);
          return { error: `Session ${sessionId} not found` };
        }

        const registry = TaskService.getInstance().getRegistry();
        if (!registry) {
          reply.status(500);
          return { error: 'Provider registry unavailable' };
        }

        // Validate providers exist in config
        if (decision && !registry.listProviders().includes(decision.provider)) {
          reply.status(400);
          return { error: `Unknown decision provider: '${decision.provider}'` };
        }
        if (vision && !registry.listProviders().includes(vision.provider)) {
          reply.status(400);
          return { error: `Unknown vision provider: '${vision.provider}'` };
        }

        // Check provider availability (configured but unavailable)
        if (decision && !registry.isAvailable(decision.provider)) {
          const errorDetail = registry.getAvailabilityError(decision.provider);
          reply.status(503);
          return {
            error: `Provider '${decision.provider}' is currently unavailable${errorDetail ? `: ${errorDetail}` : ''}`,
          };
        }
        if (vision && !registry.isAvailable(vision.provider)) {
          const errorDetail = registry.getAvailabilityError(vision.provider);
          reply.status(503);
          return {
            error: `Provider '${vision.provider}' is currently unavailable${errorDetail ? `: ${errorDetail}` : ''}`,
          };
        }

        const updateParams: import('../../../../conversation/types.js').UpdateSessionParams = {};
        if (decision) {
          updateParams.provider = decision.provider;
          updateParams.model = decision.model;
        }
        if (vision) {
          updateParams.vision_provider = vision.provider;
          updateParams.vision_model = vision.model;
        }

        const updated = conversationManager.updateSession(sessionId, updateParams);
        if (!updated) {
          reply.status(404);
          return { error: `Session ${sessionId} not found` };
        }

        return { session: updated };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        request.log.error({ error: errorMessage, sessionId }, 'Failed to update session models');
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

        const db = DatabaseManager.getInstance();
        const sessionEventsDAO = db.getSessionEventsDAO();
        const assistantIds = messages.filter((m) => m.role === 'assistant').map((m) => m.id);
        const thinkingMap =
          sessionEventsDAO.getThinkingForSession(sessionId, assistantIds) ??
          new Map<string, string>();

        return messages.map((m) => {
          const result: {
            id: string;
            role: string;
            content: string;
            created_at: string;
            thinking?: string;
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
        });
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

        if (screenshot) {
          const decodedBytes = Math.ceil((screenshot.length * 3) / 4);
          if (decodedBytes > MAX_SCREENSHOT_SIZE_BYTES) {
            reply.status(400);
            return {
              error: `Screenshot exceeds maximum size of ${MAX_SCREENSHOT_SIZE_BYTES} bytes`,
            };
          }
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
          const createdSeq = await sessionEventsDAO.appendEvent(
            sessionId,
            'message.created',
            eventPayload
          );
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
          const errorMessage =
            innerError instanceof Error ? innerError.message : String(innerError);
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
