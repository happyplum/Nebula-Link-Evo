import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig } from './config/index.js';
import { conversationDatabase } from './db/index.js';

const VERSION = '0.1.0';

const envLocal = path.join(process.cwd(), '.env');
const envRoot = path.join(process.cwd(), '..', '.env');

if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
} else if (fs.existsSync(envRoot)) {
  dotenv.config({ path: envRoot });
} else {
  dotenv.config();
}

const config = loadConfig();

const app = Fastify({
  logger: { level: config.logLevel },
  disableRequestLogging: true,
});

async function start(): Promise<void> {
  try {
    await app.register(cors, {
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      credentials: true,
    });

    conversationDatabase.initialize();

    app.get('/health', async () => ({
      status: 'ok',
      service: 'ai-chat-service',
      version: VERSION,
    }));

    app.get('/config', async () => ({
      service: 'ai-chat-service',
      version: VERSION,
      port: config.port,
      host: config.host,
      logLevel: config.logLevel,
      gatewayUrl: config.gatewayUrl,
      // API keys are sensitive: expose only enabled + baseUrl + configured flag.
      providers: Object.fromEntries(
        Object.entries(config.providers).map(([alias, p]) => [
          alias,
          { enabled: p.enabled, baseUrl: p.baseUrl, apiKeyConfigured: p.apiKey.length > 0 },
        ])
      ),
    }));

    await app.listen({ port: config.port, host: config.host });
    app.log.info({ url: `http://localhost:${config.port}` }, 'ai-chat-service running');
    app.log.info('Available endpoints:');
    app.log.info({ endpoint: 'GET /health' });
    app.log.info({ endpoint: 'GET /config' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  app.log.info({ signal }, '[ai-chat-service] shutdown');
  await conversationDatabase.close();
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

start();
