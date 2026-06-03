import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ConfigResponseSchema } from '../../schemas/config.js';
import { AppService } from '../../services/index.js';

const configRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        description:
          'Get current configuration including mode, decision provider, and enabled providers',
        tags: ['Config'],
        response: {
          200: ConfigResponseSchema,
        },
      },
    },
    async () => {
      const appService = AppService.getInstance();
      const config = appService.getConfig();
      if (!config) {
        return { error: 'Config not loaded' };
      }
      return {
        mode: config.defaults?.mode ?? 'unknown',
        decision: config.defaults?.decision ?? 'unknown',
        providers: Object.keys(config.providers || {}).filter(k => config.providers[k].enabled),
      };
    }
  );
};

export default configRoutes;
