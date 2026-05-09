import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseManager } from '../database/db.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import sseEmitterPlugin from './plugins/sse-emitter.js';
import executionRoutes from './routes/execution.js';
import stateRoutes from './routes/state.js';
import explorationRoutes from './routes/exploration.js';
import scriptsRoutes from './routes/scripts.js';
import projectRoutes from './routes/projects.js';
import projectConfigRoutes from './routes/project-config.js';
import projectAnalysisRoutes from './routes/project-analysis.js';
import eventsRoutes from './routes/events.js';

const envLocalPath = path.join(process.cwd(), '.env.local');
const envRootPath = path.join(process.cwd(), '..', '.env');

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envRootPath)) {
  dotenv.config({ path: envRootPath });
} else {
  dotenv.config();
}

const DEFAULT_PORT = 3002;
const DEFAULT_DB_PATH = './data/ai-e2e.sqlite';

let shutdownHandlersRegistered = false;

function ensureDatabaseDirectory(dbPath: string): void {
  if (dbPath === ':memory:') {
    return;
  }

  const resolvedPath = path.resolve(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
}

export function createServer() {
  const app = Fastify({
    logger: true,
    disableRequestLogging: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.register(cors, {
    origin: true,
    credentials: true,
  });
  app.register(errorHandlerPlugin);
  app.register(sseEmitterPlugin);
  app.register(projectRoutes, { prefix: '/api/projects' });
  app.register(projectConfigRoutes, { prefix: '/api/projects/:id/config' });
  app.register(projectAnalysisRoutes, { prefix: '/api/projects/:id/analysis' });
  app.register(executionRoutes, { prefix: '/api/projects/:id/execution' });
  app.register(stateRoutes, { prefix: '/api/projects/:id/state' });
  app.register(explorationRoutes, { prefix: '/api/projects/:id/exploration' });
  app.register(scriptsRoutes, { prefix: '/api/projects/:id/scripts' });
  app.register(eventsRoutes, { prefix: '/api/projects/:id/events' });

  // Serve built frontend (ui/dist/) at /ai-e2e/ prefix
  const uiDistPath = path.join(__dirname, '..', '..', 'ui', 'dist');
  app.register(fastifyStatic, {
    root: uiDistPath,
    prefix: '/ai-e2e/',
    wildcard: false,
  });

  // SPA catch-all: serve index.html for any unmatched /ai-e2e/* route
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/ai-e2e/')) {
      return reply.sendFile('index.html');
    }
    reply.code(404).send({ error: 'Not Found' });
  });

  return app;
}

type AppServer = ReturnType<typeof createServer>;

function registerGracefulShutdown(app: AppServer, databaseManager: DatabaseManager): void {
  if (shutdownHandlersRegistered) {
    return;
  }

  shutdownHandlersRegistered = true;
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down AI E2E server');

    try {
      databaseManager.close();
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error, signal }, 'Failed to shut down AI E2E server cleanly');
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

export async function start() {
  const app = createServer();
  const databaseManager = DatabaseManager.getInstance();
  const port = Number.parseInt(process.env.AI_E2E_PORT ?? `${DEFAULT_PORT}`, 10);
  const dbPath = process.env.AI_E2E_DB_PATH ?? DEFAULT_DB_PATH;

  try {
    ensureDatabaseDirectory(dbPath);
    databaseManager.init(dbPath);
    registerGracefulShutdown(app, databaseManager);

    await app.listen({
      port,
      host: '0.0.0.0',
    });

    app.log.info({ port, dbPath }, 'AI E2E server listening');
    return app;
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start AI E2E server');
    databaseManager.close();
    await app.close();
    throw error;
  }
}
