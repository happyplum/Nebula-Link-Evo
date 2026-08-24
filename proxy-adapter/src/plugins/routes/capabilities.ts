import type { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { BrowserExecutionService } from '../../browser-execution/service.js';

export interface CapabilitiesRoutesOptions {
  browserExecutionService: BrowserExecutionService;
}

const CapabilitiesSchema = Type.Object(
  {
    schema: Type.Literal('nebula.service-capabilities/1.0'),
    service: Type.Literal('proxy-adapter'),
    serviceVersion: Type.String(),
    protocols: Type.Record(
      Type.String(),
      Type.Object({ major: Type.Integer(), minor: Type.Integer() })
    ),
    features: Type.Record(
      Type.String(),
      Type.Union([Type.Boolean(), Type.String(), Type.Number()])
    ),
    limits: Type.Record(Type.String(), Type.Number()),
    generatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false }
);

const capabilitiesRoutes: FastifyPluginAsync<CapabilitiesRoutesOptions> = async (
  fastify,
  options
) => {
  fastify.get(
    '/capabilities',
    {
      schema: {
        response: { 200: CapabilitiesSchema },
      },
    },
    async () => options.browserExecutionService.getCapabilities()
  );
};

export default capabilitiesRoutes;
