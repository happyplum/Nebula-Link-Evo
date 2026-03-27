import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { ConversationManager } from '../../../conversation/manager.js';
import type { Message, MessageRole } from '../../../conversation/types.js';

const MessageSchema = Type.Object({
  id: Type.String(),
  session_id: Type.String(),
  role: Type.Union([
    Type.Literal('system'),
    Type.Literal('user'),
    Type.Literal('assistant'),
    Type.Literal('tool'),
  ]),
  content: Type.String(),
  created_at: Type.String(),
  metadata: Type.Union([Type.Record(Type.String(), Type.Any()), Type.Null()]),
  idempotency_key: Type.Optional(Type.String()),
});

const messagesRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const conversationManager = (fastify as any).conversationManager as ConversationManager;

  if (!conversationManager) {
    throw new Error('conversationManager not decorated on fastify instance');
  }

  fastify.get<{ Params: { sessionId: string } }>(
    '/:sessionId',
    {
      schema: {
        description: 'Get paginated messages for a session',
        tags: ['Chat'],
        params: Type.Object({
          sessionId: Type.String(),
        }),
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
        }),
        response: {
          200: Type.Object({
            messages: Type.Array(MessageSchema),
            hasMore: Type.Boolean(),
            total: Type.Number(),
          }),
          400: Type.Object({
            success: Type.Boolean(),
            error: Type.String(),
          }),
          404: Type.Object({
            success: Type.Boolean(),
            error: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params;
      const query = request.query as { limit?: number; offset?: number };

      // Set default values
      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;

      // Validate session exists
      const session = conversationManager.getSession(sessionId);
      if (!session) {
        reply.status(404);
        return { success: false, error: 'Session not found' };
      }

      // Get paginated messages
      const result = conversationManager.getMessagesPaginated(sessionId, limit, offset);

      return {
        messages: result.messages,
        hasMore: result.hasMore,
        total: result.total,
      };
    }
  );
};

export default messagesRoutes;
