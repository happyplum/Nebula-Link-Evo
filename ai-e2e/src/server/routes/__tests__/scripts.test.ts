import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DatabaseManager } from '../../../database/db.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import sseEmitterPlugin from '../../plugins/sse-emitter.js';
import { default as scriptsRoutes } from '../scripts.js';

// ---------- Mocks ----------

const mockScriptGeneratorService = {
  generateScript: vi.fn(),
  regenerateScript: vi.fn(),
  saveEditedScript: vi.fn(),
  getScriptHistory: vi.fn(),
  validateScriptSyntax: vi.fn(),
};

vi.mock('../../../services/script-generator-service.js', () => ({
  ScriptGeneratorService: vi.fn(function () { return mockScriptGeneratorService; }),
}));

// ---------- Helpers ----------

const apps = new Set<FastifyInstance>();

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.register(cors, { origin: true, credentials: true });
  app.register(errorHandlerPlugin);
  app.register(sseEmitterPlugin);
  app.register(scriptsRoutes, { prefix: '/api/projects/:id/scripts' });
  await app.ready();
  apps.add(app);
  return app;
}

const PROJECT_ID = 'proj-001';

function seedProject(): void {
  const db = DatabaseManager.getInstance();
  db.getDatabase().prepare(
    "INSERT OR IGNORE INTO projects (id, name, status, created_at, updated_at) VALUES (?, 'Test', 'draft', datetime('now'), datetime('now'))"
  ).run(PROJECT_ID);
}

beforeEach(() => {
  DatabaseManager.resetInstance();
  DatabaseManager.getInstance().init(':memory:');
  vi.clearAllMocks();
});

afterEach(async () => {
  DatabaseManager.resetInstance();
  await Promise.all(Array.from(apps, async app => app.close()));
  apps.clear();
});

// ---------- Tests ----------

describe('POST /generate', () => {
  it('generates a script for a specific scenario', async () => {
    const app = await buildApp();

    const script = {
      id: 'script-001',
      test_scenario_id: 'scenario-001',
      version: 1,
      content: "import { test } from '@playwright/test';\ntest('example', () => {});",
      language: 'ts',
      generated_by: 'ai_generated',
      status: 'generated',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    mockScriptGeneratorService.generateScript.mockResolvedValue(script);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/scripts/generate`,
      payload: { scenario_id: 'scenario-001' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(script);
    expect(mockScriptGeneratorService.generateScript).toHaveBeenCalledWith('scenario-001');
  });

  it('returns 400 when scenario_id is missing', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/scripts/generate`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /', () => {
  it('lists scripts grouped by functional module', async () => {
    const app = await buildApp();

    const db = DatabaseManager.getInstance();
    // Seed data: project → business module → functional module → scenario → script
    seedProject();
    const bm = db.getBusinessModuleRepo().create({ project_id: PROJECT_ID, name: 'BM1' });
    const fm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'FM1' });
    const scenario = db.getTestScenarioRepo().create({ functional_module_id: fm.id, name: 'Test 1' });
    db.getScriptRepo().create({ test_scenario_id: scenario.id, content: 'test content', generated_by: 'ai_generated' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/scripts`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].functional_module.id).toBe(fm.id);
    expect(body[0].scripts).toHaveLength(1);
    expect(body[0].scripts[0].test_scenario_id).toBe(scenario.id);
  });

  it('returns empty array when no scripts exist', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/scripts`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('GET /:scriptId', () => {
  it('returns script content', async () => {
    const app = await buildApp();

    const db = DatabaseManager.getInstance();
    seedProject();
    const bm = db.getBusinessModuleRepo().create({ project_id: PROJECT_ID, name: 'BM1' });
    const fm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'FM1' });
    const scenario = db.getTestScenarioRepo().create({ functional_module_id: fm.id, name: 'Test 1' });
    const script = db.getScriptRepo().create({ test_scenario_id: scenario.id, content: 'test content' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/scripts/${script.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(script.id);
    expect(body.content).toBe('test content');
  });

  it('returns 404 for non-existent script', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/scripts/nonexistent`,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /:scriptId', () => {
  it('saves a human-edited script', async () => {
    const app = await buildApp();

    const updatedScript = {
      id: 'script-001',
      test_scenario_id: 'scenario-001',
      version: 2,
      content: "import { test } from '@playwright/test';\ntest('edited', () => {});",
      language: 'ts',
      generated_by: 'human_edited',
      status: 'editing',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:01.000Z',
    };
    mockScriptGeneratorService.saveEditedScript.mockResolvedValue(updatedScript);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${PROJECT_ID}/scripts/script-001`,
      payload: { content: "import { test } from '@playwright/test';\ntest('edited', () => {});" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(updatedScript);
    expect(mockScriptGeneratorService.saveEditedScript).toHaveBeenCalledWith(
      'script-001',
      "import { test } from '@playwright/test';\ntest('edited', () => {});",
    );
  });
});

describe('GET /:scriptId/versions', () => {
  it('returns version history for a script', async () => {
    const app = await buildApp();

    const db = DatabaseManager.getInstance();
    seedProject();
    const bm = db.getBusinessModuleRepo().create({ project_id: PROJECT_ID, name: 'BM1' });
    const fm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'FM1' });
    const scenario = db.getTestScenarioRepo().create({ functional_module_id: fm.id, name: 'Test 1' });
    db.getScriptRepo().create({ test_scenario_id: scenario.id, content: 'v1', version: 1 });
    db.getScriptRepo().create({ test_scenario_id: scenario.id, content: 'v2', version: 2 });
    const latestScript = db.getScriptRepo().findLatestByScenarioId(scenario.id);

    const versions = [
      { id: 'script-002', version: 2, content: 'v2', generated_by: 'ai_generated', status: 'generated', created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
      { id: 'script-001', version: 1, content: 'v1', generated_by: 'ai_generated', status: 'generated', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ];
    mockScriptGeneratorService.getScriptHistory.mockResolvedValue(versions);

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/scripts/${latestScript!.id}/versions`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(versions);
    expect(mockScriptGeneratorService.getScriptHistory).toHaveBeenCalledWith(scenario.id);
  });

  it('returns 404 for non-existent script', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/scripts/nonexistent/versions`,
    });

    expect(res.statusCode).toBe(404);
  });
});
