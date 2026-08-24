import type { FastifyPluginAsync } from 'fastify';
import { AccessToken } from 'livekit-server-sdk';
import { BrowserService } from '../../../browser-engine/services/browser-service.js';
import { isPublisherActive, startPublisher } from '../../../services/livekit-publisher.js';

// Env vars are read at call sites, not module level, to ensure dotenv has loaded.

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/livekit-token',
    {
      schema: {
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
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      const room = process.env.LIVEKIT_ROOM_NAME || 'nebula-link-screen';
      const url = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';

      if (!apiKey || !apiSecret) {
        throw new Error(
          'LIVEKIT_API_KEY and LIVEKIT_API_SECRET environment variables are required'
        );
      }
      const accessToken = new AccessToken(apiKey, apiSecret, {
        identity: `debug-ui-${Date.now()}`,
      });
      accessToken.addGrant({ roomJoin: true, room });

      if (!isPublisherActive()) {
        const page = BrowserService.getInstance().getPage();
        if (page && !page.isClosed()) {
          const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
          void startPublisher(page, viewport).catch((error) => {
            fastify.log.warn({ err: error }, 'LiveKit publisher recovery failed');
          });
        }
      }

      return {
        token: await accessToken.toJwt(),
        room,
        url,
        serverActive: true,
      };
    }
  );
};

export default routes;
