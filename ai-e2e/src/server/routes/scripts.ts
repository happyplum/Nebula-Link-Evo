/**
 * Scripts Routes (Mode 3)
 *
 * API routes for AI-driven Playwright script generation:
 * generate scripts, list/query, view/edit, version history.
 */

import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, Static } from '@sinclair/typebox';
import fp from '../plugins/fastify-plugin.js';
import { DatabaseManager } from '../../database/db.js';
import { ScriptGeneratorService } from '../../services/script-generator-service.js';
import { ServiceError } from '../../services/service-error.js';
import type { AiE2eRuntimeClient } from '../../infrastructure/ai-e2e-runtime-client.js';
import type { PromptTemplateManager } from '../../ai/prompt-manager.js';
import type { Script as ScriptEntity } from '../../types/script.js';
import type {
  GeneratedValue as GeneratedValueType,
  ScriptStatus as ScriptStatusType,
} from '../../types/script.js';

// ---------- Options ----------

export interface ScriptsRouteOptions {
  runtimeClient?: AiE2eRuntimeClient | null;
  promptManager?: PromptTemplateManager;
}

// ---------- Schemas ----------

const ProjectIdParamSchema = Type.Object({
  id: Type.String(),
});

const ScriptIdParamSchema = Type.Object({
  id: Type.String(),
  scriptId: Type.String(),
});

const GenerateScriptRequestSchema = Type.Object({
  scenario_id: Type.String(),
});

