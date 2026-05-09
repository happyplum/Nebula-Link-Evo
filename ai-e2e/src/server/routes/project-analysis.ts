/**
 * Project Analysis Routes (Mode 1)
 *
 * PRD upload, AI analysis, and module tree management.
 */

import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fp from '../plugins/fastify-plugin.js';
import { Type } from '@sinclair/typebox';
import {
  IdParamSchema,
  BusinessModuleSchema,
  ErrorResponseSchema,
} from '../../types/api.js';
import type { PRDAnalyzerService } from '../../services/prd-analyzer-service.js';
import { DatabaseManager } from '../../database/db.js';
import { ServiceError } from '../../services/service-error.js';
import type { SourceOrigin } from '../../types/business-module.js';

export interface AnalysisRouteOptions {
  prdAnalyzer?: PRDAnalyzerService;
}

const ModuleIdParamSchema = Type.Object({
  id: Type.String({ description: 'Project ID' }),
  moduleId: Type.String({ description: 'Module ID' }),
});

const UploadPRDRequestSchema = Type.Object({
  content: Type.String({ minLength: 1 }),
  format: Type.Optional(Type.String({ default: 'markdown' })),
});

const AnalyzeRequestSchema = Type.Object({
  content: Type.String({ minLength: 1 }),
  format: Type.Optional(Type.String({ default: 'markdown' })),
});

const PRDDocumentResponseSchema = Type.Object({
  id: Type.String(),
  project_id: Type.String(),
  raw_content: Type.String(),
  format: Type.String(),
  created_at: Type.String(),
});

const ModuleTreeResponseSchema = Type.Object({
  business_modules: Type.Array(
    Type.Object({
      id: Type.String(),
      project_id: Type.String(),
      name: Type.String(),
      description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      sort_order: Type.Number(),
      source: Type.String(),
      created_at: Type.String(),
      functional_modules: Type.Array(
        Type.Object({
          id: Type.String(),
          business_module_id: Type.String(),
          name: Type.String(),
          description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          sort_order: Type.Number(),
          bound_url_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          source: Type.String(),
          created_at: Type.String(),
          test_scenarios: Type.Array(
            Type.Object({
              id: Type.String(),
              functional_module_id: Type.String(),
              name: Type.String(),
              description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              sort_order: Type.Number(),
              source: Type.String(),
              created_at: Type.String(),
            })
          ),
        })
      ),
    })
  ),
});

const ReorderModulesRequestSchema = Type.Object({
  module_ids: Type.Array(Type.String()),
  level: Type.Union([Type.Literal('business'), Type.Literal('functional')]),
  parent_id: Type.Optional(Type.String()),
});

const UpdateModuleRequestSchema = Type.Object({
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
});

const AddModuleRequestSchema = Type.Object({
  level: Type.Union([Type.Literal('business'), Type.Literal('functional')]),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  parent_id: Type.Optional(Type.String()),
});

function requireProject(projectId: string): void {
  const db = DatabaseManager.getInstance();
  const project = db.getProjectRepo().findById(projectId);
  if (!project) {
    throw ServiceError.notFound(`Project '${projectId}' not found`);
  }
}

