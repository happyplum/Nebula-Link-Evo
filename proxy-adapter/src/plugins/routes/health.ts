import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { HealthResponseSchema } from '../../schemas/health.js';
import { getServiceEndpointsCached } from '../../config/services.js';
import { AppService } from '../../services/index.js';
const healthRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        description: 'Get service health status including config, MCP, and connected services',
        tags: ['Health'],
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => {
      const appService = AppService.getInstance();
      const config = appService.getConfig();
      const mcpStatus = appService.getMCPStatus();
      const endpoints = getServiceEndpointsCached();

      // Probe playwright-server health instead of returning the URL
      let playwright: string;
      try {
        const res = await fetch(`${endpoints.playwright.url}/health`);
        playwright = res.ok ? 'ok' : 'error';
      } catch {
        playwright = 'error';
      }

      return {
        status: 'healthy',
        config: config ? 'loaded' : 'not_loaded',
        mcp: mcpStatus,
        services: { playwright },
      };
    }
  );
};
export default healthRoutes;
