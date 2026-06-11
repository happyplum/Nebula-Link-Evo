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
import { SessionEventHub } from '../../../../services/session-event-hub.js';
import { DatabaseManager } from '../../../../conversation/db.js';
import { ServiceUnavailableError } from '../../../../errors/http-errors.js';
import { MAX_SCREENSHOT_SIZE_BYTES, type MessageCreatedEvent } from '@nebula-link-evo/shared';
import { connectivityGateService } from '../../../../services/connectivity-gate-service.js';
import { AppService } from '../../../../services/index.js';
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
      provider: Type.Optional(Type.String({ minLength: 1 })),
      model: Type.Optional(Type.String({ minLength: 1 })),
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
  const jobQueue = (fastify as typeof fastify & { jobQueue: ConversationJobQueue }).jobQueue;

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
        const config = AppService.getInstance().getConfig();
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
        const registry = AppService.getInstance().getRegistry();
        if (registry && !registry.isAvailable(provider)) {
          const errorDetail = registry.getAvailabilityError(provider);
          throw new ServiceUnavailableError(
            `Provider '${provider}' is currently unavailable${errorDetail ? `: ${errorDetail}` : ''}`
          );
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
      const body = request.body || {};
      const { decision } = body;

      if ('vision' in body) {
        reply.status(400);
        return {
          error: 'vision model override has been removed; vision is configured via defaults.vision in config',
        };
      }

      if (!decision) {
        reply.status(400);
        return { error: 'At least one of decision must be provided' };
      }

      try {
        const session = conversationManager.getSession(sessionId);
        if (!session) {
          reply.status(404);
          return { error: `Session ${sessionId} not found` };
        }

        const registry = AppService.getInstance().getRegistry();
        if (!registry) {
          reply.status(500);
          return { error: 'Provider registry unavailable' };
        }

        // Validate decision provider
        const decisionProvider = decision?.provider;
        if (decisionProvider && !registry.listProviders().includes(decisionProvider)) {
          reply.status(400);
          return { error: `Unknown decision provider: '${decisionProvider}'` };
        }

        // Check decision provider availability
        if (decisionProvider && !registry.isAvailable(decisionProvider)) {
          const errorDetail = registry.getAvailabilityError(decisionProvider);
          reply.status(503);
          return {
            error: `Decision provider '${decisionProvider}' is currently unavailable${errorDetail ? `: ${errorDetail}` : ''}`,
          };
        }

        const updateParams: import('../../../../conversation/types.js').UpdateSessionParams = {};
        if (decision?.provider) updateParams.provider = decision.provider;
        if (decision?.model) updateParams.model = decision.model;

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

  // DELETE /:sessionId/jobs/:jobId - Cancel a queued job
  fastify.delete<{ Params: { sessionId: string; jobId: string } }>(
    '/:sessionId/jobs/:jobId',
    {
      schema: {
        description: 'Cancel a queued job',
        tags: ['Chat'],
        params: Type.Object({
          sessionId: Type.String(),
          jobId: Type.String(),
        }),
        response: {
          200: Type.Object({ success: Type.Boolean(), jobId: Type.String() }),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { sessionId, jobId } = request.params;
      const job = jobQueue.getStatus(jobId);

      if (!job || job.sessionId !== sessionId) {
        reply.status(404);
        return { error: `Job ${jobId} not found for session ${sessionId}` };
      }

      if (job.status === 'running') {
        reply.status(409);
        return { error: `Job ${jobId} is already running and cannot be cancelled` };
      }

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        reply.status(404);
        return { error: `Job ${jobId} is no longer queued` };
      }

      jobQueue.cancelJob(jobId);
      return { success: true, jobId };
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
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;
      const { content, screenshot } = request.body;
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

        let messageId: string;
        let jobId: string;

        try {
          const message = conversationManager.addMessage(sessionId, {
            role: 'user',
            content: content.trim(),
            metadata: { provider: session.provider, model: session.model },
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
            messageId,
            contentPreview: content.trim().substring(0, 100),
            execute: async (_context) => {
              await chatHandler.handleChatSend('http', {
                sessionId,
                message: content.trim(),
                skipAddMessage: true,
                screenshot,
              });
            },
          });
        } catch (innerError) {
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
          reply.status(error.statusCode);
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
