import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig as loadServiceConfig,
  type AiChatServiceConfig,
} from './config/service-config.js';
import { ConversationDatabase } from './db/ConversationDatabase.js';
import { AppService } from './services/app-service.js';
import { ConversationManager } from './conversation/manager.js';
import { ChatHandler } from './conversation/chat-handler.js';
import { createCompressionClient } from './clients/compression.js';
import { ChatSessionController } from './services/chat-session-controller.js';
import { SessionEventHub } from './conversation/session-event-hub.js';
import { ToolRegistry } from './tools/registry.js';
import { ConversationJobQueue } from './services/conversation-job-queue.js';
import { StreamPersistWorker } from './services/stream-persist-worker.js';
import { runPreflight } from './services/provider/preflight.js';
import chatRoutes from './plugins/routes/api/chat/index.js';
import aiServiceRoutes from './plugins/routes/api/ai-service.js';
import debugAiRoutes from './plugins/routes/api/debug-ai.js';
import agentTaskRoutes from './plugins/routes/api/agent-tasks.js';
import { AgentTaskRepository } from './agent-tasks/repository.js';
import { AgentTaskModelExecutor } from './agent-tasks/executor.js';
import { AgentTaskService } from './agent-tasks/service.js';
import { isLoopbackHost } from './agent-tasks/capabilities.js';
import { SkillRuntime } from './skills/runtime.js';
import { loadRawConfig } from './config/loader.js';
import {
  createHarnessRuntime,
  installGatewayToolBridge,
  mapHarnessConfig,
  publicMcpToolName,
} from './harness/index.js';
import type { HarnessRuntime } from './harness/types.js';
import { HarnessProjectionStore } from './harness/projection-store.js';
import { HarnessDeletionService } from './harness/deletion-service.js';
import { HarnessRunScheduler } from './harness/run-scheduler.js';
import { ConnectivityGateService } from './services/connectivity-gate-service.js';
import { HarnessBackupService } from './harness/backup-service.js';
import { HarnessRetentionService } from './harness/retention-service.js';

export const SERVICE_VERSION = '0.1.0';

export interface BuildAppOptions {
  configPath?: string;
  dataDir?: string;
  serviceConfig?: AiChatServiceConfig;
  skipBackups?: boolean;
  skipPreflight?: boolean;
  trustedPluginLockPath?: string;
}

