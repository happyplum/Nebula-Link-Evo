/**
 * Connectivity Test Route - Test AI provider connectivity
 * Endpoint: POST /connectivity-test
 */
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, Static } from '@sinclair/typebox';
import { testConnectivity } from '../../../../services/connectivity-test.js';
import { connectivityGateService } from '../../../../services/connectivity-gate-service.js';

const ConnectivityTestBodySchema = Type.Object({
  provider: Type.Optional(Type.String()),
  baseUrl: Type.Optional(Type.String()),
  apiKey: Type.Optional(Type.String()),
  modelId: Type.Optional(Type.String()),
});

const ConnectivityTestResponseSchema = Type.Object({
  ok: Type.Boolean(),
  message: Type.String(),
  latencyMs: Type.Number(),
  providerErrorCode: Type.Optional(Type.String()),
});

const connectivityTestRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post<{ Body: Static<typeof ConnectivityTestBodySchema> }>(
    '/connectivity-test',
    {
      schema: {
        description: 'Test connectivity to an AI provider',
        tags: ['Chat'],
        body: ConnectivityTestBodySchema,
        response: {
          200: ConnectivityTestResponseSchema,
        },
      },
    },
    async (request, _reply) => {
      const result = await testConnectivity(request.body);

      // Update gate state based on test result
      connectivityGateService.setConnectivityState({
        ok: result.ok,
        message: result.message,
        latencyMs: result.latencyMs,
      });

      return result;
    }
  );
};

export default connectivityTestRoutes;
