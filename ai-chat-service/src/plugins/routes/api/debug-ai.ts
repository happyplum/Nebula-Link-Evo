import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

const DecisionResultSchema = Type.Object({
  status: Type.String(),
  provider: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  responseTime: Type.Number(),
  error: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  intro: Type.Optional(Type.String()),
});

const VisionAgentResultSchema = Type.Object({
  status: Type.String(),
  tools: Type.Array(Type.String()),
  responseTime: Type.Number(),
  error: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const TestAIResponseSchema = Type.Object({
  decision: DecisionResultSchema,
  visionAgent: VisionAgentResultSchema,
  totalResponseTime: Type.Number(),
});

const debugAiRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post(
    '/test-ai',
    {
      schema: {
        description: 'Test AI provider connectivity',
        tags: ['AI'],
        response: {
          200: TestAIResponseSchema,
        },
      },
    },
    async () => fastify.appService.testAIConnectivity(),
  );

  fastify.get(
    '/verify-keys',
    {
      schema: {
        description: 'Verify API key configuration status',
        tags: ['AI'],
        response: {
          200: {
            type: 'object',
            properties: {
              keys: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    provider: { type: 'string' },
                    displayName: { type: 'string' },
                    status: { type: 'string' },
                    keyPreview: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => ({ keys: fastify.appService.getApiKeyStatuses() }),
  );
};

export default debugAiRoutes;
