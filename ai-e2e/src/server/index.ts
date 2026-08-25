import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseManager } from '../database/db.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import businessVersionRoutes from './routes/business-versions.js';
import { BusinessVersionService } from '../services/business-version-service.js';
import semanticControlRoutes from './routes/semantic-control.js';
import { SemanticQueryService } from '../services/semantic-query-service.js';
import semanticAuthoringRoutes from './routes/semantic-authoring.js';
import { SemanticAuthoringService } from '../services/semantic-authoring-service.js';
import semanticRunRoutes from './routes/semantic-runs.js';
import { SemanticRunService } from '../services/semantic-run-service.js';
import { AgentTaskClient } from '../infrastructure/agent-task-client.js';
import { SemanticBrowserClient } from '../infrastructure/semantic-browser-client.js';
import { SemanticCoordinatorService } from '../services/semantic-coordinator-service.js';
import { SemanticAuthoringCandidateService } from '../services/semantic-authoring-candidate-service.js';
import semanticProjectRoutes from './routes/semantic-projects.js';
import { SemanticProjectService } from '../services/semantic-project-service.js';
import { SemanticEvidenceRetentionService } from '../services/semantic-evidence-retention-service.js';

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
const DEFAULT_DB_PATH = './data/ai-e2e-semantic.sqlite';
const DEFAULT_COORDINATOR_INTERVAL_MS = 500;
const DEFAULT_EVIDENCE_CLEANUP_INTERVAL_MS = 60_000;

let shutdownHandlersRegistered = false;

