import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('GET /api/livekit-token', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should proxy token request to playwright-server', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        token: 'mock-token',
        room: 'test-room',
        url: 'ws://localhost:7880',
        serverActive: true,
      }),
      ok: true,
      status: 200,
    });

    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    const livekitTokenRoute = (await import('../plugins/routes/api/livekit-token.js')).default;
    await app.register(livekitTokenRoute, { prefix: '/api' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/livekit-token',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().token).toBe('mock-token');
  });

  it('should return 502 when playwright-server is unavailable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    const livekitTokenRoute = (await import('../plugins/routes/api/livekit-token.js')).default;
    await app.register(livekitTokenRoute, { prefix: '/api' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/livekit-token',
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe('Playwright server unavailable');
  });
});