/** Builds one fully isolated Fastify + Cordis Harness lifetime. */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const serviceConfig = options.serviceConfig ?? loadServiceConfig();
  const dataDir = options.dataDir ?? join(process.cwd(), 'data', 'ai-chat-service');
  const conversationsPath = join(dataDir, 'conversations.sqlite');
  const agentTasksPath = join(dataDir, 'agent-tasks.sqlite');
  const app = Fastify({
    logger: { level: serviceConfig.logLevel },
    disableRequestLogging: true,
  });

  const database = new ConversationDatabase();
  const localAppService = new AppService();
  const sessionEventHub = new SessionEventHub();
  const connectivityGate = new ConnectivityGateService();
  let harness: HarnessRuntime | undefined;
  let conversationManager: ConversationManager | undefined;
  let chatHandler: ChatHandler | undefined;
  let deletionService: HarnessDeletionService | undefined;
  let persistWorker: StreamPersistWorker | undefined;
  let jobQueue: ConversationJobQueue | undefined;
  let toolRegistry: ToolRegistry | undefined;
  let agentTaskRepository: AgentTaskRepository | undefined;
  let agentTaskService: AgentTaskService | undefined;
  let runScheduler: HarnessRunScheduler | undefined;
  let retentionTimer: NodeJS.Timeout | undefined;
  let disposeGatewayToolBridge: (() => void) | undefined;
  let disposed = false;

  const disposeResources = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    jobQueue?.stopAccepting();
    if (retentionTimer) clearInterval(retentionTimer);
    sessionEventHub.close();
    if (agentTaskService) {
      await agentTaskService.close();
      agentTaskRepository = undefined;
    } else {
      agentTaskRepository?.close();
    }
    await chatHandler?.close();
    await jobQueue?.close();
    runScheduler?.close();
    await deletionService?.close();
    if (chatHandler) await chatHandler.recoverDurableProjections();
    await persistWorker?.shutdown();
    disposeGatewayToolBridge?.();
    await toolRegistry?.shutdownAll();
    await localAppService.shutdown();
    await harness?.dispose();
    if (conversationManager) await conversationManager.close();
    else await database.close();
  };

  app.addHook('onClose', async () => disposeResources());

  try {
    await app.register(cors, {
      origin: serviceConfig.corsOrigins.includes('*') ? true : serviceConfig.corsOrigins,
      credentials: true,
    });

    const testMode = process.env.TEST_MODE === 'true' || process.env.NODE_ENV === 'test';
    database.initialize(conversationsPath);
    runScheduler = new HarnessRunScheduler(database.connection());
    await localAppService.initialize(options.configPath);
    const providerRegistry = localAppService.getRegistry();
    const providerConfig = localAppService.getConfig();
    if (!providerConfig || !providerRegistry) {
      throw new Error('AI provider configuration is unavailable');
    }
    const providerKeys = Object.keys(providerConfig.providers).filter(
      (key) => providerConfig.providers[key]?.enabled
    );
    if (!testMode && options.skipPreflight !== true) {
      await runPreflight(providerRegistry, providerKeys);
    }

    const rawLoad = loadRawConfig(options.configPath ?? localAppService.getConfigPath());
    if (!rawLoad.config) {
      throw new Error(`Raw AI configuration is unavailable: ${rawLoad.errors.join(', ')}`);
    }
    const harnessConfig = mapHarnessConfig(rawLoad.config, { dataDir });
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    harness = await createHarnessRuntime({
      ...harnessConfig,
      trustedPlugins: {
        packageRoot,
        lockPath:
          options.trustedPluginLockPath ?? join(packageRoot, 'trusted-harness-plugins.lock.json'),
      },
    });
    localAppService.setHarnessMcpInventory(
      harnessConfig.mcp.map((server) => server.serverName),
      harness.transportToolNames()
    );

    conversationManager = new ConversationManager(conversationsPath, database);
    const compressionClient = createCompressionClient(null);
    if (compressionClient) conversationManager.setAiClient(compressionClient);

    const sessionController = new ChatSessionController(database);
    sessionController.initialize();

    toolRegistry = new ToolRegistry();
    const visionDefaults = providerConfig.defaults.vision;
    if (visionDefaults) {
      try {
        const visionModel = await providerRegistry.resolve(
          visionDefaults.provider,
          visionDefaults.model
        );
        const { VisionAnalyzer, VisionSnapshotLoader } = await import('./vision/index.js');
        const { VisionToolProvider } = await import('./tools/providers/vision-tool-provider.js');
        const visionConfig = {
          maxTokens: providerConfig.settings.maxTokens,
          temperature: providerConfig.settings.temperature,
          timeoutMs: providerConfig.settings.timeout,
          maxRetries: providerConfig.settings.maxRetries,
        };
        toolRegistry.registerProvider(
          new VisionToolProvider(
            new VisionAnalyzer(visionModel, visionConfig),
            new VisionSnapshotLoader({
              gatewayUrl: serviceConfig.gatewayUrl,
              mcpClient: harness,
              attachments: harness.context.attachments,
            })
          )
        );
      } catch (error) {
        app.log.warn({ err: error }, 'Vision tool provider initialization failed');
      }
    }
    await toolRegistry.initializeAll();
    const gatewayToolBridge = installGatewayToolBridge(harness.context, toolRegistry);
    disposeGatewayToolBridge = () => gatewayToolBridge.dispose();
    localAppService.setToolRegistry(toolRegistry);

    agentTaskRepository = new AgentTaskRepository(agentTasksPath);
    if (!testMode && options.skipBackups !== true) {
      const backup = new HarnessBackupService({
        dataDir,
        conversationDb: database.connection(),
        agentTaskDb: agentTaskRepository.connection(),
        configPath: rawLoad.configPath,
        inventoryFiles: [
          join(packageRoot, 'harness-bom.json'),
          join(packageRoot, 'trusted-harness-plugins.lock.json'),
          join(packageRoot, '..', 'pnpm-lock.yaml'),
        ],
      });
      const backupPath = await backup.createAndVerify();
      app.log.info({ backupPath }, 'Verified Harness backup published');
    }
    const retention = new HarnessRetentionService(agentTaskRepository, harness, {
      sessionRoot: harnessConfig.sessionRoot,
      attachmentRoot: harnessConfig.attachmentRoot,
    });
    const retainedTaskCount = await retention.initialize();
    if (retainedTaskCount > 0) {
      app.log.info({ retainedTaskCount }, 'Collected expired Harness Agent tasks');
    }
    retentionTimer = setInterval(() => {
      void retention
        .collectEligible()
        .catch((error) => app.log.error({ err: error }, 'Harness retention collection failed'));
    }, 60_000);
    retentionTimer.unref();
    const skillRuntime = new SkillRuntime(agentTaskRepository);
    const skillAvailableTools = new Set(
      toolRegistry.getAvailableTools({ consumer: 'chat' }).map((tool) => tool.name)
    );
    if (
      harnessConfig.mcp.some((server) =>
        harness
          ?.transportToolNames()
          .includes(publicMcpToolName(server.serverName, 'browser-control.operation_execute'))
      )
    ) {
      skillAvailableTools.add('browser-control.operation_execute');
    }
    const skillCatalog = skillRuntime.loadFromDirectories(serviceConfig.skillDirectories, [
      ...skillAvailableTools,
    ]);
    const agentTaskExecutor = new AgentTaskModelExecutor({
      config: providerConfig,
      harness,
      toolRegistry,
      mcpClient: harness,
    });
    agentTaskService = new AgentTaskService(
      agentTaskRepository,
      agentTaskExecutor,
      app.log,
      skillRuntime,
      runScheduler,
      () => retention.admitNewRun()
    );
    const reconciledTaskCount = await agentTaskService.reconcileDurableHarness(harness);
    if (reconciledTaskCount > 0) {
      app.log.info({ reconciledTaskCount }, 'Reconciled durable Agent task results');
    }
    const recoveredTaskCount = agentTaskService.recoverUnfinished();
    if (recoveredTaskCount > 0) {
      app.log.warn({ recoveredTaskCount }, 'Recovered unfinished Agent tasks as interrupted');
    }

    const projection = new HarnessProjectionStore(
      database.connection(),
      database.getSessionEventsDAO()
    );
    chatHandler = new ChatHandler(
      conversationManager,
      providerConfig,
      harness,
      projection,
      database.getSessionEventsDAO(),
      sessionEventHub,
      sessionController
    );
    const recoveredProjectionCount = await chatHandler.recoverDurableProjections();
    if (recoveredProjectionCount > 0) {
      app.log.info({ recoveredProjectionCount }, 'Recovered durable Chat projections');
    }

    persistWorker = new StreamPersistWorker();
    jobQueue = new ConversationJobQueue(
      persistWorker,
      sessionEventHub,
      database,
      runScheduler,
      () => retention.admitNewRun()
    );
    deletionService = new HarnessDeletionService(database.connection(), chatHandler, harness);
    const resumedDeletionCount = await deletionService.resumePending();
    if (resumedDeletionCount > 0) {
      app.log.warn({ resumedDeletionCount }, 'Resumed pending Harness deletion jobs');
    }

    app.decorate('conversationManager', conversationManager);
    app.decorate('chatHandler', chatHandler);
    app.decorate('jobQueue', jobQueue);
    app.decorate('deletionService', deletionService);
    app.decorate('conversationDatabase', database);
    app.decorate('appService', localAppService);
    app.decorate('chatSessionController', sessionController);
    app.decorate('sessionEventHub', sessionEventHub);
    app.decorate('connectivityGate', connectivityGate);
    app.decorate('harnessRuntime', harness);
    app.decorate('harnessRunScheduler', runScheduler);

    app.get('/health', async () => ({
      status: 'ok',
      service: 'ai-chat-service',
      version: SERVICE_VERSION,
    }));
    app.get('/config', async () => ({
      service: 'ai-chat-service',
      version: SERVICE_VERSION,
      port: serviceConfig.port,
      host: serviceConfig.host,
      logLevel: serviceConfig.logLevel,
      gatewayUrl: serviceConfig.gatewayUrl,
      providers: Object.fromEntries(
        Object.entries(serviceConfig.providers).map(([alias, provider]) => [
          alias,
          {
            enabled: provider.enabled,
            baseUrl: provider.baseUrl,
            apiKeyConfigured: provider.apiKey.length > 0,
          },
        ])
      ),
    }));

    const aiRouteOptions = {
      harness,
      decision: harnessConfig.decision,
      timeoutMs: providerConfig.settings.timeout,
    };
    await app.register(aiServiceRoutes, { prefix: '/api/v1/ai', ...aiRouteOptions });
    await app.register(chatRoutes, { prefix: '/api/v1/chat' });
    await app.register(debugAiRoutes, { prefix: '/api/v1' });
    await app.register(agentTaskRoutes, {
      prefix: '/api/v1',
      service: agentTaskService,
      serviceVersion: SERVICE_VERSION,
      localControlPlane: isLoopbackHost(serviceConfig.host),
      skillCatalog,
    });
    await app.register(aiServiceRoutes, { prefix: '/api/ai', ...aiRouteOptions });
    await app.register(chatRoutes, { prefix: '/api/chat' });
    await app.register(debugAiRoutes, { prefix: '/api' });
    return app;
  } catch (error) {
    await disposeResources();
    throw error;
  }
}
