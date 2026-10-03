import { ProjectSummarySchema, ProjectWorkspaceSchema, CreateProjectBodySchema } from '../../contracts/semantic-project.js';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';
import type { SemanticProjectService } from '../../services/semantic-project-service.js';
import { ServiceError } from '../../services/service-error.js';
import type { ApiSuccess } from '../../contracts/semantic-control.js';
import { ApiProblemSchema, apiSuccessSchema } from '../../contracts/semantic-api.js';
import fp from '../plugins/fastify-plugin.js';

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
