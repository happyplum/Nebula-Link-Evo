import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { HealthResponseSchema } from '../../schemas/health.js';
import { getServiceEndpointsCached } from '../../config/services.js';
import { TaskService } from '../../services/index.js';
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
      const taskService = TaskService.getInstance();
      const wsManager = fastify.wsManager;
      const config = taskService.getConfig();
      const mcpStatus = taskService.getMCPStatus();
      const endpoints = getServiceEndpointsCached();
      const healthInfo = {
        status: 'healthy',
        config: config ? 'loaded' : 'not_loaded',
        mcp: mcpStatus,
        services: {
          playwright: endpoints.playwright.url,
        },
        websocketConnections: wsManager?.getClientCount() ?? 0,
      };
      if (wsManager?.broadcast) {
        wsManager.broadcast({
          type: 'health_update',
          data: healthInfo,
          timestamp: new Date().toISOString(),
        });
      }
      return healthInfo;
    }
  );
};
export default healthRoutes;
