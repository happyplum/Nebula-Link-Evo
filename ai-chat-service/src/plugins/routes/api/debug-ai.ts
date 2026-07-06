import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { appService } from '../../../services/index.js';

const debugAiRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post(
    '/test-ai',
    {
      schema: {
        description: 'Test AI provider connectivity',
        tags: ['AI'],
        response: {
          200: {
            type: 'object',
            properties: {
              decision: { type: 'object' },
              visionAgent: { type: 'object' },
              totalResponseTime: { type: 'number' },
            },
          },
        },
      },
    },
    async () => appService.testAIConnectivity(),
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
    async () => ({ keys: appService.getApiKeyStatuses() }),
  );
};

export default debugAiRoutes;
