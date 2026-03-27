import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { BrowserService } from '../../services/browser-service.js';
import { HealthResponseSchema } from '../../schemas/health.js';

const routes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        description: 'Get service health status',
        tags: ['Health'],
        summary: 'Health check',
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => {
      return { status: 'healthy', browserOpen: BrowserService.getInstance().isOpen() };
    }
  );
};

export default routes;
