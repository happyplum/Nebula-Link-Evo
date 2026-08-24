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
    expect(response.json()).toMatchObject({
      code: 'not_found',
      message: 'project missing',
      retryable: false,
    });
  });

  it('maps ServiceError 400 responses with details', async () => {
    const app = await createApp();
    app.get('/validation', async () => {
      throw ServiceError.validation('invalid payload', ['name is required']);
    });

    const response = await app.inject({ method: 'GET', url: '/validation' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_error',
      message: 'invalid payload',
      details: { errors: ['name is required'] },
      retryable: false,
    });
  });

  it('falls back to 500 for plain errors', async () => {
    const app = await createApp();
    app.get('/plain', async () => {
      throw new Error('unexpected');
    });

    const response = await app.inject({ method: 'GET', url: '/plain' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      code: 'internal_error',
      message: 'unexpected',
      retryable: true,
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
    expect(response.json()).toMatchObject({
      code: 'internal_error',
      message: 'Too many requests',
      retryable: true,
    });
  });

});
