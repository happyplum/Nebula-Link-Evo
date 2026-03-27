import type { FastifyPluginAsync } from 'fastify';
import { BrowserService } from '../../services/browser-service.js';
import { screencastManager } from '../../screencast.js';

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/stream', async (request, reply) => {
    const page = BrowserService.getInstance().getPage();

    if (!page) {
      reply.status(500);
      return { success: false, error: 'Browser not opened' };
    }

    if (!screencastManager.isActive()) {
      try {
        await screencastManager.start(page);
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }

    const headers = {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    reply.raw.writeHead(200, headers);

    screencastManager.addListener(reply.raw);

    request.raw.on('close', () => {
      screencastManager.removeListener(reply.raw);
    });
  });
};

export default routes;