function ensureDatabaseDirectory(dbPath: string): void {
  if (dbPath === ':memory:') {
    return;
  }

  const resolvedPath = path.resolve(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
}

export interface ServerOptions {
  logger?: FastifyServerOptions['logger'];
  semanticProjectService?: SemanticProjectService;
  businessVersionService?: BusinessVersionService;
  semanticQueryService?: SemanticQueryService;
  semanticAuthoringService?: SemanticAuthoringService;
  semanticRunService?: SemanticRunService;
}

export function createServer(options: Partial<ServerOptions> = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    disableRequestLogging: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.register(cors, {
    origin: true,
    credentials: true,
  });
  app.register(errorHandlerPlugin);
  app.register(semanticProjectRoutes, {
    prefix: '/api/v1',
    service: options.semanticProjectService,
  });
  app.register(businessVersionRoutes, {
    prefix: '/api/v1',
    service: options.businessVersionService,
  });
  app.register(semanticControlRoutes, {
    prefix: '/api/v1',
    service: options.semanticQueryService,
  });
  app.register(semanticAuthoringRoutes, {
    prefix: '/api/v1',
    service: options.semanticAuthoringService,
  });
  app.register(semanticRunRoutes, {
    prefix: '/api/v1',
    service: options.semanticRunService,
  });

  // Serve built frontend (ui/dist/) at /ai-e2e/ prefix
  const uiDistPath = path.join(import.meta.dirname, '..', '..', 'ui', 'dist');
  app.register(fastifyStatic, {
    root: uiDistPath,
    prefix: '/ai-e2e/',
    wildcard: false,
  });

  // SPA catch-all: serve index.html for unmatched /ai-e2e/* navigation requests only.
  // Asset requests (.js, .css, .map, .ico, etc.) that reach here are truly missing → 404.
  const ASSET_EXT = /\.(js|css|map|ico|png|jpg|svg|woff2?|ttf|eot)(\?|$)/i;
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/ai-e2e/') && !ASSET_EXT.test(request.url)) {
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
      await app.close();
      databaseManager.close();
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
  const databaseManager = DatabaseManager.getInstance();
  const port = Number.parseInt(process.env.AI_E2E_PORT ?? `${DEFAULT_PORT}`, 10);
  const dbPath = process.env.AI_E2E_DB_PATH ?? DEFAULT_DB_PATH;

  ensureDatabaseDirectory(dbPath);
  databaseManager.init(dbPath);

  const semanticProjectService = new SemanticProjectService(databaseManager.getSemanticProjectRepo());
  const businessVersionService = new BusinessVersionService(
    databaseManager.getBusinessVersionRepo()
  );
  const semanticQueryService = new SemanticQueryService(databaseManager.getSemanticQueryRepo());
  const semanticAuthoringService = new SemanticAuthoringService(
    databaseManager.getSemanticWorkflowRepo(),
    databaseManager.getSemanticAssetRepo(),
    databaseManager.getAuthoringAmendmentRepo(),
    databaseManager.getBusinessVersionRepo()
  );
  const semanticRunService = new SemanticRunService(databaseManager.getSemanticRunControlRepo());
  const semanticCoordinator = new SemanticCoordinatorService({
    repository: databaseManager.getSemanticCoordinatorRepo(),
    workflows: databaseManager.getSemanticWorkflowRepo(),
    evidence: databaseManager.getSemanticEvidenceRepo(),
    runs: databaseManager.getSemanticRunControlRepo(),
    agentTasks: new AgentTaskClient(),
    browser: new SemanticBrowserClient(),
    authoringCandidates: new SemanticAuthoringCandidateService(
      databaseManager.getSemanticQueryRepo(),
      databaseManager.getSemanticAssetRepo(),
      databaseManager.getAuthoringAmendmentRepo()
    ),
  });
  const app = createServer({
    semanticProjectService,
    businessVersionService,
    semanticQueryService,
    semanticAuthoringService,
    semanticRunService,
  });
  try {
    const evidenceRetention = new SemanticEvidenceRetentionService({
      repository: databaseManager.getSemanticEvidenceRepo(),
      successRetentionDays: readPositiveIntegerEnvironment(
        'AI_E2E_EVIDENCE_SUCCESS_RETENTION_DAYS',
        7
      ),
      failureRetentionDays: readPositiveIntegerEnvironment(
        'AI_E2E_EVIDENCE_FAILURE_RETENTION_DAYS',
        30
      ),
      logger: app.log,
    });
    registerGracefulShutdown(app, databaseManager);

    if (process.env.AI_E2E_COORDINATOR_ENABLED !== 'false') {
      startCoordinatorLoop(app, semanticCoordinator);
    }
    startEvidenceRetentionLoop(app, evidenceRetention);

    await app.listen({
      port,
      host: '127.0.0.1',
    });

    app.log.info({ port, dbPath }, 'AI E2E server listening');
    app.log.info(
      {
        aiChat: process.env.AI_CHAT_SERVICE_URL ?? 'http://127.0.0.1:3001',
        browserGateway: process.env.PROXY_ADAPTER_URL ?? 'http://127.0.0.1:3000',
      },
      'Backend topology'
    );
    app.log.info(`UI: http://localhost:${port}/ai-e2e/`);
    return app;
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start AI E2E server');
    await app.close();
    databaseManager.close();
    throw error;
  }
}

function startCoordinatorLoop(app: AppServer, coordinator: SemanticCoordinatorService): void {
  const configured = Number.parseInt(
    process.env.AI_E2E_COORDINATOR_INTERVAL_MS ?? `${DEFAULT_COORDINATOR_INTERVAL_MS}`,
    10
  );
  const intervalMs = Number.isFinite(configured)
    ? Math.max(100, configured)
    : DEFAULT_COORDINATOR_INTERVAL_MS;
  let lastErrorLogAt = 0;
  const run = async () => {
    try {
      await coordinator.tick();
    } catch (error) {
      const now = Date.now();
      if (now - lastErrorLogAt >= 30_000) {
        lastErrorLogAt = now;
        app.log.warn({ err: error }, 'Semantic coordinator tick failed; will retry');
      }
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
  void run();
}

function startEvidenceRetentionLoop(
  app: AppServer,
  retention: SemanticEvidenceRetentionService
): void {
  const intervalMs = readPositiveIntegerEnvironment(
    'AI_E2E_EVIDENCE_CLEANUP_INTERVAL_MS',
    DEFAULT_EVIDENCE_CLEANUP_INTERVAL_MS
  );
  const run = async () => {
    const result = await retention.cleanupExpiredArtifacts();
    if (result.storageFailures > 0) {
      app.log.warn(result, '长期证据保留清理存在待重试的存储失败');
    } else if (result.recordsDeleted > 0 || result.filesDeleted > 0) {
      app.log.info(result, '长期证据保留清理完成');
    }
  };
  let cleanupPromise: Promise<void> | undefined;
  const invoke = () => {
    cleanupPromise ??= run()
      .catch((error: unknown) => {
        app.log.error({ err: error }, '长期证据保留清理失败');
      })
      .finally(() => {
        cleanupPromise = undefined;
      });
    return cleanupPromise;
  };
  const timer = setInterval(() => void invoke(), intervalMs);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await cleanupPromise;
  });
  void invoke();
}

function readPositiveIntegerEnvironment(name: string, fallback: number): number {
  const configured = process.env[name];
  if (configured === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(configured)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} exceeds the safe integer range`);
  return parsed;
}
