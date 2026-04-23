import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import dotenv from 'dotenv';
import swaggerPlugin from './plugins/02-swagger.plugin.js';
import browserRoutesPlugin from './plugins/routes/browser.js';
import actionRoutesPlugin from './plugins/routes/action.js';
import domRoutesPlugin from './plugins/routes/dom.js';
import healthRoutesPlugin from './plugins/routes/health.js';
import streamRoutesPlugin from './plugins/routes/stream.js';
import cdpRoutesPlugin from './plugins/routes/cdp.js';
import livekitTokenRoutes from './plugins/routes/livekit-token.js';

dotenv.config();

const app = Fastify({
  logger: {
    level: 'warn',
  },
});

const PORT = parseInt(process.env.PLAYWRIGHT_PORT || '3001');

async function start() {
  try {
    // Register CORS
    await app.register(cors, {
      origin: true,
      credentials: true,
    });

    // Register WebSocket support
    await app.register(websocket);

    // Register swagger plugin
    await app.register(swaggerPlugin);

    // Register route plugins
    await app.register(browserRoutesPlugin, { prefix: '/browser' });
    await app.register(actionRoutesPlugin, { prefix: '/action' });
    await app.register(domRoutesPlugin, { prefix: '/dom' });
    await app.register(domRoutesPlugin, { prefix: '/execute' });
    await app.register(healthRoutesPlugin, { prefix: '/health' });
    await app.register(streamRoutesPlugin, { prefix: '/browser' });
    await app.register(cdpRoutesPlugin);
    await app.register(livekitTokenRoutes);

    // Start server
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info({ port: PORT }, 'Playwright Server running');
    app.log.info({ port: PORT }, 'CDP WebSocket endpoint available');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
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
