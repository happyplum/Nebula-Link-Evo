import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig } from './config/service-config.js';
import { conversationDatabase } from './db/index.js';
import { appService } from './services/index.js';
import { ConversationManager } from './conversation/index.js';
import { ChatHandler } from './conversation/chat-handler.js';
import { createCompressionClient } from './clients/compression.js';
import { ChatSessionController } from './services/chat-session-controller.js';
import { SessionEventHub } from './conversation/session-event-hub.js';
import { ToolRegistry } from './tools/registry.js';
import { MCPClientProvider } from './tools/providers/mcp-client-provider.js';
import { ConversationJobQueue } from './services/conversation-job-queue.js';
import { StreamPersistWorker } from './services/stream-persist-worker.js';
import { runPreflight } from './services/provider/preflight.js';
import { initializeWithBackup } from './utils/db-backup.js';
import chatRoutes from './plugins/routes/api/chat/index.js';
import aiServiceRoutes from './plugins/routes/api/ai-service.js';
import debugAiRoutes from './plugins/routes/api/debug-ai.js';
import agentTaskRoutes from './plugins/routes/api/agent-tasks.js';
import { AgentTaskRepository } from './agent-tasks/repository.js';
import { AgentTaskModelExecutor } from './agent-tasks/executor.js';
import { AgentTaskService } from './agent-tasks/service.js';
import { isLoopbackHost } from './agent-tasks/capabilities.js';
import { SkillRuntime } from './skills/runtime.js';

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
const CONVERSATIONS_DB_PATH = path.join(process.cwd(), 'data', 'ai-chat-service', 'conversations.sqlite');
const AGENT_TASKS_DB_PATH = path.join(process.cwd(), 'data', 'ai-chat-service', 'agent-tasks.sqlite');

const app = Fastify({
  logger: { level: config.logLevel },
  disableRequestLogging: true,
});

let conversationManager: ConversationManager;
let toolRegistry: ToolRegistry;
let persistWorker: StreamPersistWorker;
let agentTaskService: AgentTaskService;

