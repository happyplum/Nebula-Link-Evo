import type { FastifyPluginAsync } from 'fastify';
import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_ROOM = process.env.LIVEKIT_ROOM_NAME || 'nebula-link-screen';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/livekit-token',
    {
      schema: {
        description: 'Get LiveKit access token for debug-ui',
        tags: ['LiveKit'],
        summary: 'Get LiveKit token',
        response: {
          200: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              room: { type: 'string' },
              url: { type: 'string' },
              serverActive: { type: 'boolean' },
            },
            required: ['token', 'room', 'url', 'serverActive'],
          },
        },
      },
    },
    async () => {
      const accessToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: `debug-ui-${Date.now()}`,
      });
      accessToken.addGrant({ roomJoin: true, room: LIVEKIT_ROOM });

      return {
        token: await accessToken.toJwt(),
        room: LIVEKIT_ROOM,
        url: LIVEKIT_URL,
        serverActive: true,
      };
    }
  );
};

export default routes;
