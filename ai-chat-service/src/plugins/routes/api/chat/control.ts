/**
 * Control Routes - Session control operations
 * Relative paths: /:id/interrupt, /:id/cancel, /:id/pause, /:id/resume, /:id/status, /:id/operations
 */
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { ChatHandler } from '../../../../conversation/chat-handler.js';
import type { ConversationManager } from '../../../../conversation/manager.js';
import { SessionNotFoundError } from '../../../../services/chat-session-controller.js';
import { AgentStateSchema, SessionStatusSchema, getRuntimeSessionState } from './runtime-state.js';

// Schemas
const SessionIdParams = Type.Object({
  id: Type.String(),
});

const SuccessResponse = Type.Object({
  success: Type.Boolean(),
});

const ErrorResponse = Type.Object({
  error: Type.String(),
});

const StatusResponse = Type.Object({
  sessionId: Type.String(),
  status: SessionStatusSchema,
  jobId: Type.Optional(Type.String()),
  agentState: Type.Optional(AgentStateSchema),
  currentJobId: Type.Optional(Type.String()),
  lastActivity: Type.String(),
});

const OperationResponse = Type.Object({
  traceId: Type.String(),
  sessionId: Type.String(),
  operation: Type.Union([
    Type.Literal('create'),
    Type.Literal('interrupt'),
    Type.Literal('cancel'),
    Type.Literal('cleanup'),
    Type.Literal('pause'),
    Type.Literal('resume'),
    Type.Literal('set_current_job'),
    Type.Literal('update_metadata'),
    Type.Literal('set_pause_flags'),
    Type.Literal('mark_as_paused'),
  ]),
  startTime: Type.Integer(),
  endTime: Type.Optional(Type.Integer()),
  status: Type.Union([Type.Literal('pending'), Type.Literal('success'), Type.Literal('failed')]),
  error: Type.Optional(Type.String()),
});

const OperationsResponse = Type.Array(OperationResponse);

const controlRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const controller = fastify.chatSessionController;
  const chatHandler = (fastify as typeof fastify & { chatHandler: ChatHandler }).chatHandler;
  const conversationManager = (
    fastify as typeof fastify & { conversationManager: ConversationManager }
  ).conversationManager;

  // POST /:id/interrupt - Interrupt a running session
  fastify.post<{ Params: typeof SessionIdParams.static }>(
    '/:id/interrupt',
    {
      schema: {
        description: 'Interrupt a running chat session',
        tags: ['Chat', 'Control'],
        params: SessionIdParams,
        response: {
          200: SuccessResponse,
          404: ErrorResponse,
          400: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;

      try {
        await controller.interrupt(sessionId);
        return { success: true };
      } catch (err) {
        const error = err as Error;
        if (error instanceof SessionNotFoundError) {
          reply.status(404);
          return { error: error.message };
        }

        if (error instanceof Error && error.message.includes('Cannot interrupt')) {
          reply.status(400);
          return { error: error.message };
        }

        request.log.error({ error, sessionId }, 'Failed to interrupt session');
        reply.status(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // POST /:id/cancel - Cancel a session
  fastify.post<{ Params: typeof SessionIdParams.static }>(
    '/:id/cancel',
    {
      schema: {
        description: 'Cancel a chat session',
        tags: ['Chat', 'Control'],
        params: SessionIdParams,
        response: {
          200: SuccessResponse,
          404: ErrorResponse,
          400: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;

      try {
        await controller.cancel(sessionId);
        return { success: true };
      } catch (err) {
        const error = err as Error;
        if (error instanceof SessionNotFoundError) {
          reply.status(404);
          return { error: error.message };
        }

        if (error instanceof Error && error.message.includes('Cannot cancel')) {
          reply.status(400);
          return { error: error.message };
        }

        request.log.error({ error, sessionId }, 'Failed to cancel session');
        reply.status(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // POST /:id/pause - Pause a running session
  fastify.post<{ Params: typeof SessionIdParams.static }>(
    '/:id/pause',
    {
      schema: {
        description: 'Pause a running chat session',
        tags: ['Chat', 'Control'],
        params: SessionIdParams,
        response: {
          200: SuccessResponse,
          404: ErrorResponse,
          400: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;

      try {
        await controller.pause(sessionId);
        return { success: true };
      } catch (err) {
        const error = err as Error;
        if (error instanceof SessionNotFoundError) {
          reply.status(404);
          return { error: error.message };
        }

        if (error instanceof Error && error.message.includes('Cannot pause')) {
          reply.status(400);
          return { error: error.message };
        }

        request.log.error({ error, sessionId }, 'Failed to pause session');
        reply.status(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // POST /:id/resume - Resume a paused or blocked session
  fastify.post<{ Params: typeof SessionIdParams.static }>(
    '/:id/resume',
    {
      schema: {
        description: 'Resume a paused or blocked chat session',
        tags: ['Chat', 'Control'],
        params: SessionIdParams,
        response: {
          200: SuccessResponse,
          404: ErrorResponse,
          400: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;

      try {
        // Checkpoint-based recovery: resumes from persisted session state,
        // not mid-token. Client should reconnect SSE stream for fresh snapshot.
        await chatHandler.resumeSession('http', sessionId);
        return { success: true };
      } catch (err) {
        const error = err as Error;
        if (error instanceof SessionNotFoundError) {
          reply.status(404);
          return { error: error.message };
        }

        if (error instanceof Error && error.message.includes('Cannot resume')) {
          reply.status(400);
          return { error: error.message };
        }

        request.log.error({ error, sessionId }, 'Failed to resume session');
        reply.status(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // GET /:id/status - Get session status
  fastify.get<{ Params: typeof SessionIdParams.static }>(
    '/:id/status',
    {
      schema: {
        description: 'Get status of a chat session',
        tags: ['Chat', 'Control'],
        params: SessionIdParams,
        response: {
          200: StatusResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;

      try {
        if (!conversationManager.getSession(sessionId)) {
          throw new SessionNotFoundError(sessionId);
        }
        const runtimeState = await getRuntimeSessionState(
          conversationManager,
          sessionId,
          controller
        );
        return {
          sessionId,
          status: runtimeState.status,
          jobId: runtimeState.jobId,
          agentState: runtimeState.agentState,
          currentJobId: runtimeState.currentJobId,
          lastActivity: runtimeState.lastActivity,
        };
      } catch (err) {
        const error = err as Error;
        if (error instanceof SessionNotFoundError) {
          reply.status(404);
          return { error: error.message };
        }

        request.log.error({ error, sessionId }, 'Failed to get session status');
        reply.status(500);
        return { error: 'Internal server error' };
      }
    }
  );

  // GET /:id/operations - Get operation history
  fastify.get<{ Params: typeof SessionIdParams.static }>(
    '/:id/operations',
    {
      schema: {
        description: 'Get operation history for a chat session',
        tags: ['Chat', 'Control'],
        params: SessionIdParams,
        response: {
          200: OperationsResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id: sessionId } = request.params;

      try {
        const operations = controller.getOperations(sessionId);
        return operations;
      } catch (err) {
        const error = err as Error;
        if (error instanceof SessionNotFoundError) {
          reply.status(404);
          return { error: error.message };
        }

        request.log.error({ error, sessionId }, 'Failed to get session operations');
        reply.status(500);
        return { error: 'Internal server error' };
      }
    }
  );
};

export default controlRoutes;
