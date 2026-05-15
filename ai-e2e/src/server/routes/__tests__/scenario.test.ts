import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DatabaseManager } from '../../../database/db.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import sseEmitterPlugin from '../../plugins/sse-emitter.js';
import scenarioRoutes from '../scenario.js';
import type { TestScenarioService } from '../../../services/test-scenario-service.js';
import type { TestScenario } from '../../../types/test-scenario.js';

const apps = new Set<FastifyInstance>();

function createApp(): FastifyInstance {
  const app = Fastify()
    .withTypeProvider<TypeBoxTypeProvider>();
  app.register(errorHandlerPlugin);
  app.register(sseEmitterPlugin);
  apps.add(app);
  return app;
}

beforeEach(() => {
  DatabaseManager.resetInstance();
});

afterEach(async () => {
  await Promise.all(Array.from(apps, async app => app.close()));
  apps.clear();
  DatabaseManager.resetInstance();
});

function seedProject(db: DatabaseManager, status = 'ready'): string {
  db.getProjectRepo().create({ name: 'Test Project', target_base_url: 'http://example.com', status });
  const projects = db.getProjectRepo().findAll();
  return projects[0].id;
}

function makeMockScenarioService(overrides?: Partial<TestScenarioService>): TestScenarioService {
  return {
    getScenario: vi.fn(),
    updateScenario: vi.fn(),
    listScenariosByModule: vi.fn(),
    ...overrides,
  } as unknown as TestScenarioService;
}

const sampleScenario: TestScenario = {
  id: 'scenario-1',
  functional_module_id: 'fm-1',
  name: 'Login with valid credentials',
  description: 'Verify user can log in',
  preconditions: ['User account exists'],
  expected_results: ['User sees dashboard'],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('Scenario routes', () => {
  describe('GET /scenarios/:scenarioId', () => {
    it('returns scenario with parsed fields', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const scenarioService = makeMockScenarioService({
        getScenario: vi.fn().mockReturnValue(sampleScenario),
      });

      const app = createApp();
      app.register(scenarioRoutes, {
        prefix: '/api/projects/:id',
        scenarioService,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/scenarios/${sampleScenario.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe('scenario-1');
      expect(body.name).toBe('Login with valid credentials');
      expect(body.preconditions).toEqual(['User account exists']);
      expect(body.expected_results).toEqual(['User sees dashboard']);
      expect(scenarioService.getScenario).toHaveBeenCalledWith('scenario-1');
    });

    it('returns 404 for non-existent scenario', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const scenarioService = makeMockScenarioService({
        getScenario: vi.fn().mockReturnValue(null),
      });

      const app = createApp();
      app.register(scenarioRoutes, {
        prefix: '/api/projects/:id',
        scenarioService,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/scenarios/nonexistent`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /scenarios/:scenarioId', () => {
    it('updates scenario', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const updatedScenario: TestScenario = {
        ...sampleScenario,
        name: 'Updated name',
        preconditions: ['Updated precondition'],
        expected_results: ['Updated result'],
      };

      const scenarioService = makeMockScenarioService({
        updateScenario: vi.fn().mockReturnValue(updatedScenario),
      });

      const app = createApp();
      app.register(scenarioRoutes, {
        prefix: '/api/projects/:id',
        scenarioService,
      });

      const response = await app.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/scenarios/${sampleScenario.id}`,
        payload: {
          name: 'Updated name',
          preconditions: ['Updated precondition'],
          expected_results: ['Updated result'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe('Updated name');
      expect(body.preconditions).toEqual(['Updated precondition']);
      expect(body.expected_results).toEqual(['Updated result']);
      expect(scenarioService.updateScenario).toHaveBeenCalledWith('scenario-1', {
        name: 'Updated name',
        preconditions: ['Updated precondition'],
        expected_results: ['Updated result'],
      });
    });

    it('returns 400 validation error for empty name', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const scenarioService = makeMockScenarioService();

      const app = createApp();
      app.register(scenarioRoutes, {
        prefix: '/api/projects/:id',
        scenarioService,
      });

      const response = await app.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/scenarios/${sampleScenario.id}`,
        payload: {
          name: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for non-existent scenario', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const scenarioService = makeMockScenarioService({
        updateScenario: vi.fn().mockReturnValue(null),
      });

      const app = createApp();
      app.register(scenarioRoutes, {
        prefix: '/api/projects/:id',
        scenarioService,
      });

      const response = await app.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/scenarios/nonexistent`,
        payload: {
          name: 'New name',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /modules/:moduleId/scenarios', () => {
    it('lists scenarios for a module', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const scenarios = [sampleScenario];
      const scenarioService = makeMockScenarioService({
        listScenariosByModule: vi.fn().mockReturnValue(scenarios),
      });

      const app = createApp();
      app.register(scenarioRoutes, {
        prefix: '/api/projects/:id',
        scenarioService,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/modules/fm-1/scenarios`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.scenarios).toHaveLength(1);
      expect(body.scenarios[0].id).toBe('scenario-1');
      expect(body.scenarios[0].preconditions).toEqual(['User account exists']);
      expect(scenarioService.listScenariosByModule).toHaveBeenCalledWith('fm-1');
    });
  });
});