const ScriptResponseSchema = Type.Object({
  id: Type.String(),
  test_scenario_id: Type.String(),
  scenario_name: Type.Optional(Type.String()),
  business_module_name: Type.Optional(Type.String()),
  functional_module_id: Type.Optional(Type.String()),
  functional_module_name: Type.Optional(Type.String()),
  version: Type.Number(),
  content: Type.String(),
  language: Type.String(),
  generated_by: Type.String(),
  status: Type.String(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

const EditScriptRequestSchema = Type.Object({
  content: Type.String(),
});

const ScriptVersionSchema = Type.Object({
  id: Type.String(),
  version: Type.Number(),
  content: Type.String(),
  generated_by: Type.String(),
  status: Type.String(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

const FunctionalModuleGroupSchema = Type.Object({
  functional_module: Type.Object({
    id: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
  }),
  scripts: Type.Array(ScriptResponseSchema),
});

// ---------- Inferred types ----------

type ProjectIdParam = Static<typeof ProjectIdParamSchema>;
type ScriptIdParam = Static<typeof ScriptIdParamSchema>;
type GenerateScriptRequest = Static<typeof GenerateScriptRequestSchema>;
type EditScriptRequest = Static<typeof EditScriptRequestSchema>;

// ---------- Route Plugin ----------

const scriptsRoutes: FastifyPluginAsyncTypebox<ScriptsRouteOptions> = async (fastify, options) => {
  const { runtimeClient = null, promptManager: promptManagerOpt } = options;

  function requireRuntimeClient(): AiE2eRuntimeClient {
    if (!runtimeClient) {
      throw ServiceError.unavailable('AI service is not configured');
    }
    return runtimeClient;
  }

  function requirePromptManager(): PromptTemplateManager {
    if (!promptManagerOpt) {
      throw ServiceError.internal('Prompt manager not configured');
    }
    return promptManagerOpt;
  }

  /**
   * Create a ScriptGeneratorService for the given request.
   */
  function getScriptGeneratorService(): ScriptGeneratorService {
    const client = requireRuntimeClient();
    const manager = requirePromptManager();
    const db = DatabaseManager.getInstance();
    return new ScriptGeneratorService({
      runtimeClient: client,
      promptManager: manager,
      scriptRepo: db.getScriptRepo(),
      scenarioRepo: db.getTestScenarioRepo(),
      urlRepo: db.getURLRepo(),
      urlBindingRepo: db.getURLModuleBindingRepo(),
    });
  }

  // POST /generate — trigger script generation
  fastify.post(
    '/generate',
    {
      schema: {
        description: 'Generate a Playwright test script for a scenario',
        tags: ['Scripts'],
        params: ProjectIdParamSchema,
        body: GenerateScriptRequestSchema,
        response: {
          200: ScriptResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: projectId } = request.params as ProjectIdParam;
      const { scenario_id } = request.body as GenerateScriptRequest;

      fastify.sseEmitter.emit({
        type: 'script.generation_progress',
        data: { scenarioId: scenario_id, progress: 0 },
      });

      const service = getScriptGeneratorService();
      const script = await service.generateScript(scenario_id);

      const scriptEntity: ScriptEntity = {
        id: script.id,
        test_scenario_id: script.test_scenario_id,
        name: '',
        generated_by: script.generated_by as GeneratedValueType,
        status: script.status as ScriptStatusType,
        content: {},
        actions: [],
        created_at: script.created_at,
        updated_at: script.updated_at,
      };

      fastify.sseEmitter.emit({
        type: 'script.generated',
        data: { script: scriptEntity },
      });

      return script;
    }
  );

  // GET / — list scripts grouped by functional module
  fastify.get(
    '/',
    {
      schema: {
        description: 'List scripts grouped by functional module',
        tags: ['Scripts'],
        params: ProjectIdParamSchema,
        response: {
          200: Type.Array(FunctionalModuleGroupSchema),
        },
      },
    },
    async (request) => {
      const { id: projectId } = request.params as ProjectIdParam;
      const db = DatabaseManager.getInstance();

      const bizModules = db.getBusinessModuleRepo().findByProjectId(projectId);
      const result: Array<Static<typeof FunctionalModuleGroupSchema>> = [];

      for (const bm of bizModules) {
        const funcModules = db.getFunctionalModuleRepo().findByBusinessModuleId(bm.id);

        for (const fm of funcModules) {
          const scenarios = db.getTestScenarioRepo().findByFunctionalModuleId(fm.id);
          const scriptsForModule: Array<Static<typeof ScriptResponseSchema>> = [];

          for (const scenario of scenarios) {
            const scripts = db.getScriptRepo().findByScenarioId(scenario.id);
            for (const script of scripts) {
              scriptsForModule.push({
                id: script.id,
                test_scenario_id: script.test_scenario_id,
                scenario_name: scenario.name,
                business_module_name: bm.name,
                functional_module_id: fm.id,
                functional_module_name: fm.name,
                version: script.version,
                content: script.content,
                language: script.language,
                generated_by: script.generated_by,
                status: script.status,
                created_at: script.created_at,
                updated_at: script.updated_at,
              });
            }
          }

          if (scriptsForModule.length > 0) {
            result.push({
              functional_module: {
                id: fm.id,
                name: fm.name,
                description: fm.description ?? undefined,
              },
              scripts: scriptsForModule,
            });
          }
        }
      }

      return result;
    }
  );

  // GET /:scriptId — get script content
  fastify.get(
    '/:scriptId',
    {
      schema: {
        description: 'Get a specific script by ID',
        tags: ['Scripts'],
        params: ScriptIdParamSchema,
        response: {
          200: ScriptResponseSchema,
        },
      },
    },
    async (request) => {
      const { scriptId } = request.params as ScriptIdParam;
      const db = DatabaseManager.getInstance();

      const script = db.getScriptRepo().findById(scriptId);
      if (!script) {
        throw ServiceError.notFound(`Script not found: ${scriptId}`);
      }

      return {
        id: script.id,
        test_scenario_id: script.test_scenario_id,
        version: script.version,
        content: script.content,
        language: script.language,
        generated_by: script.generated_by,
        status: script.status,
        created_at: script.created_at,
        updated_at: script.updated_at,
      };
    }
  );

  // PUT /:scriptId — human-edited save
  fastify.put(
    '/:scriptId',
    {
      schema: {
        description: 'Save a human-edited version of a script',
        tags: ['Scripts'],
        params: ScriptIdParamSchema,
        body: EditScriptRequestSchema,
        response: {
          200: ScriptResponseSchema,
        },
      },
    },
    async (request) => {
      const { scriptId } = request.params as ScriptIdParam;
      const { content } = request.body as EditScriptRequest;
      const service = getScriptGeneratorService();
      return service.saveEditedScript(scriptId, content);
    }
  );

  // POST /generate-all — batch generate scripts for all scenarios
  fastify.post(
    '/generate-all',
    {
      schema: {
        description: 'Generate Playwright test scripts for all scenarios that lack scripts',
        tags: ['Scripts'],
        params: ProjectIdParamSchema,
        response: {
          200: Type.Object({
            generated: Type.Array(ScriptResponseSchema),
            skipped: Type.Array(
              Type.Object({
                scenario_id: Type.String(),
                reason: Type.String(),
              })
            ),
          }),
        },
      },
    },
    async (request) => {
      const { id: projectId } = request.params as ProjectIdParam;
      const service = getScriptGeneratorService();
      const db = DatabaseManager.getInstance();

      const bizModules = db.getBusinessModuleRepo().findByProjectId(projectId);
      const generated: Array<Static<typeof ScriptResponseSchema>> = [];
      const skipped: Array<{ scenario_id: string; reason: string }> = [];

      for (const bm of bizModules) {
        const funcModules = db.getFunctionalModuleRepo().findByBusinessModuleId(bm.id);
        for (const fm of funcModules) {
          const scenarios = db.getTestScenarioRepo().findByFunctionalModuleId(fm.id);
          for (const scenario of scenarios) {
            const existing = db.getScriptRepo().findByScenarioId(scenario.id);
            if (existing.length > 0) {
              skipped.push({ scenario_id: scenario.id, reason: 'Script already exists' });
              continue;
            }

            try {
              const script = await service.generateScript(scenario.id);
              generated.push({
                id: script.id,
                test_scenario_id: script.test_scenario_id,
                version: script.version,
                content: script.content,
                language: script.language,
                generated_by: script.generated_by,
                status: script.status,
                created_at: script.created_at,
                updated_at: script.updated_at,
              });
            } catch (e) {
              skipped.push({
                scenario_id: scenario.id,
                reason: e instanceof Error ? e.message : 'Unknown error',
              });
            }
          }
        }
      }

      return { generated, skipped };
    }
  );

  // GET /:scriptId/versions — version history
  fastify.get(
    '/:scriptId/versions',
    {
      schema: {
        description: 'Get version history for a script',
        tags: ['Scripts'],
        params: ScriptIdParamSchema,
        response: {
          200: Type.Array(ScriptVersionSchema),
        },
      },
    },
    async (request) => {
      const { scriptId } = request.params as ScriptIdParam;
      const db = DatabaseManager.getInstance();

      const script = db.getScriptRepo().findById(scriptId);
      if (!script) {
        throw ServiceError.notFound(`Script not found: ${scriptId}`);
      }

      const service = getScriptGeneratorService();
      const history = await service.getScriptHistory(script.test_scenario_id);

      return history.map((s) => ({
        id: s.id,
        version: s.version,
        content: s.content,
        generated_by: s.generated_by,
        status: s.status,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));
    }
  );
};

export default fp(scriptsRoutes, { fastify: '5.x', name: 'scripts-routes', encapsulate: true });
