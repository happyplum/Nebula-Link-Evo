import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DatabaseManager } from '../../../database/db.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import projectRoutes from '../projects.js';

const apps = new Set<FastifyInstance>();

async function buildApp(): Promise<FastifyInstance> {
  const Fastify = (await import('fastify')).default;
  const app = Fastify().withTypeProvider<import('@fastify/type-provider-typebox').TypeBoxTypeProvider>();
  app.register(errorHandlerPlugin);
  app.register(projectRoutes, { prefix: '/api/projects' });
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

describe('GET /api/projects', () => {
  it('returns empty list when no projects exist', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/projects' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      projects: [],
      total: 0,
      page: 1,
      page_size: 20,
    });
  });

  it('returns created projects with pagination', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();

    // Seed 3 projects
    db.getProjectRepo().create({ name: 'Project A' });
    db.getProjectRepo().create({ name: 'Project B' });
    db.getProjectRepo().create({ name: 'Project C' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects?page=1&page_size=2',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.projects).toHaveLength(2);
    expect(body.page).toBe(1);
    expect(body.page_size).toBe(2);
  });
});

describe('POST /api/projects', () => {
  it('creates a project with name only', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'New Project' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('New Project');
    expect(body.status).toBe('draft');
    expect(body.id).toBeTruthy();
  });

  it('creates a project with target_base_url', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'With URL', target_base_url: 'https://example.com' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().target_base_url).toBe('https://example.com');
  });

  it('returns 400 when name is missing', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/projects/:id', () => {
  it('returns project by id', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Find Me' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Find Me');
  });

  it('returns 404 for non-existent project', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/nonexistent',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('PUT /api/projects/:id', () => {
  it('updates project name', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Original' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}`,
      payload: { name: 'Updated' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Updated');
  });

  it('returns 404 for non-existent project', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/nonexistent',
      payload: { name: 'Updated' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/projects/:id', () => {
  it('deletes an existing project', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Delete Me' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}`,
    });

    expect(res.statusCode).toBe(204);

    // Verify deleted
    const found = db.getProjectRepo().findById(project.id);
    expect(found).toBeNull();
  });

  it('returns 404 for non-existent project', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/projects/nonexistent',
    });

    expect(res.statusCode).toBe(404);
  });
});
