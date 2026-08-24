import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { HealthResponseSchema } from '../../schemas/health.js';
import { browserClient } from '../../browser-client.js';
import { AppService } from '../../services/index.js';
const healthRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => {
      const appService = AppService.getInstance();
      const mcpStatus = appService.getMCPStatus();

      // Check in-process browser engine health (migrated from playwright-server HTTP probe)
      let playwright: string;
      try {
        const status = await browserClient.getStatus();
        playwright = status.isOpen ? 'ok' : 'error';
      } catch {
        playwright = 'error';
      }

      return {
        status: 'healthy',
        mcp: mcpStatus,
        services: { playwright },
      };
    }
  );
};
export default healthRoutes;
