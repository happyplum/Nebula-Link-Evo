import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import swaggerPlugin from './plugins/02-swagger.plugin.js';
import actionRoutesPlugin from './plugins/routes/action.js';
import browserRoutesPlugin from './plugins/routes/browser.js';
import cdpRoutesPlugin from './plugins/routes/cdp.js';
import debugStreamRoutesPlugin from './plugins/routes/debug-stream.js';
import domRoutesPlugin from './plugins/routes/dom.js';
import healthRoutesPlugin from './plugins/routes/health.js';
import livekitTokenRoutes from './plugins/routes/livekit-token.js';
import streamRoutesPlugin from './plugins/routes/stream.js';
import { BrowserService } from './services/browser-service.js';
import { debugEventHub } from './services/debug-event-hub.js';

const app = Fastify({
  logger: {
    level: 'warn',
  },
});

const PORT = parseInt(process.env.PLAYWRIGHT_PORT || '3001');

async function start() {
  try {
    await app.register(cors, {
      origin: true,
      credentials: true,
    });

    await app.register(websocket);
    await app.register(swaggerPlugin);

    await app.register(browserRoutesPlugin, { prefix: '/browser' });
    await app.register(actionRoutesPlugin, { prefix: '/action' });
    await app.register(domRoutesPlugin, { prefix: '/dom' });
    await app.register(domRoutesPlugin, { prefix: '/execute' });
    await app.register(healthRoutesPlugin, { prefix: '/health' });
    await app.register(streamRoutesPlugin, { prefix: '/browser' });
    await app.register(cdpRoutesPlugin);
    await app.register(debugStreamRoutesPlugin, { prefix: '/internal/debug' });
    await app.register(livekitTokenRoutes);

    BrowserService.getInstance().setOnStateChange(async (reason) => {
      debugEventHub.publish({
        type: 'debug.status',
        status: await BrowserService.getInstance().getDebugStatus(reason),
        emittedAt: new Date().toISOString(),
      });
    });

    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info({ port: PORT }, 'Playwright Server running');
    app.log.info({ port: PORT }, 'CDP WebSocket endpoint available');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  app.log.info('Shutting down gracefully...');
  await app.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  app.log.info('Shutting down gracefully...');
  await app.close();
  process.exit(0);
});

start();
