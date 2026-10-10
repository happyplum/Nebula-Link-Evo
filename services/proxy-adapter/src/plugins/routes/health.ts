import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { browserClient } from '../../browser-client.js';
import { AppService } from '../../services/index.js';

const MCPServerSchema = Type.Object({
  name: Type.String(),
  running: Type.Boolean(),
  toolsCount: Type.Number(),
});

const HealthResponseSchema = Type.Object({
  status: Type.String(),
  mcp: Type.Object({
    enabled: Type.Boolean(),
    servers: Type.Array(MCPServerSchema),
  }),
  services: Type.Object({
    playwright: Type.String(),
  }),
});

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
