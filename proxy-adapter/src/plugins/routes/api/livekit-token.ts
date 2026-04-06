import type { FastifyPluginAsync } from 'fastify';

const PLAYWRIGHT_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 3001}`;

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/livekit-token',
    {
      schema: {
        description: 'Get LiveKit token from playwright-server',
        tags: ['LiveKit'],
        summary: 'Get LiveKit token',
      },
    },
    async (request, reply) => {
      try {
        const res = await fetch(`${PLAYWRIGHT_URL}/livekit-token`);
        if (!res.ok) {
          return reply.status(res.status).send({ error: 'Failed to get LiveKit token' });
        }
        const data = await res.json();
        return reply.send(data);
      } catch {
        return reply.status(502).send({ error: 'Playwright server unavailable' });
      }
    }
  );
};

export default routes;
