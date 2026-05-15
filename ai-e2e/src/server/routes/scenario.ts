/**
 * Scenario Routes
 *
 * Routes for reading and updating test scenarios.
 * - GET /scenarios/:scenarioId — retrieve a single scenario with parsed fields
 * - PUT /scenarios/:scenarioId — update a scenario with validation
 * - GET /modules/:moduleId/scenarios — list scenarios for a functional module
 */
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import fp from '../plugins/fastify-plugin.js';
import { DatabaseManager } from '../../database/db.js';
import { ServiceError } from '../../services/service-error.js';
import type { TestScenarioService } from '../../services/test-scenario-service.js';

interface ScenarioRouteOptions {
  scenarioService?: TestScenarioService;
}

const routes: FastifyPluginAsyncTypebox<ScenarioRouteOptions> = async (fastify, options) => {
  const scenarioServiceOverride = options.scenarioService;

  function getScenarioService(): TestScenarioService {
    if (scenarioServiceOverride) return scenarioServiceOverride;
    throw ServiceError.internal('Scenario service not configured');
  }

  function requireProject(projectId: string) {
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().findById(projectId);
    if (!project) {
      throw ServiceError.notFound(`Project '${projectId}' not found`);
    }
    return project;
  }

  // GET /scenarios/:scenarioId — retrieve a single scenario
  fastify.get(
    '/scenarios/:scenarioId',
    {
      schema: {
        description: 'Get a test scenario by ID',
        tags: ['Scenarios'],
        params: Type.Object({
          id: Type.String({ description: 'Project ID' }),
          scenarioId: Type.String({ description: 'Scenario ID' }),
        }),
        response: {
          200: Type.Object({
            id: Type.String(),
            functional_module_id: Type.String(),
            name: Type.String(),
            description: Type.String(),
            preconditions: Type.Optional(Type.Array(Type.String())),
            expected_results: Type.Optional(Type.Array(Type.String())),
            created_at: Type.String(),
            updated_at: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId, scenarioId } = request.params as { id: string; scenarioId: string };
      requireProject(projectId);

      const scenario = getScenarioService().getScenario(scenarioId);
      if (!scenario) {
        throw ServiceError.notFound(`Scenario '${scenarioId}' not found`);
      }

      return reply.status(200).send(scenario);
    },
  );

  // PUT /scenarios/:scenarioId — update a scenario
  fastify.put(
    '/scenarios/:scenarioId',
    {
      schema: {
        description: 'Update a test scenario',
        tags: ['Scenarios'],
        params: Type.Object({
          id: Type.String({ description: 'Project ID' }),
          scenarioId: Type.String({ description: 'Scenario ID' }),
        }),
        body: Type.Object({
          name: Type.String({ minLength: 1, description: 'Scenario name' }),
          description: Type.Optional(Type.String({ description: 'Scenario description' })),
          preconditions: Type.Optional(Type.Array(Type.String(), { description: 'Pre-conditions' })),
          expected_results: Type.Optional(Type.Array(Type.String(), { description: 'Expected results' })),
        }),
        response: {
          200: Type.Object({
            id: Type.String(),
            functional_module_id: Type.String(),
            name: Type.String(),
            description: Type.String(),
            preconditions: Type.Optional(Type.Array(Type.String())),
            expected_results: Type.Optional(Type.Array(Type.String())),
            created_at: Type.String(),
            updated_at: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId, scenarioId } = request.params as { id: string; scenarioId: string };
      requireProject(projectId);

      const body = request.body as {
        name: string;
        description?: string;
        preconditions?: string[];
        expected_results?: string[];
      };

      const updated = getScenarioService().updateScenario(scenarioId, body);
      if (!updated) {
        throw ServiceError.notFound(`Scenario '${scenarioId}' not found`);
      }

      return reply.status(200).send(updated);
    },
  );

  // GET /modules/:moduleId/scenarios — list scenarios for a functional module
  fastify.get(
    '/modules/:moduleId/scenarios',
    {
      schema: {
        description: 'List test scenarios for a functional module',
        tags: ['Scenarios'],
        params: Type.Object({
          id: Type.String({ description: 'Project ID' }),
          moduleId: Type.String({ description: 'Functional module ID' }),
        }),
        response: {
          200: Type.Object({
            scenarios: Type.Array(Type.Object({
              id: Type.String(),
              functional_module_id: Type.String(),
              name: Type.String(),
              description: Type.String(),
              preconditions: Type.Optional(Type.Array(Type.String())),
              expected_results: Type.Optional(Type.Array(Type.String())),
              created_at: Type.String(),
              updated_at: Type.String(),
            })),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId, moduleId } = request.params as { id: string; moduleId: string };
      requireProject(projectId);

      const scenarios = getScenarioService().listScenariosByModule(moduleId);

      return reply.status(200).send({ scenarios });
    },
  );
};

export default fp(routes, { fastify: '5.x', name: 'scenario-routes', encapsulate: true });