const analysisRoutes: FastifyPluginAsyncTypebox<AnalysisRouteOptions> = async (fastify, options) => {
  const prdAnalyzerOverride = options.prdAnalyzer;

  function getAnalyzer(): PRDAnalyzerService {
    if (prdAnalyzerOverride) return prdAnalyzerOverride;
    throw ServiceError.internal('PRD analyzer service not configured');
  }

  // POST /upload — upload PRD content
  fastify.post(
    '/upload',
    {
      schema: {
        description: 'Upload PRD content for a project',
        tags: ['Analysis'],
        params: IdParamSchema,
        body: UploadPRDRequestSchema,
        response: {
          201: PRDDocumentResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);

      const { content, format = 'markdown' } = request.body as { content: string; format?: string };
      const db = DatabaseManager.getInstance();
      const doc = db.getPRDDocumentRepo().create({
        project_id: projectId,
        raw_content: content,
        format,
      });

      reply.status(201);
      return {
        id: doc.id,
        project_id: doc.project_id,
        raw_content: doc.raw_content,
        format: doc.format,
        created_at: doc.created_at,
      };
    }
  );

  // POST /analyze — trigger AI PRD analysis
  fastify.post(
    '/analyze',
    {
      schema: {
        description: 'Trigger AI analysis of PRD content',
        tags: ['Analysis'],
        params: IdParamSchema,
        body: AnalyzeRequestSchema,
        response: {
          200: Type.Object({
            business_modules: Type.Array(BusinessModuleSchema),
          }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);

      const { content, format = 'markdown' } = request.body as { content: string; format?: string };

      fastify.sseEmitter.emit({
        type: 'prd.analysis_progress',
        data: { projectId, phase: 'starting', progress: 0 },
      });

      const modules = await getAnalyzer().analyzePRD(projectId, content, format);

      fastify.sseEmitter.emit({
        type: 'prd.analysis_complete',
        data: {
          projectId,
          modules: modules.map((m) => ({
            id: m.id,
            project_id: m.project_id,
            name: m.name,
            description: m.description ? [m.description] : [],
            requirements: [],
            source_origin: m.source as SourceOrigin,
            created_at: m.created_at,
            updated_at: m.created_at,
          })),
        },
      });

      return {
        business_modules: modules.map((m) => ({
          id: m.id,
          project_id: m.project_id,
          name: m.name,
          description: m.description ? [m.description] : [],
          requirements: [],
          source_origin: m.source,
          created_at: m.created_at,
          updated_at: m.created_at,
        })),
      };
    }
  );

  // GET /modules — get L1/L2 module tree
  fastify.get(
    '/modules',
    {
      schema: {
        description: 'Get business/functional module tree with test scenarios',
        tags: ['Analysis'],
        params: IdParamSchema,
        response: {
          200: ModuleTreeResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);

      const result = getAnalyzer().getAnalysisResult(projectId);
      return result;
    }
  );

  // PUT /modules/:moduleId — edit module
  fastify.put(
    '/modules/:moduleId',
    {
      schema: {
        description: 'Edit a business or functional module',
        tags: ['Analysis'],
        params: ModuleIdParamSchema,
        body: UpdateModuleRequestSchema,
        response: {
          200: Type.Object({ success: Type.Boolean() }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId, moduleId } = request.params as { id: string; moduleId: string };
      requireProject(projectId);

      const { name, description } = request.body as { name?: string; description?: string };
      const db = DatabaseManager.getInstance();

      // Try business module first
      const bmRepo = db.getBusinessModuleRepo();
      const bm = bmRepo.findById(moduleId);
      if (bm) {
        if (name) {
          bmRepo.updateName(moduleId, name);
        }
        return { success: true };
      }

      // Try functional module
      const fmRepo = db.getFunctionalModuleRepo();
      const fm = fmRepo.findById(moduleId);
      if (fm) {
        if (name) { fmRepo.updateName(moduleId, name); }
        if (description) { fmRepo.updateDescription(moduleId, description); }
        return { success: true };
      }

      throw ServiceError.notFound(`Module '${moduleId}' not found`);
    }
  );

  // POST /modules — add module
  fastify.post(
    '/modules',
    {
      schema: {
        description: 'Add a business or functional module',
        tags: ['Analysis'],
        params: IdParamSchema,
        body: AddModuleRequestSchema,
        response: {
          201: Type.Object({ id: Type.String() }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);

      const { level, name, description, parent_id } = request.body as {
        level: 'business' | 'functional';
        name: string;
        description?: string;
        parent_id?: string;
      };
      const db = DatabaseManager.getInstance();

      if (level === 'business') {
        const mod = db.getBusinessModuleRepo().create({
          project_id: projectId,
          name,
          description,
          source: 'human_created',
        });
        reply.status(201);
        return { id: mod.id };
      }

      if (level === 'functional') {
        if (!parent_id) {
          throw ServiceError.validation('parent_id is required for functional modules');
        }

        const parentBM = db.getBusinessModuleRepo().findById(parent_id);
        if (!parentBM) {
          throw ServiceError.notFound(`Business module '${parent_id}' not found`);
        }

        const mod = db.getFunctionalModuleRepo().create({
          business_module_id: parent_id,
          name,
          description,
          source: 'human_created',
        });
        reply.status(201);
        return { id: mod.id };
      }

      throw ServiceError.validation(`Invalid module level: ${level}`);
    }
  );

  // DELETE /modules/:moduleId — delete module
  fastify.delete(
    '/modules/:moduleId',
    {
      schema: {
        description: 'Delete a business or functional module',
        tags: ['Analysis'],
        params: ModuleIdParamSchema,
        response: {
          204: Type.Null(),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: projectId, moduleId } = request.params as { id: string; moduleId: string };
      requireProject(projectId);

      const db = DatabaseManager.getInstance();

      const bmDeleted = db.getBusinessModuleRepo().delete(moduleId);
      if (bmDeleted) {
        reply.status(204);
        return;
      }

      const fmDeleted = db.getFunctionalModuleRepo().delete(moduleId);
      if (fmDeleted) {
        reply.status(204);
        return;
      }

      throw ServiceError.notFound(`Module '${moduleId}' not found`);
    }
  );

  // PUT /modules/reorder — reorder modules
  fastify.put(
    '/modules/reorder',
    {
      schema: {
        description: 'Reorder business or functional modules',
        tags: ['Analysis'],
        params: IdParamSchema,
        body: ReorderModulesRequestSchema,
        response: {
          200: Type.Object({ success: Type.Boolean() }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);

      const { module_ids, level, parent_id } = request.body as {
        module_ids: string[];
        level: 'business' | 'functional';
        parent_id?: string;
      };
      const db = DatabaseManager.getInstance();

      if (level === 'business') {
        db.getBusinessModuleRepo().reorder(module_ids);
      } else if (level === 'functional' && parent_id) {
        db.getFunctionalModuleRepo().reorder(module_ids);
      } else {
        throw ServiceError.validation('parent_id is required for functional module reorder');
      }

      return { success: true };
    }
  );
};

export default fp(analysisRoutes, { fastify: '5.x', name: 'project-analysis-routes', encapsulate: true });