async function start(): Promise<void> {
  try {
    await app.register(cors, {
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      credentials: true,
    });

    const isTestMode = process.env.TEST_MODE === 'true' || process.env.NODE_ENV === 'test';
    if (!isTestMode) {
      await initializeWithBackup(CONVERSATIONS_DB_PATH);
      await initializeWithBackup(AGENT_TASKS_DB_PATH);
    }

    conversationDatabase.initialize(CONVERSATIONS_DB_PATH);

    await appService.initialize();
    const providerRegistry = appService.getRegistry();
    const providerConfig = appService.getConfig();
    if (providerRegistry && providerConfig) {
      const providerKeys = Object.keys(providerConfig.providers).filter((key) => providerConfig.providers[key]?.enabled);
      await runPreflight(providerRegistry, providerKeys);
    }

    if (!providerConfig) {
      throw new Error('AI provider configuration is unavailable');
    }
    if (!providerRegistry) {
      throw new Error('AI provider registry is unavailable');
    }

    conversationManager = new ConversationManager(CONVERSATIONS_DB_PATH);
    const compressionClient = createCompressionClient(null);
    if (compressionClient) {
      conversationManager.setAiClient(compressionClient);
    } else {
      app.log.warn('Runtime compression disabled: no compatible decision client available');
    }

    if (!isTestMode) {
      ChatSessionController.getInstance().initialize();
    }

    toolRegistry = new ToolRegistry();
    const mcpClient = appService.getMCPSDKClient();
    if (mcpClient) {
      toolRegistry.registerProvider(new MCPClientProvider(mcpClient));
    }

    // 注册 VisionToolProvider（视觉分析能力）
    const visionDefaults = providerConfig?.defaults?.vision;
    if (visionDefaults && providerRegistry && mcpClient) {
      try {
        const visionModel = await providerRegistry.resolve(visionDefaults.provider, visionDefaults.model);
        const { VisionAnalyzer } = await import('./vision/index.js');
        const { VisionToolProvider } = await import('./tools/providers/vision-tool-provider.js');
        const visionConfig = {
          maxTokens: providerConfig.settings.maxTokens,
          temperature: providerConfig.settings.temperature,
          timeoutMs: providerConfig.settings.timeout,
          maxRetries: providerConfig.settings.maxRetries,
        };
        const visionAnalyzer = new VisionAnalyzer(visionModel, visionConfig);
        toolRegistry.registerProvider(new VisionToolProvider(visionAnalyzer, mcpClient, visionConfig));
      } catch (error) {
        app.log.warn({ err: error }, 'Vision tool provider initialization failed, continuing without vision tools');
      }
    }

    await toolRegistry.initializeAll();
    appService.setToolRegistry(toolRegistry);

    const agentTaskRepository = new AgentTaskRepository(AGENT_TASKS_DB_PATH);
    const skillRuntime = new SkillRuntime(agentTaskRepository);
    const skillAvailableTools = new Set(
      toolRegistry.getAvailableTools({ consumer: 'chat' }).map((tool) => tool.name)
    );
    if (
      mcpClient?.getAvailableTools().some(
        (tool) =>
          tool.originalName === 'browser-control.operation_execute' ||
          tool.name === 'browser-control.operation_execute'
      )
    ) {
      skillAvailableTools.add('browser-control.operation_execute');
    }
    const skillCatalog = skillRuntime.loadFromDirectories(
      config.skillDirectories,
      [...skillAvailableTools]
    );
    app.log.info(
      { configuredRoots: config.skillDirectories.length, loadedVersions: skillCatalog.length },
      'Skills runtime initialized'
    );
    const agentTaskExecutor = new AgentTaskModelExecutor({
      config: providerConfig,
      providerRegistry,
      toolRegistry,
      ...(mcpClient ? { mcpClient } : {}),
    });
    agentTaskService = new AgentTaskService(
      agentTaskRepository,
      agentTaskExecutor,
      app.log,
      skillRuntime
    );
    const recoveredTaskCount = agentTaskService.recoverUnfinished();
    if (recoveredTaskCount > 0) {
      app.log.warn({ recoveredTaskCount }, 'Recovered unfinished Agent tasks as interrupted');
    }

    const chatHandler = new ChatHandler(
      conversationManager,
      providerConfig,
      mcpClient || undefined,
      conversationDatabase.getSessionEventsDAO(),
      SessionEventHub.getInstance(),
      undefined,
      toolRegistry,
    );
    persistWorker = new StreamPersistWorker();
    const jobQueue = new ConversationJobQueue(persistWorker, SessionEventHub.getInstance());

    await app.decorate('conversationManager', conversationManager);
    await app.decorate('chatHandler', chatHandler);
    await app.decorate('jobQueue', jobQueue);

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

    await app.register(aiServiceRoutes, { prefix: '/api/v1/ai' });
    await app.register(chatRoutes, { prefix: '/api/v1/chat' });
    await app.register(debugAiRoutes, { prefix: '/api/v1' });
    await app.register(agentTaskRoutes, {
      prefix: '/api/v1',
      service: agentTaskService,
      serviceVersion: VERSION,
      localControlPlane: isLoopbackHost(config.host),
      skillCatalog,
    });
    await app.register(aiServiceRoutes, { prefix: '/api/ai' });
    await app.register(chatRoutes, { prefix: '/api/chat' });
    await app.register(debugAiRoutes, { prefix: '/api' });

    await app.listen({ port: config.port, host: config.host });
    app.log.info({ url: `http://localhost:${config.port}` }, 'ai-chat-service running');
    app.log.info('Available endpoints:');
    app.log.info({ endpoint: 'GET /health' });
    app.log.info({ endpoint: 'GET /config' });
    app.log.info({ endpoint: 'POST /api/v1/ai/generate' });
    app.log.info({ endpoint: 'GET  /api/v1/chat/*' });
    app.log.info({ endpoint: 'POST /api/v1/test-ai' });
    app.log.info({ endpoint: 'GET  /api/v1/verify-keys' });
    app.log.info({ endpoint: 'POST /api/v1/agent-tasks' });
    app.log.info({ endpoint: 'GET  /api/v1/agent-tasks/:taskId' });
    app.log.info({ endpoint: 'GET  /api/v1/capabilities' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  app.log.info({ signal }, '[ai-chat-service] shutdown');
  if (agentTaskService) {
    await agentTaskService.close();
  }
  if (toolRegistry) {
    await toolRegistry.shutdownAll();
  }
  if (persistWorker) {
    await persistWorker.shutdown();
  }
  if (conversationManager) {
    await conversationManager.close();
  } else {
    await conversationDatabase.close();
  }
  await appService.shutdown();
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
