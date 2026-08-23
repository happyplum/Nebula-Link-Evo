import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseManager } from '../database/db.js';
import { ProxyAdapterClient } from '../infrastructure/proxy-adapter-client.js';
import { PromptTemplateManager, TokenBudgetTracker } from '../ai/index.js';
import { LoginRecorderService } from '../services/login-recorder-service.js';
import { StateMachineService } from '../services/state-machine-service.js';
import { TestScenarioService } from '../services/test-scenario-service.js';
import { AIDiagnosisService } from '../services/ai-diagnosis-service.js';
import { ExecutorService } from '../services/executor-service.js';
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
import scenarioRoutes from './routes/scenario.js';
import diagnosisReportRoutes from './routes/diagnosis-report.js';
import businessVersionRoutes from './routes/business-versions.js';
import { BusinessVersionService } from '../services/business-version-service.js';
import semanticControlRoutes from './routes/semantic-control.js';
import { SemanticQueryService } from '../services/semantic-query-service.js';
import semanticAuthoringRoutes from './routes/semantic-authoring.js';
import { SemanticAuthoringService } from '../services/semantic-authoring-service.js';

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
const DEFAULT_TOKEN_BUDGET = 500_000;

let shutdownHandlersRegistered = false;

function ensureDatabaseDirectory(dbPath: string): void {
  if (dbPath === ':memory:') {
    return;
  }

  const resolvedPath = path.resolve(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
}

export interface ServerOptions {
  proxyClient?: ProxyAdapterClient | null;
  promptManager?: PromptTemplateManager;
  tokenTracker?: TokenBudgetTracker;
  loginRecorder?: LoginRecorderService;
  stateMachine?: StateMachineService;
  scenarioService?: TestScenarioService;
  diagnosisService?: AIDiagnosisService;
  executorService?: ExecutorService;
  businessVersionService?: BusinessVersionService;
  semanticQueryService?: SemanticQueryService;
  semanticAuthoringService?: SemanticAuthoringService;
}

export function createServer(options: Partial<ServerOptions> = {}) {
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
  app.register(projectConfigRoutes, { prefix: '/api/projects/:id/config', loginRecorder: options.loginRecorder });
  app.register(projectAnalysisRoutes, {
    prefix: '/api/projects/:id/analysis',
    proxyClient: options.proxyClient,
    promptManager: options.promptManager,
    tokenTracker: options.tokenTracker,
    stateMachine: options.stateMachine,
  });
  app.register(executionRoutes, { prefix: '/api/projects/:id/execution', executor: options.executorService, diagnosis: options.diagnosisService });
  app.register(stateRoutes, { prefix: '/api/projects/:id/state', stateMachine: options.stateMachine });
  app.register(explorationRoutes, {
    prefix: '/api/projects/:id/exploration',
    proxyClient: options.proxyClient,
    promptManager: options.promptManager,
  });
  app.register(scriptsRoutes, {
    prefix: '/api/projects/:id/scripts',
    proxyClient: options.proxyClient,
    promptManager: options.promptManager,
  });
  app.register(eventsRoutes, { prefix: '/api/projects/:id/events' });
  app.register(scenarioRoutes, { prefix: '/api/projects/:id', scenarioService: options.scenarioService });
  app.register(diagnosisReportRoutes, { prefix: '/api/projects/:id/diagnosis', diagnosisService: options.diagnosisService });
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
  // Create AI service instances.
  // ProxyAdapterClient is now a facade over AiChatClient (:3001) and
  // BrowserGatewayClient (:3000); each resolves its own base URL from env
  // (AI_CHAT_SERVICE_URL / PROXY_ADAPTER_URL respectively).
  const proxyClient = new ProxyAdapterClient();
  const promptsDir = path.join(process.cwd(), 'prompts');
  const promptManager = new PromptTemplateManager(promptsDir);
  const tokenTracker = new TokenBudgetTracker(DEFAULT_TOKEN_BUDGET);

  // Initialize database before creating services that depend on it
  const databaseManager = DatabaseManager.getInstance();
  const port = Number.parseInt(process.env.AI_E2E_PORT ?? `${DEFAULT_PORT}`, 10);
  const dbPath = process.env.AI_E2E_DB_PATH ?? DEFAULT_DB_PATH;

  ensureDatabaseDirectory(dbPath);
  databaseManager.init(dbPath);

  // Create login recorder service (depends on DB and proxyClient)
  const loginRecorder = new LoginRecorderService(databaseManager, proxyClient);

  // Create state machine service (depends on DB)
  const stateMachine = new StateMachineService(databaseManager);

  // Create test scenario service (depends on DB)
  const testScenarioService = new TestScenarioService(databaseManager.getTestScenarioRepo());

  // Create AI diagnosis service (depends on DB, proxyClient, promptManager)
  const aiDiagnosisService = new AIDiagnosisService(
    proxyClient,
    promptManager,
    databaseManager.getExecutionRunRepo(),
    databaseManager.getAIInterventionLogRepo(),
    databaseManager.getScriptRepo(),
    databaseManager.getBusinessModuleRepo(),
    databaseManager.getFunctionalModuleRepo(),
    databaseManager.getTestScenarioRepo(),
  );

  // Create executor service (depends on DB)
  const executorService = new ExecutorService(
    databaseManager.getScriptRepo(),
    databaseManager.getExecutionRunRepo(),
  );

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

  // Create server with all dependencies
  const app = createServer({
    proxyClient,
    promptManager,
    tokenTracker,
    loginRecorder,
    stateMachine,
    scenarioService: testScenarioService,
    diagnosisService: aiDiagnosisService,
    executorService,
    businessVersionService,
    semanticQueryService,
    semanticAuthoringService,
  });

  try {
    registerGracefulShutdown(app, databaseManager);

    await app.listen({
      port,
      host: '127.0.0.1',
    });

    app.log.info({ port, dbPath }, 'AI E2E server listening');
    app.log.info(
      {
        aiChat: proxyClient.aiChatClient.getBaseUrl(),
        browserGateway: proxyClient.browserGatewayClient.getBaseUrl(),
      },
      'Backend topology',
    );
    app.log.info(`UI: http://localhost:${port}/ai-e2e/`);
    return app;
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start AI E2E server');
    databaseManager.close();
    await app.close();
    throw error;
  }
}
