/**
 * Project Analysis Routes (Mode 1)
 *
 * PRD upload, AI analysis, and module tree management.
 */

import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fp from '../plugins/fastify-plugin.js';
import { Type } from '@sinclair/typebox';
import { IdParamSchema, BusinessModuleSchema, ErrorResponseSchema } from '../../types/api.js';
import { PRDAnalyzerService } from '../../services/prd-analyzer-service.js';
import { DatabaseManager } from '../../database/db.js';
import { ServiceError } from '../../services/service-error.js';
import { withRetry } from '../../utils/retry.js';
import type { AiE2eRuntimeClient } from '../../infrastructure/ai-e2e-runtime-client.js';
import type { PromptTemplateManager } from '../../ai/prompt-manager.js';
import type { TokenBudgetTracker } from '../../ai/token-tracker.js';
import type { SourceOrigin } from '../../types/business-module.js';
import type { StateMachineService } from '../../services/state-machine-service.js';

export interface AnalysisRouteOptions {
  runtimeClient?: AiE2eRuntimeClient | null;
  promptManager?: PromptTemplateManager;
  tokenTracker?: TokenBudgetTracker;
  stateMachine?: StateMachineService;
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

const analysisRoutes: FastifyPluginAsyncTypebox<AnalysisRouteOptions> = async (
  fastify,
  options
) => {
  const {
    runtimeClient = null,
    promptManager: promptManagerOpt,
    tokenTracker: tokenTrackerOpt,
    stateMachine,
  } = options;

  function getAnalyzer(): PRDAnalyzerService {
    if (!runtimeClient) {
      throw ServiceError.unavailable('AI service is not configured');
    }
    if (!promptManagerOpt) {
      throw ServiceError.internal('Prompt manager not configured');
    }
    if (!tokenTrackerOpt) {
      throw ServiceError.internal('Token tracker not configured');
    }
    const db = DatabaseManager.getInstance();
    return new PRDAnalyzerService(runtimeClient, promptManagerOpt, tokenTrackerOpt, db);
  }

  // GET /documents — list PRD documents for a project
  fastify.get(
    '/documents',
    {
      schema: {
        description: 'List all PRD documents for a project',
        tags: ['Analysis'],
        params: IdParamSchema,
        response: {
          200: Type.Array(PRDDocumentResponseSchema),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);
      const db = DatabaseManager.getInstance();
      const docs = db.getPRDDocumentRepo().findByProjectId(projectId);
      return docs.map(({ parsed_content_json, ai_model_used, token_count, ...doc }) => doc);
    }
  );

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

      // Auto-transition project state: analyzing → analyzed
      if (stateMachine) {
        try {
          const project = DatabaseManager.getInstance().getProjectRepo().findById(projectId);
          if (project?.status === 'configuring') {
            stateMachine.transition(projectId, 'analyzing');
          }
          if (
            project?.status === 'analyzing' ||
            DatabaseManager.getInstance().getProjectRepo().findById(projectId)?.status ===
              'analyzing'
          ) {
            stateMachine.transition(projectId, 'analyzed');
          }
        } catch {
          // State transition failure should not block analysis results
        }
      }

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
      return {
        business_modules: result.businessModules.map(({ functionalModules, ...bmRest }) => ({
          ...bmRest,
          functional_modules: functionalModules.map(({ testScenarios, ...fmRest }) => ({
            ...fmRest,
            test_scenarios: testScenarios,
          })),
        })),
      };
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
        if (name) {
          fmRepo.updateName(moduleId, name);
        }
        if (description) {
          fmRepo.updateDescription(moduleId, description);
        }
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

  // POST /modules/:moduleId/decompose — AI decompose L1→L2
  fastify.post(
    '/modules/:moduleId/decompose',
    {
      schema: {
        description: 'Decompose a business module into functional modules via AI',
        tags: ['Analysis'],
        params: ModuleIdParamSchema,
        response: {
          200: Type.Object({
            functional_modules: Type.Array(
              Type.Object({
                id: Type.String(),
                business_module_id: Type.String(),
                name: Type.String(),
                description: Type.Optional(Type.String()),
                sort_order: Type.Number(),
                source: Type.String(),
                created_at: Type.String(),
              })
            ),
          }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId, moduleId } = request.params as { id: string; moduleId: string };
      requireProject(projectId);

      const analyzer = getAnalyzer();
      const modules = await analyzer.decomposeBusinessModule(projectId, moduleId);

      fastify.sseEmitter.emit({
        type: 'prd.decomposition_complete',
        data: {
          projectId,
          businessModuleId: moduleId,
          functionalModules: modules.map((m) => m.id),
        },
      });

      return {
        functional_modules: modules.map((m) => ({
          id: m.id,
          business_module_id: m.business_module_id,
          name: m.name,
          description: m.description ?? undefined,
          sort_order: m.sort_order,
          source: m.source,
          created_at: m.created_at,
        })),
      };
    }
  );

  // POST /decompose-all — batch decompose all L1 modules
  fastify.post(
    '/decompose-all',
    {
      schema: {
        description: 'Decompose all business modules into functional modules via AI',
        tags: ['Analysis'],
        params: IdParamSchema,
        response: {
          200: Type.Object({
            total: Type.Number(),
            succeeded: Type.Number(),
            failed: Type.Number(),
            results: Type.Array(
              Type.Object({
                business_module_id: Type.String(),
                business_module_name: Type.String(),
                functional_modules: Type.Optional(
                  Type.Array(
                    Type.Object({
                      id: Type.String(),
                      name: Type.String(),
                      description: Type.Optional(Type.String()),
                    })
                  )
                ),
                error: Type.Optional(Type.String()),
              })
            ),
          }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);

      const db = DatabaseManager.getInstance();
      const businessModules = db.getBusinessModuleRepo().findByProjectId(projectId);
      const analyzer = getAnalyzer();
      const results: Array<{
        business_module_id: string;
        business_module_name: string;
        functional_modules?: Array<{ id: string; name: string; description?: string }>;
        error?: string;
      }> = [];

      for (const bm of businessModules) {
        const existing = db.getFunctionalModuleRepo().findByBusinessModuleId(bm.id);
        if (existing.length > 0) {
          results.push({
            business_module_id: bm.id,
            business_module_name: bm.name,
            functional_modules: existing.map((fm) => ({
              id: fm.id,
              name: fm.name,
              description: fm.description ?? undefined,
            })),
          });
          continue;
        }

        try {
          const modules = await withRetry(
            () => analyzer.decomposeBusinessModule(projectId, bm.id),
            { maxRetries: 2, baseDelayMs: 1000 }
          );
          results.push({
            business_module_id: bm.id,
            business_module_name: bm.name,
            functional_modules: modules.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description ?? undefined,
            })),
          });
        } catch (error) {
          results.push({
            business_module_id: bm.id,
            business_module_name: bm.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const failedCount = results.filter((r) => r.error).length;
      const succeededCount = results.length - failedCount;

      fastify.sseEmitter.emit({
        type: 'prd.decomposition_all_complete',
        data: {
          projectId,
          totalBusinessModules: businessModules.length,
          succeeded: succeededCount,
          failed: failedCount,
        },
      });

      return {
        total: businessModules.length,
        succeeded: succeededCount,
        failed: failedCount,
        results,
      };
    }
  );

  // POST /modules/:moduleId/generate-scenarios — AI generate test scenarios for an FM
  fastify.post(
    '/modules/:moduleId/generate-scenarios',
    {
      schema: {
        description: 'Generate test scenarios for a functional module via AI',
        tags: ['Analysis'],
        params: ModuleIdParamSchema,
        response: {
          200: Type.Object({
            scenarios: Type.Array(
              Type.Object({
                id: Type.String(),
                functional_module_id: Type.String(),
                name: Type.String(),
                description: Type.Optional(Type.String()),
                sort_order: Type.Number(),
                source: Type.String(),
                created_at: Type.String(),
              })
            ),
          }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId, moduleId } = request.params as { id: string; moduleId: string };
      requireProject(projectId);

      const analyzer = getAnalyzer();
      const scenarios = await analyzer.generateTestScenarios(projectId, moduleId);

      return {
        scenarios: scenarios.map((s) => ({
          id: s.id,
          functional_module_id: s.functional_module_id,
          name: s.name,
          description: s.description ?? undefined,
          sort_order: s.sort_order,
          source: s.source,
          created_at: s.created_at,
        })),
      };
    }
  );

  // POST /generate-all-scenarios — batch generate scenarios for all FMs
  fastify.post(
    '/generate-all-scenarios',
    {
      schema: {
        description: 'Generate test scenarios for all functional modules via AI',
        tags: ['Analysis'],
        params: IdParamSchema,
        response: {
          200: Type.Object({
            total: Type.Number(),
            succeeded: Type.Number(),
            failed: Type.Number(),
            results: Type.Array(
              Type.Object({
                functional_module_id: Type.String(),
                functional_module_name: Type.String(),
                scenarios: Type.Optional(
                  Type.Array(
                    Type.Object({
                      id: Type.String(),
                      name: Type.String(),
                      description: Type.Optional(Type.String()),
                    })
                  )
                ),
                error: Type.Optional(Type.String()),
              })
            ),
          }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);

      const db = DatabaseManager.getInstance();
      const businessModules = db.getBusinessModuleRepo().findByProjectId(projectId);
      const analyzer = getAnalyzer();
      const results: Array<{
        functional_module_id: string;
        functional_module_name: string;
        scenarios?: Array<{ id: string; name: string; description?: string }>;
        error?: string;
      }> = [];

      for (const bm of businessModules) {
        const funcModules = db.getFunctionalModuleRepo().findByBusinessModuleId(bm.id);
        for (const fm of funcModules) {
          const existing = db.getTestScenarioRepo().findByFunctionalModuleId(fm.id);
          if (existing.length > 0) {
            results.push({
              functional_module_id: fm.id,
              functional_module_name: fm.name,
              scenarios: existing.map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description ?? undefined,
              })),
            });
            continue;
          }

          try {
            const scenarios = await withRetry(
              () => analyzer.generateTestScenarios(projectId, fm.id),
              { maxRetries: 2, baseDelayMs: 1000 }
            );
            results.push({
              functional_module_id: fm.id,
              functional_module_name: fm.name,
              scenarios: scenarios.map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description ?? undefined,
              })),
            });
          } catch (error) {
            results.push({
              functional_module_id: fm.id,
              functional_module_name: fm.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      const failedCount = results.filter((r) => r.error).length;
      const succeededCount = results.length - failedCount;

      fastify.sseEmitter.emit({
        type: 'prd.scenarios_all_complete',
        data: { projectId, succeeded: succeededCount, failed: failedCount },
      });

      return {
        total: results.length,
        succeeded: succeededCount,
        failed: failedCount,
        results,
      };
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

export default fp(analysisRoutes, {
  fastify: '5.x',
  name: 'project-analysis-routes',
  encapsulate: true,
});
