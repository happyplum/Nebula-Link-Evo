/**
 * Project Config Routes (Mode 0)
 *
 * Target app configuration, login script management, and replay testing.
 */

import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fp from '../plugins/fastify-plugin.js';
import { Type } from '@sinclair/typebox';
import {
  IdParamSchema,
  ProjectSchema,
  CreateLoginScriptRequestSchema,
  LoginScriptSchema,
  ErrorResponseSchema,
} from '../../types/api.js';
import type { LoginRecorderService } from '../../services/login-recorder-service.js';
import { DatabaseManager } from '../../database/db.js';
import { StateMachineService } from '../../services/state-machine-service.js';
import { ProjectService } from '../../services/project-service.js';
import { ServiceError } from '../../services/service-error.js';

export interface ConfigRouteOptions {
  loginRecorder?: LoginRecorderService;
}

const TargetConfigSchema = Type.Object({
  base_url: Type.String(),
  auth_type: Type.Optional(Type.String()),
  auth_config: Type.Optional(Type.Record(Type.String(), Type.String())),
  seed_urls: Type.Optional(Type.Array(Type.String())),
});

const UpdateTargetConfigSchema = Type.Object({
  base_url: Type.String(),
  auth_type: Type.Optional(Type.String()),
  auth_config: Type.Optional(Type.Record(Type.String(), Type.String())),
  seed_urls: Type.Optional(Type.Array(Type.String())),
});

const ReplayResultSchema = Type.Object({
  success: Type.Boolean(),
  error: Type.Optional(Type.String()),
});

function createProjectService(): ProjectService {
  const db = DatabaseManager.getInstance();
  const stateMachine = new StateMachineService(db);
  return new ProjectService(db, stateMachine);
}

const configRoutes: FastifyPluginAsyncTypebox<ConfigRouteOptions> = async (fastify, options) => {
  const { loginRecorder } = options;

  // GET / — get target config
  fastify.get(
    '/',
    {
      schema: {
        description: 'Get target app configuration',
        tags: ['Config'],
        params: IdParamSchema,
        response: {
          200: TargetConfigSchema,
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

      let authConfig: Record<string, string> | undefined;
      if (project.auth_config_json) {
        try {
          authConfig = JSON.parse(project.auth_config_json) as Record<string, string>;
        } catch {
          authConfig = undefined;
        }
      }

      return {
        base_url: project.target_base_url ?? '',
        auth_type: authConfig?.authType,
        auth_config: authConfig,
        seed_urls: [],
      };
    }
  );

  // PUT / — update target config
  fastify.put(
    '/',
    {
      schema: {
        description: 'Update target app configuration',
        tags: ['Config'],
        params: IdParamSchema,
        body: UpdateTargetConfigSchema,
        response: {
          200: ProjectSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        base_url: string;
        auth_type?: string;
        auth_config?: Record<string, string>;
        seed_urls?: string[];
      };
      const { base_url, auth_type, auth_config, seed_urls } = body;
      const service = createProjectService();

      const existing = service.getProject(id);
      if (!existing) {
        throw ServiceError.notFound(`Project '${id}' not found`);
      }

      const project = service.configureTarget(id, {
        baseUrl: base_url,
        authType: auth_type ?? 'none',
        seedUrls: seed_urls ?? [],
        authConfig: auth_config,
      });

      return project;
    }
  );

  // POST /login-script — save login script
  fastify.post(
    '/login-script',
    {
      schema: {
        description: 'Save login script for project',
        tags: ['Config'],
        params: IdParamSchema,
        body: CreateLoginScriptRequestSchema,
        response: {
          201: LoginScriptSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      const { name, description, steps, is_reusable } = request.body as {
        name: string;
        description?: string;
        steps: unknown[];
        is_reusable: boolean;
      };

      const db = DatabaseManager.getInstance();
      const project = db.getProjectRepo().findById(projectId);
      if (!project) {
        throw ServiceError.notFound(`Project '${projectId}' not found`);
      }

      const script = db.getLoginScriptRepo().create({
        project_id: projectId,
        name,
        steps_json: JSON.stringify(steps),
      });

      reply.status(201);
      return {
        id: script.id,
        name: script.name,
        description,
        steps,
        is_reusable,
        created_at: script.created_at,
        updated_at: script.created_at,
      };
    }
  );

  // POST /login-script/test — test replay login script
  fastify.post(
    '/login-script/test',
    {
      schema: {
        description: 'Test replay of login script',
        tags: ['Config'],
        params: IdParamSchema,
        response: {
          200: ReplayResultSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId } = request.params as { id: string };

      if (!loginRecorder) {
        throw ServiceError.internal('Login recorder service not available');
      }

      const result = await loginRecorder.replayLogin(projectId);
      return result;
    }
  );
};

export default fp(configRoutes, { fastify: '5.x', name: 'project-config-routes', encapsulate: true });
