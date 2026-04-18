import { beforeEach, describe, expect, it, vi } from 'vitest';

const addGrantMock = vi.fn();
const toJwtMock = vi.fn().mockResolvedValue('generated-jwt');
const accessTokenMock = vi.fn().mockImplementation(function MockAccessToken() {
  return {
    addGrant: addGrantMock,
    toJwt: toJwtMock,
  };
});

vi.mock('livekit-server-sdk', () => ({
  AccessToken: accessTokenMock,
}));

describe('GET /livekit-token', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns a token payload for the debug UI', async () => {
    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    const routePlugin = (await import('../plugins/routes/livekit-token.js')).default;

    await app.register(routePlugin);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/livekit-token',
    });

    expect(response.statusCode).toBe(200);
    expect(accessTokenMock).toHaveBeenCalledTimes(1);
    expect(addGrantMock).toHaveBeenCalledWith({ roomJoin: true, room: 'nebula-link-screen' });
    expect(response.json()).toEqual({
      token: 'generated-jwt',
      room: 'nebula-link-screen',
      url: 'ws://127.0.0.1:7880',
      serverActive: true,
    });
  });

  // Token expiry was investigated and ruled out as a root cause of the blank-WebRTC issue
  it('creates a fresh AccessToken per request boundary', async () => {
    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    const routePlugin = (await import('../plugins/routes/livekit-token.js')).default;

    await app.register(routePlugin);
    await app.ready();

    // First request
    await app.inject({
      method: 'GET',
      url: '/livekit-token',
    });

    // Second request - should create a new AccessToken, not reuse cached
    await app.inject({
      method: 'GET',
      url: '/livekit-token',
    });

    // Verify that AccessToken was called twice (once per request, no caching)
    expect(accessTokenMock).toHaveBeenCalledTimes(2);
  });
});
