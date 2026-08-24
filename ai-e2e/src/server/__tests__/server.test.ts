import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ServiceError } from '../../services/service-error.js';
import { createServer } from '../index.js';

const apps = new Set<FastifyInstance>();

afterEach(async () => {
  await Promise.all(Array.from(apps, async app => app.close()));
  apps.clear();
});

describe('createServer', () => {
  it('does not expose the removed legacy project API', async () => {
    const app = createServer();
    apps.add(app);

    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(response.statusCode).toBe(404);
  });

  it('registers CORS with credentials support', async () => {
    const app = createServer();
    apps.add(app);

    app.get('/cors-check', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/cors-check',
      headers: {
        origin: 'http://example.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://example.com');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('integrates the error handler for service errors', async () => {
    const app = createServer();
    apps.add(app);

    app.get('/boom', async () => {
      throw new ServiceError('exploded', 409, 'CONFLICT', ['duplicate']);
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'conflict',
      message: 'exploded',
      details: { errors: ['duplicate'] },
      retryable: false,
    });
  });
});
