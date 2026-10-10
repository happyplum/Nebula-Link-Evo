import { GitMetadataSchema, BusinessVersionSchema, AssetSummarySchema, BusinessVersionDetailSchema } from '../../contracts/business-version.js';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';
import type { BusinessVersionService } from '../../services/business-version-service.js';
import { ServiceError } from '../../services/service-error.js';
import type { ApiSuccess } from '../../contracts/semantic-control.js';
import { ApiProblemSchema, apiSuccessSchema } from '../../contracts/semantic-api.js';
import fp from '../plugins/fastify-plugin.js';

const StableKeySchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-z0-9][a-z0-9._-]{0,127}$',
});

const CreateBusinessVersionBodySchema = Type.Object(
  {
    versionKey: StableKeySchema,
    name: Type.String({ minLength: 1, maxLength: 500 }),
    createdBy: Type.String({ minLength: 1, maxLength: 500 }),
    sourceVersionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    git: Type.Optional(GitMetadataSchema),
    deploymentRevisionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false }
);

const CopyBusinessVersionBodySchema = Type.Omit(CreateBusinessVersionBodySchema, [
  'sourceVersionId',
]);
const ProjectParamsSchema = Type.Object(
  { projectId: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false }
);
const VersionParamsSchema = Type.Object(
  { versionId: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false }
);
const IdempotencyHeaderSchema = Type.Object(
  { 'idempotency-key': Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: true }
);
const VersionListSchema = Type.Object(
  { versions: Type.Array(BusinessVersionSchema) },
  { additionalProperties: false }
);
const CopyResponseSchema = Type.Object(
  {
    version: BusinessVersionDetailSchema,
    created: Type.Boolean(),
    counts: AssetSummarySchema,
    staleAssetIds: Type.Array(Type.String()),
  },
  { additionalProperties: false }
);
const BusinessVersionSuccessSchema = apiSuccessSchema(BusinessVersionSchema);
const BusinessVersionDetailSuccessSchema = apiSuccessSchema(BusinessVersionDetailSchema);
const VersionListSuccessSchema = apiSuccessSchema(VersionListSchema);
const CopySuccessSchema = apiSuccessSchema(CopyResponseSchema);

type CreateBody = Static<typeof CreateBusinessVersionBodySchema>;
type CopyBody = Static<typeof CopyBusinessVersionBodySchema>;

export interface BusinessVersionRoutesOptions {
  service?: BusinessVersionService;
}

const businessVersionRoutes: FastifyPluginAsyncTypebox<BusinessVersionRoutesOptions> = async (
  fastify,
  options
) => {
  const requireService = (): BusinessVersionService => {
    if (!options.service) {
      throw ServiceError.unavailable('Semantic business version service is not configured');
    }
    return options.service;
  };

  fastify.post<{
    Params: Static<typeof ProjectParamsSchema>;
    Headers: Static<typeof IdempotencyHeaderSchema>;
    Body: CreateBody;
  }>(
    '/projects/:projectId/business-versions',
    {
      schema: {
        params: ProjectParamsSchema,
        headers: IdempotencyHeaderSchema,
        body: CreateBusinessVersionBodySchema,
        response: {
          200: BusinessVersionSuccessSchema,
          201: BusinessVersionSuccessSchema,
          400: ApiProblemSchema,
          404: ApiProblemSchema,
          409: ApiProblemSchema,
          503: ApiProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const result = requireService().create({
        projectId: request.params.projectId,
        versionKey: request.body.versionKey,
        name: request.body.name,
        createdBy: request.body.createdBy,
        idempotencyKey: request.headers['idempotency-key'],
        ...(request.body.sourceVersionId ? { sourceVersionId: request.body.sourceVersionId } : {}),
        ...(request.body.git ? { git: request.body.git } : {}),
        ...(request.body.deploymentRevisionId
          ? { deploymentRevisionId: request.body.deploymentRevisionId }
          : {}),
      });
      return reply.status(result.created ? 201 : 200).send(success(request, result.version));
    }
  );

  fastify.get<{ Params: Static<typeof ProjectParamsSchema> }>(
    '/projects/:projectId/business-versions',
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: VersionListSuccessSchema, 503: ApiProblemSchema },
      },
    },
    async (request) =>
      success(request, { versions: requireService().list(request.params.projectId) })
  );

  fastify.get<{ Params: Static<typeof VersionParamsSchema> }>(
    '/business-versions/:versionId',
    {
      schema: {
        params: VersionParamsSchema,
        response: {
          200: BusinessVersionDetailSuccessSchema,
          404: ApiProblemSchema,
          503: ApiProblemSchema,
        },
      },
    },
    async (request) => success(request, requireService().get(request.params.versionId))
  );

  fastify.post<{
    Params: Static<typeof VersionParamsSchema>;
    Headers: Static<typeof IdempotencyHeaderSchema>;
    Body: CopyBody;
  }>(
    '/business-versions/:versionId/copy',
    {
      schema: {
        params: VersionParamsSchema,
        headers: IdempotencyHeaderSchema,
        body: CopyBusinessVersionBodySchema,
        response: {
          200: CopySuccessSchema,
          201: CopySuccessSchema,
          400: ApiProblemSchema,
          404: ApiProblemSchema,
          409: ApiProblemSchema,
          503: ApiProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const result = requireService().copy({
        sourceVersionId: request.params.versionId,
        versionKey: request.body.versionKey,
        name: request.body.name,
        createdBy: request.body.createdBy,
        idempotencyKey: request.headers['idempotency-key'],
        ...(request.body.git ? { git: request.body.git } : {}),
        ...(request.body.deploymentRevisionId
          ? { deploymentRevisionId: request.body.deploymentRevisionId }
          : {}),
      });
      return reply.status(result.created ? 201 : 200).send(
        success(request, {
          ...result,
          version: requireService().get(result.version.id),
        })
      );
    }
  );
};

function success<T>(request: FastifyRequest, data: T): ApiSuccess<T> {
  const correlationHeader = request.headers['x-correlation-id'];
  const correlationId = Array.isArray(correlationHeader)
    ? correlationHeader[0]
    : correlationHeader;
  return {
    data,
    meta: {
      requestId: request.id,
      ...(correlationId ? { correlationId } : {}),
    },
  };
}

export default fp(businessVersionRoutes, {
  fastify: '5.x',
  name: 'business-version-routes',
  encapsulate: true,
});
