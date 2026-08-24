import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';
import type { SemanticProjectService } from '../../services/semantic-project-service.js';
import { ServiceError } from '../../services/service-error.js';
import type { ApiSuccess } from '../../types/semantic-control.js';
import { ApiProblemSchema, apiSuccessSchema } from '../../types/semantic-api.js';
import fp from '../plugins/fastify-plugin.js';

const ValidationStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('validating'),
  Type.Literal('needs_recheck'),
  Type.Literal('valid'),
  Type.Literal('invalid'),
  Type.Literal('archived'),
]);
const VersionSummarySchema = Type.Object(
  {
    id: Type.String(),
    versionKey: Type.String(),
    name: Type.String(),
    validationStatus: ValidationStatusSchema,
  },
  { additionalProperties: false }
);
const ProjectSummarySchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    createdBy: Type.String(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    latestVersion: Type.Optional(VersionSummarySchema),
  },
  { additionalProperties: false }
);
const ProjectWorkspaceSchema = Type.Object(
  {
    ...ProjectSummarySchema.properties,
    versionId: Type.String(),
    deploymentRevisionId: Type.String(),
  },
  { additionalProperties: false }
);
const CreateProjectBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    versionKey: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,127}$' }),
    versionName: Type.String({ minLength: 1, maxLength: 200 }),
    targetOrigin: Type.String({ minLength: 1, maxLength: 2_000 }),
    environment: Type.Union([
      Type.Literal('local'),
      Type.Literal('test'),
      Type.Literal('staging'),
      Type.Literal('production'),
    ]),
    prd: Type.Object(
      {
        format: Type.Union([Type.Literal('markdown'), Type.Literal('plain_text')]),
        content: Type.String({ minLength: 1, maxLength: 1_000_000 }),
      },
      { additionalProperties: false }
    ),
    createdBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);
const ProjectParamsSchema = Type.Object(
  { projectId: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false }
);
const IdempotencyHeaderSchema = Type.Object(
  { 'idempotency-key': Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: true }
);

export interface SemanticProjectRoutesOptions {
  service?: SemanticProjectService;
}

const routes: FastifyPluginAsyncTypebox<SemanticProjectRoutesOptions> = async (fastify, options) => {
  const service = () => {
    if (!options.service) throw ServiceError.unavailable('Semantic project service is not configured');
    return options.service;
  };

  fastify.post<{
    Headers: Static<typeof IdempotencyHeaderSchema>;
    Body: Static<typeof CreateProjectBodySchema>;
  }>(
    '/projects',
    {
      schema: {
        headers: IdempotencyHeaderSchema,
        body: CreateProjectBodySchema,
        response: {
          200: apiSuccessSchema(ProjectWorkspaceSchema),
          201: apiSuccessSchema(ProjectWorkspaceSchema),
          400: ApiProblemSchema,
          409: ApiProblemSchema,
          503: ApiProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const result = service().createWorkspace({
        ...request.body,
        idempotencyKey: request.headers['idempotency-key'],
      });
      return reply.status(result.created ? 201 : 200).send(success(request, result.data));
    }
  );

  fastify.get(
    '/projects',
    { schema: { response: { 200: apiSuccessSchema(Type.Object({ projects: Type.Array(ProjectSummarySchema) }, { additionalProperties: false })) } } },
    async (request) => success(request, { projects: service().list() })
  );

  fastify.get<{ Params: Static<typeof ProjectParamsSchema> }>(
    '/projects/:projectId',
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: apiSuccessSchema(ProjectSummarySchema), 404: ApiProblemSchema },
      },
    },
    async (request) => success(request, service().get(request.params.projectId))
  );
};

function success<T>(request: FastifyRequest, data: T): ApiSuccess<T> {
  return { data, meta: { requestId: request.id } };
}

export default fp(routes, {
  fastify: '5.x',
  name: 'semantic-project-routes',
  encapsulate: true,
});
