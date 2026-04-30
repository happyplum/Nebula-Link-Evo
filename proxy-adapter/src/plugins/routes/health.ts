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
      const config = taskService.getConfig();
      const mcpStatus = taskService.getMCPStatus();
      const endpoints = getServiceEndpointsCached();
      return {
        status: 'healthy',
        config: config ? 'loaded' : 'not_loaded',
        mcp: mcpStatus,
        services: {
          playwright: endpoints.playwright.url,
        },
      };
    }
  );
};
export default healthRoutes;
