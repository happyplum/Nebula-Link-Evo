import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ConfigResponseSchema } from '../../schemas/config.js';
import { TaskService } from '../../services/index.js';

const configRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        description:
          'Get current configuration including mode, vision/decision providers, and enabled providers',
        tags: ['Config'],
        response: {
          200: ConfigResponseSchema,
        },
      },
    },
    async () => {
      const taskService = TaskService.getInstance();
      const config = taskService.getConfig();
      if (!config) {
        return { error: 'Config not loaded' };
      }
      return {
        mode: config.defaults?.mode ?? 'unknown',
        vision: config.defaults?.vision ?? 'unknown',
        decision: config.defaults?.decision ?? 'unknown',
        providers: Object.keys(config.providers || {}),
      };
    }
  );
};

export default configRoutes;
