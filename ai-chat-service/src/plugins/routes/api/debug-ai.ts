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

const PublicConfigResponseSchema = Type.Object({
  mode: Type.Literal('unified'),
  decision: Type.Object({
    provider: Type.String(),
    model: Type.String(),
  }),
  vision: Type.Optional(
    Type.Object({
      provider: Type.String(),
      model: Type.String(),
    })
  ),
  providers: Type.Array(Type.String()),
});

const debugAiRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/config',
    {
      schema: {
        description: 'Get the public AI runtime configuration without secrets',
        tags: ['AI'],
        response: { 200: PublicConfigResponseSchema },
      },
    },
    async () => {
      const config = fastify.appService.getConfig();
      if (!config) {
        throw new Error('AI runtime configuration is unavailable');
      }
      return {
        mode: config.defaults.mode,
        decision: config.defaults.decision,
        ...(config.defaults.vision ? { vision: config.defaults.vision } : {}),
        providers: Object.entries(config.providers)
          .filter(([, provider]) => provider.enabled)
          .map(([provider]) => provider),
      };
    }
  );

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
    async () => fastify.appService.testAIConnectivity()
  );
};

export default debugAiRoutes;
