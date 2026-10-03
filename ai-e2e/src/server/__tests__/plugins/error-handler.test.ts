import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { DomainError, ServiceError } from '../../../services/service-error.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import { SemanticRunService } from '../../../services/semantic-run-service.js';
import { SemanticAuthoringService } from '../../../services/semantic-authoring-service.js';

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
  it.each(['run', 'authoring'])('keeps unknown %s failures internal even when they carry a database code', async mode => {
    const app = await createApp();
    const error = Object.assign(new Error('unexpected state conflict'), { code: 'SQLITE_CONSTRAINT' });
    const reject = () => { throw error; };
    const run = new SemanticRunService({ createFormalRun: reject } as never);
    const authoring = new SemanticAuthoringService({} as never, { createRevision: reject } as never, {} as never, {} as never);
    app.get('/unknown', () => mode === 'run' ? run.create({} as never) : authoring.createRevision({} as never));
    const response = await app.inject({ method: 'GET', url: '/unknown' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'internal_error', message: error.message, retryable: true });
  });

  it('keeps the existing Fastify request-validation code', async () => {
    const app = await createApp();
    app.post('/validated', { schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false } } }, () => ({}));
    const response = await app.inject({ method: 'POST', url: '/validated', payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'fst_err_validation', retryable: false });
  });
  it.each([
    ['not_found', 'not_found', 404],
    ['conflict', 'conflict', 409],
    ['validation_error', 'validation_error', 400],
    ['validation_error', 'side_effect_declaration_required', 400],
    ['validation_error', 'side_effect_bound_invalid', 400],
    ['conflict', 'side_effect_approval_required', 409],
    ['conflict', 'side_effect_approval_stale', 409],
    ['conflict', 'side_effect_approval_revoked', 409],
  ] as const)('maps domain %s/%s independently of its wording', async (kind, code, status) => {
    const app = await createApp();
    app.get('/domain', () => {
      throw new DomainError(kind, '全新中文说明', code, { scope: { revision: 9 }, extra: [1, 'future'] });
    });
    const response = await app.inject({ method: 'GET', url: '/domain', headers: { 'x-correlation-id': 'typed-domain' } });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ code, message: '全新中文说明', retryable: false, correlationId: 'typed-domain', details: { scope: { revision: 9 }, extra: [1, 'future'] } });
  });

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
