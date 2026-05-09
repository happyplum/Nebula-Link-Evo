import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DatabaseManager } from '../../../database/db.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import projectConfigRoutes from '../../routes/project-config.js';
import type { LoginRecorderService } from '../../../services/login-recorder-service.js';

const apps = new Set<FastifyInstance>();

async function buildApp(options?: { loginRecorder?: LoginRecorderService }): Promise<FastifyInstance> {
  const Fastify = (await import('fastify')).default;
  const app = Fastify().withTypeProvider<import('@fastify/type-provider-typebox').TypeBoxTypeProvider>();
  app.register(errorHandlerPlugin);
  app.register(projectConfigRoutes, {
    prefix: '/api/projects/:id/config',
    loginRecorder: options?.loginRecorder,
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

describe('GET /api/projects/:id/config', () => {
  it('returns target config for a configured project', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    db.getProjectRepo().create({
      name: 'Test',
      target_base_url: 'https://example.com',
      auth_config_json: JSON.stringify({ authType: 'basic' }),
      status: 'configuring',
    });
    const project = db.getProjectRepo().findAll()[0];

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/config`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.base_url).toBe('https://example.com');
    expect(body.auth_type).toBe('basic');
  });

  it('returns empty config for draft project', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Draft' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/config`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().base_url).toBe('');
  });

  it('returns 404 for non-existent project', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/nonexistent/config',
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/projects/:id/config', () => {
  it('updates target config and transitions to configuring', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Config Me' });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/config`,
      payload: {
        base_url: 'https://app.example.com',
        auth_type: 'cookie',
        seed_urls: ['/login', '/home'],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.target_base_url).toBe('https://app.example.com');
    expect(body.status).toBe('configuring');
  });

  it('returns 404 for non-existent project', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/nonexistent/config',
      payload: { base_url: 'https://example.com' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/projects/:id/config/login-script', () => {
  it('saves a login script', async () => {
    const app = await buildApp();
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().create({ name: 'Login' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/config/login-script`,
      payload: {
        name: 'My Login',
        steps: [
          { type: 'navigate', description: 'Go to login', url: 'https://example.com/login' },
          { type: 'fill', description: 'Enter email', selector: '#email', value: 'test@test.com' },
          { type: 'click', description: 'Submit', selector: '#submit' },
        ],
        is_reusable: true,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('My Login');
    expect(body.steps).toHaveLength(3);
    expect(body.is_reusable).toBe(true);
  });

  it('returns 404 for non-existent project', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/nonexistent/config/login-script',
      payload: {
        name: 'Test',
        steps: [],
        is_reusable: false,
      },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/projects/:id/config/login-script/test', () => {
  it('returns success when replay succeeds', async () => {
    const mockLoginRecorder = {
      replayLogin: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as LoginRecorderService;

    const app = await buildApp({ loginRecorder: mockLoginRecorder });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/some-project/config/login-script/test',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
  });

  it('returns error when replay fails', async () => {
    const mockLoginRecorder = {
      replayLogin: vi.fn().mockResolvedValue({ success: false, error: 'Script not found' }),
    } as unknown as LoginRecorderService;

    const app = await buildApp({ loginRecorder: mockLoginRecorder });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/some-project/config/login-script/test',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
    expect(res.json().error).toBe('Script not found');
  });

  it('returns 500 when login recorder is not configured', async () => {
    const app = await buildApp(); // no loginRecorder

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/some-project/config/login-script/test',
    });

    expect(res.statusCode).toBe(500);
  });
});
