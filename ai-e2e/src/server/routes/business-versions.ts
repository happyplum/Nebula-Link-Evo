import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import type { BusinessVersionService } from '../../services/business-version-service.js';
import { ServiceError } from '../../services/service-error.js';
import { ErrorResponseSchema } from '../../types/api.js';
import fp from '../plugins/fastify-plugin.js';

const StableKeySchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-z0-9][a-z0-9._-]{0,127}$',
});

const GitMetadataSchema = Type.Object(
  {
    repository: Type.Optional(Type.String({ maxLength: 500 })),
    ref: Type.Optional(Type.String({ maxLength: 500 })),
    commit: Type.Optional(Type.String({ maxLength: 500 })),
    buildId: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false }
);

const BusinessVersionSchema = Type.Object(
  {
    id: Type.String(),
    projectId: Type.String(),
    versionKey: Type.String(),
    name: Type.String(),
    sourceVersionId: Type.Optional(Type.String()),
    validationStatus: Type.Union([
      Type.Literal('draft'),
      Type.Literal('validating'),
      Type.Literal('needs_recheck'),
      Type.Literal('valid'),
      Type.Literal('invalid'),
      Type.Literal('archived'),
    ]),
    schemaVersion: Type.Literal(1),
    git: Type.Optional(GitMetadataSchema),
    createdBy: Type.String(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    archivedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);

const AssetSummarySchema = Type.Object(
  {
    pages: Type.Integer({ minimum: 0 }),
    businessModules: Type.Integer({ minimum: 0 }),
    functionalModules: Type.Integer({ minimum: 0 }),
    functionalScripts: Type.Integer({ minimum: 0 }),
    scenarios: Type.Integer({ minimum: 0 }),
    staleExecutableAssets: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false }
);

const BusinessVersionDetailSchema = Type.Object(
  {
    ...BusinessVersionSchema.properties,
    deploymentBindings: Type.Array(
      Type.Object(
        {
          bindingKey: Type.String(),
          deploymentRevisionId: Type.String(),
          isDefault: Type.Boolean(),
        },
        { additionalProperties: false }
      )
    ),
    assets: AssetSummarySchema,
  },
  { additionalProperties: false }
);

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
          200: BusinessVersionSchema,
          201: BusinessVersionSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
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
      return reply.status(result.created ? 201 : 200).send(result.version);
    }
  );

  fastify.get<{ Params: Static<typeof ProjectParamsSchema> }>(
    '/projects/:projectId/business-versions',
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: VersionListSchema, 503: ErrorResponseSchema },
      },
    },
    async (request) => ({ versions: requireService().list(request.params.projectId) })
  );

  fastify.get<{ Params: Static<typeof VersionParamsSchema> }>(
    '/business-versions/:versionId',
    {
      schema: {
        params: VersionParamsSchema,
        response: {
          200: BusinessVersionDetailSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => requireService().get(request.params.versionId)
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
          200: CopyResponseSchema,
          201: CopyResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
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
      return reply.status(result.created ? 201 : 200).send({
        ...result,
        version: requireService().get(result.version.id),
      });
    }
  );
};

export default fp(businessVersionRoutes, {
  fastify: '5.x',
  name: 'business-version-routes',
  encapsulate: true,
});
