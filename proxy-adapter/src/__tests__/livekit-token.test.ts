import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('GET /api/v1/livekit-token (inline signing)', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Force re-evaluation of route module top-level env consts
    vi.resetModules();
    process.env.LIVEKIT_API_KEY = 'test-key';
    process.env.LIVEKIT_API_SECRET = 'test-secret';
    process.env.LIVEKIT_ROOM_NAME = 'test-room';
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
  });

  afterEach(() => {
    // Restore original env, drop test-only LIVEKIT_* overrides
    for (const k of Object.keys(savedEnv)) process.env[k] = savedEnv[k];
    for (const k of Object.keys(process.env)) {
      if (!(k in savedEnv) && k.startsWith('LIVEKIT_')) delete process.env[k];
    }
  });

  it('signs a token inline and returns the full response shape', async () => {
    const Fastify = (await import('fastify')).default;
    const livekitTokenRoute = (await import('../plugins/routes/api/livekit-token.js')).default;
    const app = Fastify();
    await app.register(livekitTokenRoute, { prefix: '/api/v1' });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/v1/livekit-token' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toEqual(expect.any(String));
    // JWT shape: header.payload.signature
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.room).toBe('test-room');
    expect(body.url).toBe('ws://localhost:7880');
    expect(body.serverActive).toBe(true);

    await app.close();
  });

  it('returns 500 when LiveKit credentials are missing (no gateway crash)', async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    const Fastify = (await import('fastify')).default;
    const livekitTokenRoute = (await import('../plugins/routes/api/livekit-token.js')).default;
    const app = Fastify();
    await app.register(livekitTokenRoute, { prefix: '/api/v1' });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/v1/livekit-token' });

    expect(response.statusCode).toBe(500);

    await app.close();
  });
});
