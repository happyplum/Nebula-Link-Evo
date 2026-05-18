import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DatabaseManager } from '../../../database/db.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import sseEmitterPlugin from '../../plugins/sse-emitter.js';
import projectAnalysisRoutes from '../../routes/project-analysis.js';
import type { PRDAnalyzerService } from '../../../services/prd-analyzer-service.js';
import type { ProxyAdapterClient } from '../../../infrastructure/proxy-adapter-client.js';
import type { PromptTemplateManager } from '../../../ai/prompt-manager.js';
import { TokenBudgetTracker } from '../../../ai/token-tracker.js';

const apps = new Set<FastifyInstance>();

const mockProxyClient = {
  generateText: vi.fn(),
  navigate: vi.fn(),
  getSnapshot: vi.fn(),
  screenshot: vi.fn(),
  getPageInfo: vi.fn(),
  healthCheck: vi.fn(),
  click: vi.fn(),
  clickBySelector: vi.fn(),
  type: vi.fn(),
  executeScript: vi.fn(),
  getCookies: vi.fn(),
  getLocalStorage: vi.fn(),
  getDOM: vi.fn(),
  openBrowser: vi.fn(),
  closeBrowser: vi.fn(),
} as unknown as ProxyAdapterClient;

const mockPromptManager = {
  render: vi.fn(),
  load: vi.fn(),
  listTemplates: vi.fn(),
} as unknown as PromptTemplateManager;

const mockTokenTracker = new TokenBudgetTracker(100000);

// Shared mock instance that tests can configure
const mockAnalyzer = {
  analyzePRD: vi.fn().mockResolvedValue([]),
  getAnalysisResult: vi.fn().mockReturnValue({ businessModules: [] }),
  getFunctionalModules: vi.fn().mockReturnValue([]),
  decomposeBusinessModule: vi.fn().mockResolvedValue([]),
  generateTestScenarios: vi.fn().mockResolvedValue([]),
  getTokenTracker: vi.fn(),
} as unknown as PRDAnalyzerService;

vi.mock('../../../services/prd-analyzer-service.js', () => ({
  PRDAnalyzerService: vi.fn(function () { return mockAnalyzer; }),
}));

async function buildApp(): Promise<FastifyInstance> {
  const Fastify = (await import('fastify')).default;
  const app = Fastify().withTypeProvider<import('@fastify/type-provider-typebox').TypeBoxTypeProvider>();
  app.register(errorHandlerPlugin);
  app.register(sseEmitterPlugin);
  app.register(projectAnalysisRoutes, {
    prefix: '/api/projects/:id/analysis',
    proxyClient: mockProxyClient,
    promptManager: mockPromptManager,
    tokenTracker: mockTokenTracker,
  });
  apps.add(app);
  return app;
}

beforeEach(() => {
  DatabaseManager.resetInstance();
  DatabaseManager.getInstance().init(':memory:');
});

afterEach(async () => {
  DatabaseManager.resetInstance();
  await Promise.all(Array.from(apps, async app => app.close()));
  apps.clear();
});

