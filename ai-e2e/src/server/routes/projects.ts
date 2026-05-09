/**
 * Project Routes
 *
 * CRUD endpoints for project management.
 */

import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fp from '../plugins/fastify-plugin.js';
import { Type } from '@sinclair/typebox';
import {
  IdParamSchema,
  PaginationQuerySchema,
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  ProjectSchema,
  ProjectListResponseSchema,
  ErrorResponseSchema,
} from '../../types/api.js';
import { DatabaseManager } from '../../database/db.js';
import { StateMachineService } from '../../services/state-machine-service.js';
import { ProjectService } from '../../services/project-service.js';
import { ServiceError } from '../../services/service-error.js';

function createProjectService(): ProjectService {
  const db = DatabaseManager.getInstance();
  const stateMachine = new StateMachineService(db);
  return new ProjectService(db, stateMachine);
}

const projectRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  // GET / — list all projects (paginated)
  fastify.get(
    '/',
    {
      schema: {
        description: 'List all projects (paginated)',
        tags: ['Projects'],
        querystring: PaginationQuerySchema,
        response: {
          200: ProjectListResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { page = 1, page_size = 20 } = request.query as { page?: number; page_size?: number };
      const service = createProjectService();
      const allProjects = service.listProjects();

      const start = (page - 1) * page_size;
      const end = start + page_size;
      const projects = allProjects.slice(start, end);

      return {
        projects,
        total: allProjects.length,
        page,
        page_size,
      };
    }
  );

  // POST / — create project
  fastify.post(
    '/',
    {
      schema: {
        description: 'Create a new project',
        tags: ['Projects'],
        body: CreateProjectRequestSchema,
        response: {
          201: ProjectSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { name, target_base_url } = request.body as { name: string; target_base_url?: string };
      const service = createProjectService();
      const project = service.createProject(name, target_base_url);
      reply.status(201);
      return project;
    }
  );

  // GET /:id — get project detail
  fastify.get(
    '/:id',
    {
      schema: {
        description: 'Get project detail with current status',
        tags: ['Projects'],
        params: IdParamSchema,
        response: {
          200: ProjectSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const service = createProjectService();
      const project = service.getProject(id);
      if (!project) {
        throw ServiceError.notFound(`Project '${id}' not found`);
      }
      return project;
    }
  );

  // PUT /:id — update project
  fastify.put(
    '/:id',
    {
      schema: {
        description: 'Update project',
        tags: ['Projects'],
        params: IdParamSchema,
        body: UpdateProjectRequestSchema,
        response: {
          200: ProjectSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const service = createProjectService();

      const existing = service.getProject(id);
      if (!existing) {
        throw ServiceError.notFound(`Project '${id}' not found`);
      }

      const body = request.body as Partial<{ name: string; status: string; target_base_url: string }>;
      const updated = service.updateProject(id, body);
      return updated;
    }
  );

  // DELETE /:id — delete project
  fastify.delete(
    '/:id',
    {
      schema: {
        description: 'Delete project',
        tags: ['Projects'],
        params: IdParamSchema,
        response: {
          204: Type.Null(),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const service = createProjectService();
      const deleted = service.deleteProject(id);
      if (!deleted) {
        throw ServiceError.notFound(`Project '${id}' not found`);
      }
      reply.status(204);
    }
  );
};

export default fp(projectRoutes, { fastify: '5.x', name: 'project-routes', encapsulate: true });
