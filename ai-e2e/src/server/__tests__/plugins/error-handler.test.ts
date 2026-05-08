import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ServiceError } from '../../../services/service-error.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';

const apps = new Set<FastifyInstance>();

afterEach(async () => {
  await Promise.all(Array.from(apps, async app => app.close()));
  apps.clear();
});

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify();
  apps.add(app);
  await app.register(errorHandlerPlugin);
  return app;
}

describe('error-handler plugin', () => {
  it('maps ServiceError 404 responses', async () => {
    const app = await createApp();
    app.get('/missing', async () => {
      throw ServiceError.notFound('project missing');
    });

    const response = await app.inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'project missing',
      },
    });
  });

  it('maps ServiceError 400 responses with details', async () => {
    const app = await createApp();
    app.get('/validation', async () => {
      throw ServiceError.validation('invalid payload', ['name is required']);
    });

    const response = await app.inject({ method: 'GET', url: '/validation' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'invalid payload',
        details: ['name is required'],
      },
    });
  });

  it('falls back to 500 for plain errors', async () => {
    const app = await createApp();
    app.get('/plain', async () => {
      throw new Error('unexpected');
    });

    const response = await app.inject({ method: 'GET', url: '/plain' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'unexpected',
      },
    });
  });

  it('uses statusCode from non-service Fastify-style errors', async () => {
    const app = await createApp();
    app.get('/rate-limit', async () => {
      const error = new Error('Too many requests') as Error & { statusCode: number };
      error.statusCode = 429;
      throw error;
    });

    const response = await app.inject({ method: 'GET', url: '/rate-limit' });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Too many requests',
      },
    });
  });

  it('registers a 404 not found handler', async () => {
    const app = await createApp();

    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET:/does-not-exist not found',
      },
    });
  });
});