describe('POST /api/projects/:id/analysis/upload', () => {
  it('uploads PRD content for a project', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'PRD Test' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/upload`,
      payload: {
        content: '# PRD Title\n\nSome requirements here.',
        format: 'markdown',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.project_id).toBe(project.id);
    expect(body.raw_content).toContain('PRD Title');
    expect(body.format).toBe('markdown');
  });

  it('returns 404 for non-existent project', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/nonexistent/analysis/upload',
      payload: { content: 'test' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when content is missing', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'PRD Test' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/upload`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/projects/:id/analysis/analyze', () => {
  it('calls prdAnalyzer.analyzePRD and returns modules', async () => {
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Analyze Me' });

    (mockAnalyzer.analyzePRD as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'bm-1', project_id: project.id, name: 'Auth Module', description: 'Authentication', sort_order: 0, source: 'ai_generated', created_at: '2026-01-01' },
    ]);

    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/analyze`,
      payload: { content: 'PRD content here', format: 'markdown' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.business_modules).toHaveLength(1);
    expect(body.business_modules[0].name).toBe('Auth Module');
  });

  it('returns 404 for non-existent project', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/nonexistent/analysis/analyze',
      payload: { content: 'test' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/projects/:id/analysis/modules', () => {
  it('returns module tree from prdAnalyzer', async () => {
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Modules' });

    (mockAnalyzer.getAnalysisResult as ReturnType<typeof vi.fn>).mockReturnValue({
      businessModules: [
        {
          id: 'bm-1',
          project_id: project.id,
          name: 'User Management',
          description: 'User management module',
          sort_order: 0,
          source: 'ai_generated',
          created_at: '2026-01-01',
          functionalModules: [
            {
              id: 'fm-1',
              business_module_id: 'bm-1',
              name: 'Login',
              description: 'Login flow',
              sort_order: 0,
              bound_url_id: null,
              source: 'ai_generated',
              created_at: '2026-01-01',
              testScenarios: [],
            },
          ],
        },
      ],
    });

    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/analysis/modules`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.business_modules).toHaveLength(1);
    expect(body.business_modules[0].functional_modules).toHaveLength(1);
    expect(mockAnalyzer.getAnalysisResult).toHaveBeenCalledWith(project.id);
  });

  it('returns 404 for non-existent project', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/nonexistent/analysis/modules',
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/projects/:id/analysis/modules/:moduleId', () => {
  it('updates a functional module name', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Update' });
    const bm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'BM' });
    const fm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Old Name' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/analysis/modules/${fm.id}`,
      payload: { name: 'New Name' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const updated = db.getFunctionalModuleRepo().findById(fm.id);
    expect(updated?.name).toBe('New Name');
  });

  it('returns 404 for non-existent module', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Update' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/analysis/modules/nonexistent`,
      payload: { name: 'Name' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/projects/:id/analysis/modules', () => {
  it('adds a business module', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Add' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/modules`,
      payload: { level: 'business', name: 'New Module', description: 'A new module' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeTruthy();

    const modules = db.getBusinessModuleRepo().findByProjectId(project.id);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('New Module');
    expect(modules[0].source).toBe('human_created');
  });

  it('adds a functional module under a business module', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Add FM' });
    const bm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'Parent BM' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/modules`,
      payload: { level: 'functional', name: 'New FM', parent_id: bm.id },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeTruthy();

    const fms = db.getFunctionalModuleRepo().findByBusinessModuleId(bm.id);
    expect(fms).toHaveLength(1);
    expect(fms[0].name).toBe('New FM');
  });

  it('returns 400 when parent_id is missing for functional module', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Add FM' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/modules`,
      payload: { level: 'functional', name: 'No Parent' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for non-existent parent business module', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Add FM' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/modules`,
      payload: { level: 'functional', name: 'Orphan', parent_id: 'nonexistent' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/projects/:id/analysis/modules/:moduleId', () => {
  it('deletes a business module', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Delete' });
    const bm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'To Delete' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}/analysis/modules/${bm.id}`,
    });

    expect(res.statusCode).toBe(204);
    expect(db.getBusinessModuleRepo().findById(bm.id)).toBeNull();
  });

  it('deletes a functional module', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Delete' });
    const bm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'Parent' });
    const fm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'To Delete' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}/analysis/modules/${fm.id}`,
    });

    expect(res.statusCode).toBe(204);
    expect(db.getFunctionalModuleRepo().findById(fm.id)).toBeNull();
  });

  it('returns 404 for non-existent module', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Delete' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}/analysis/modules/nonexistent`,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/projects/:id/analysis/decompose-all', () => {
  it('returns partial results with retries for failed business modules', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Batch Decompose' });
    const firstBm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'Existing BM' });
    const secondBm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'Retry BM' });
    db.getFunctionalModuleRepo().create({ business_module_id: firstBm.id, name: 'Existing FM', description: 'seeded' });

    const decomposeMock = mockAnalyzer.decomposeBusinessModule as ReturnType<typeof vi.fn>;
    decomposeMock.mockReset();
    decomposeMock
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce([
        {
          id: 'fm-retry',
          business_module_id: secondBm.id,
          name: 'Recovered FM',
          description: 'from retry',
          sort_order: 0,
          source: 'ai_generated',
          created_at: '2026-01-01',
        },
      ]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/decompose-all`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
    expect(body.results).toEqual([
      {
        business_module_id: firstBm.id,
        business_module_name: 'Existing BM',
        functional_modules: [
          { id: expect.any(String), name: 'Existing FM', description: 'seeded' },
        ],
      },
      {
        business_module_id: secondBm.id,
        business_module_name: 'Retry BM',
        functional_modules: [
          { id: 'fm-retry', name: 'Recovered FM', description: 'from retry' },
        ],
      },
    ]);
    expect(decomposeMock).toHaveBeenCalledTimes(2);
  });

  it('captures per-item errors without aborting the batch', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Batch Decompose Fail' });
    const firstBm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'Fail BM' });
    const secondBm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'Pass BM' });

    const decomposeMock = mockAnalyzer.decomposeBusinessModule as ReturnType<typeof vi.fn>;
    decomposeMock.mockReset();
    decomposeMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([
        {
          id: 'fm-pass',
          business_module_id: secondBm.id,
          name: 'Pass FM',
          description: null,
          sort_order: 0,
          source: 'ai_generated',
          created_at: '2026-01-01',
        },
      ]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/decompose-all`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(body.results).toEqual([
      {
        business_module_id: firstBm.id,
        business_module_name: 'Fail BM',
        error: 'boom',
      },
      {
        business_module_id: secondBm.id,
        business_module_name: 'Pass BM',
        functional_modules: [
          { id: 'fm-pass', name: 'Pass FM' },
        ],
      },
    ]);
    expect(decomposeMock).toHaveBeenCalledTimes(4);
  });
});

