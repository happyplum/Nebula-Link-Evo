import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DatabaseManager } from '../../../database/db.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import sseEmitterPlugin from '../../plugins/sse-emitter.js';
import { default as explorationRoutes } from '../exploration.js';

// ---------- Mocks ----------

const mockExplorerService = {
  startExploration: vi.fn(),
  stopExploration: vi.fn(),
  getExplorationStatus: vi.fn(),
  getDiscoveredURLs: vi.fn(),
  proposeBindings: vi.fn(),
  confirmBinding: vi.fn(),
  rejectBinding: vi.fn(),
};

vi.mock('../../../services/explorer-service.js', () => ({
  ExplorerService: vi.fn(function () { return mockExplorerService; }),
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
  app.register(explorationRoutes, { prefix: '/api/projects/:id/exploration' });
  await app.ready();
  apps.add(app);
  return app;
}

const PROJECT_ID = 'proj-001';

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

describe('POST /start', () => {
  it('starts exploration and returns session', async () => {
    const app = await buildApp();

    const session = {
      id: 'sess-001',
      project_id: PROJECT_ID,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '',
      pages_visited_json: '',
      urls_discovered_json: '',
      strategy_used: 'bfs',
      token_count: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    mockExplorerService.startExploration.mockResolvedValue(session);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/exploration/start`,
      payload: { maxDepth: 2, seedUrls: ['/about'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(session);
    expect(mockExplorerService.startExploration).toHaveBeenCalledWith(PROJECT_ID, {
      maxDepth: 2,
      seedUrls: ['/about'],
    });
  });

  it('starts exploration with empty options', async () => {
    const app = await buildApp();

    const session = {
      id: 'sess-002',
      project_id: PROJECT_ID,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '',
      pages_visited_json: '',
      urls_discovered_json: '',
      strategy_used: 'bfs',
      token_count: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    mockExplorerService.startExploration.mockResolvedValue(session);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/exploration/start`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(mockExplorerService.startExploration).toHaveBeenCalledWith(PROJECT_ID, {});
  });
});

describe('GET /urls', () => {
  it('returns discovered URLs', async () => {
    const app = await buildApp();

    const urls = [
      { id: 'url-001', project_id: PROJECT_ID, url: 'https://example.com/', title: 'Home', created_at: '2026-01-01T00:00:00.000Z' },
    ];
    mockExplorerService.getDiscoveredURLs.mockReturnValue(urls);

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/exploration/urls`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(urls);
    expect(mockExplorerService.getDiscoveredURLs).toHaveBeenCalledWith(PROJECT_ID);
  });
});

describe('GET /bindings', () => {
  it('returns URL bindings', async () => {
    const app = await buildApp();

    const db = DatabaseManager.getInstance();
    // Seed parent records for FK constraints
    db.getDatabase().prepare(
      "INSERT OR IGNORE INTO projects (id, name, status, created_at, updated_at) VALUES (?, 'Test', 'draft', datetime('now'), datetime('now'))"
    ).run(PROJECT_ID);
    db.getDatabase().prepare(
      "INSERT OR IGNORE INTO business_modules (id, project_id, name, created_at) VALUES (?, ?, 'BM1', datetime('now'))"
    ).run('bm-001', PROJECT_ID);
    const url = db.getURLRepo().create({ project_id: PROJECT_ID, url: 'https://example.com/' });
    const fm = db.getFunctionalModuleRepo().create({ business_module_id: 'bm-001', name: 'FM1' });
    const binding = db.getURLModuleBindingRepo().create({
      url_id: url.id,
      functional_module_id: fm.id,
      status: 'ai_proposed',
      confidence_score: 0.9,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/exploration/bindings`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(binding.id);
  });
});

describe('PUT /bindings/:bindingId', () => {
  it('confirms a binding', async () => {
    const app = await buildApp();

    const confirmedBinding = {
      id: 'bind-001',
      url_id: 'url-001',
      functional_module_id: 'fm-001',
      status: 'human_confirmed',
      confidence_score: 0.9,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    mockExplorerService.confirmBinding.mockReturnValue(confirmedBinding);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${PROJECT_ID}/exploration/bindings/bind-001`,
      payload: { action: 'confirm' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(confirmedBinding);
    expect(mockExplorerService.confirmBinding).toHaveBeenCalledWith('bind-001');
  });

  it('rejects a binding', async () => {
    const app = await buildApp();

    const rejectedBinding = {
      id: 'bind-001',
      url_id: 'url-001',
      functional_module_id: 'fm-001',
      status: 'rejected',
      confidence_score: 0.9,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    mockExplorerService.rejectBinding.mockReturnValue(rejectedBinding);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${PROJECT_ID}/exploration/bindings/bind-001`,
      payload: { action: 'reject' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(rejectedBinding);
    expect(mockExplorerService.rejectBinding).toHaveBeenCalledWith('bind-001');
  });
});

describe('POST /urls', () => {
  it('manually adds a URL', async () => {
    const app = await buildApp();

    const db = DatabaseManager.getInstance();
    db.getDatabase().prepare(
      "INSERT OR IGNORE INTO projects (id, name, status, created_at, updated_at) VALUES (?, 'Test', 'draft', datetime('now'), datetime('now'))"
    ).run(PROJECT_ID);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/exploration/urls`,
      payload: { url: 'https://example.com/contact', title: 'Contact' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.url).toBe('https://example.com/contact');
    expect(body.title).toBe('Contact');
    expect(body.project_id).toBe(PROJECT_ID);
  });
});

describe('POST /bind', () => {
  it('manually creates a binding', async () => {
    const app = await buildApp();

    const db = DatabaseManager.getInstance();
    db.getDatabase().prepare(
      "INSERT OR IGNORE INTO projects (id, name, status, created_at, updated_at) VALUES (?, 'Test', 'draft', datetime('now'), datetime('now'))"
    ).run(PROJECT_ID);
    db.getDatabase().prepare(
      "INSERT OR IGNORE INTO business_modules (id, project_id, name, created_at) VALUES (?, ?, 'BM1', datetime('now'))"
    ).run('bm-001', PROJECT_ID);
    const url = db.getURLRepo().create({ project_id: PROJECT_ID, url: 'https://example.com/' });
    const fm = db.getFunctionalModuleRepo().create({ business_module_id: 'bm-001', name: 'FM1' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/exploration/bind`,
      payload: { url_id: url.id, functional_module_id: fm.id },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.url_id).toBe(url.id);
    expect(body.functional_module_id).toBe(fm.id);
    expect(body.status).toBe('human_confirmed');
  });
});

describe('DELETE /bindings/:bindingId', () => {
  it('deletes a binding', async () => {
    const app = await buildApp();

    const db = DatabaseManager.getInstance();
    db.getDatabase().prepare(
      "INSERT OR IGNORE INTO projects (id, name, status, created_at, updated_at) VALUES (?, 'Test', 'draft', datetime('now'), datetime('now'))"
    ).run(PROJECT_ID);
    db.getDatabase().prepare(
      "INSERT OR IGNORE INTO business_modules (id, project_id, name, created_at) VALUES (?, ?, 'BM1', datetime('now'))"
    ).run('bm-001', PROJECT_ID);
    const url = db.getURLRepo().create({ project_id: PROJECT_ID, url: 'https://example.com/' });
    const fm = db.getFunctionalModuleRepo().create({ business_module_id: 'bm-001', name: 'FM1' });
    const binding = db.getURLModuleBindingRepo().create({
      url_id: url.id,
      functional_module_id: fm.id,
      status: 'ai_proposed',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${PROJECT_ID}/exploration/bindings/${binding.id}`,
    });

    expect(res.statusCode).toBe(204);

    // Verify binding is deleted from DB
    const found = db.getURLModuleBindingRepo().findById(binding.id);
    expect(found).toBeNull();
  });

  it('returns 404 for non-existent binding', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${PROJECT_ID}/exploration/bindings/nonexistent`,
    });

    expect(res.statusCode).toBe(404);
  });
});