describe('POST /api/projects/:id/analysis/generate-all-scenarios', () => {
  it('returns partial results with retries for functional modules', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Batch Scenario' });
    const bm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'BM' });
    const firstFm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Existing FM' });
    const secondFm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Retry FM' });
    db.getTestScenarioRepo().create({ functional_module_id: firstFm.id, name: 'Existing Scenario', description: 'seeded' });

    const scenarioMock = mockAnalyzer.generateTestScenarios as ReturnType<typeof vi.fn>;
    scenarioMock.mockReset();
    scenarioMock
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce([
        {
          id: 'ts-retry',
          functional_module_id: secondFm.id,
          name: 'Recovered Scenario',
          description: 'from retry',
          sort_order: 0,
          source: 'ai_generated',
          created_at: '2026-01-01',
        },
      ]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/generate-all-scenarios`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
    expect(body.results).toEqual([
      {
        functional_module_id: firstFm.id,
        functional_module_name: 'Existing FM',
        scenarios: [
          { id: expect.any(String), name: 'Existing Scenario', description: 'seeded' },
        ],
      },
      {
        functional_module_id: secondFm.id,
        functional_module_name: 'Retry FM',
        scenarios: [
          { id: 'ts-retry', name: 'Recovered Scenario', description: 'from retry' },
        ],
      },
    ]);
    expect(scenarioMock).toHaveBeenCalledTimes(2);
  });

  it('captures scenario generation failures and continues the batch', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Batch Scenario Fail' });
    const bm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'BM' });
    const firstFm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Fail FM' });
    const secondFm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Pass FM' });

    const scenarioMock = mockAnalyzer.generateTestScenarios as ReturnType<typeof vi.fn>;
    scenarioMock.mockReset();
    scenarioMock
      .mockRejectedValueOnce(new Error('broken'))
      .mockRejectedValueOnce(new Error('broken'))
      .mockRejectedValueOnce(new Error('broken'))
      .mockResolvedValueOnce([
        {
          id: 'ts-pass',
          functional_module_id: secondFm.id,
          name: 'Pass Scenario',
          description: null,
          sort_order: 0,
          source: 'ai_generated',
          created_at: '2026-01-01',
        },
      ]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/generate-all-scenarios`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(body.results).toEqual([
      {
        functional_module_id: firstFm.id,
        functional_module_name: 'Fail FM',
        error: 'broken',
      },
      {
        functional_module_id: secondFm.id,
        functional_module_name: 'Pass FM',
        scenarios: [
          { id: 'ts-pass', name: 'Pass Scenario' },
        ],
      },
    ]);
    expect(scenarioMock).toHaveBeenCalledTimes(4);
  });
});

describe('PUT /api/projects/:id/analysis/modules/reorder', () => {
  it('reorders business modules', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Reorder' });
    const bm1 = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'First', sort_order: 0 });
    const bm2 = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'Second', sort_order: 1 });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/analysis/modules/reorder`,
      payload: { module_ids: [bm2.id, bm1.id], level: 'business' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const reordered = db.getBusinessModuleRepo().findByProjectId(project.id);
    expect(reordered[0].id).toBe(bm2.id);
    expect(reordered[1].id).toBe(bm1.id);
  });

  it('returns 400 when parent_id is missing for functional reorder', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Reorder' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/analysis/modules/reorder`,
      payload: { module_ids: ['a', 'b'], level: 'functional' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('reorders functional modules', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Reorder FM' });
    const bm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'Parent' });
    const fm1 = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'First', sort_order: 0 });
    const fm2 = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Second', sort_order: 1 });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/analysis/modules/reorder`,
      payload: { module_ids: [fm2.id, fm1.id], level: 'functional', parent_id: bm.id },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const reordered = db.getFunctionalModuleRepo().findByBusinessModuleId(bm.id);
    expect(reordered[0].id).toBe(fm2.id);
    expect(reordered[1].id).toBe(fm1.id);
  });

  it('updates a business module name', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Update BM' });
    const bm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'Old Name' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/analysis/modules/${bm.id}`,
      payload: { name: 'New Name' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const updated = db.getBusinessModuleRepo().findById(bm.id);
    expect(updated?.name).toBe('New Name');
  });

  it('updates a functional module description', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Update Desc' });
    const bm = db.getBusinessModuleRepo().create({ project_id: project.id, name: 'BM' });
    const fm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'FM' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/analysis/modules/${fm.id}`,
      payload: { description: 'New description' },
    });

    expect(res.statusCode).toBe(200);

    const updated = db.getFunctionalModuleRepo().findById(fm.id);
    expect(updated?.description).toBe('New description');
  });
});
