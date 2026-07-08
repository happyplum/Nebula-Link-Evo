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

const app = Fastify({
  logger: { level: config.logLevel },
  disableRequestLogging: true,
});

let conversationManager: ConversationManager;
let toolRegistry: ToolRegistry;
let persistWorker: StreamPersistWorker;

async function start(): Promise<void> {
  try {
    await app.register(cors, {
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      credentials: true,
    });

    const isTestMode = process.env.TEST_MODE === 'true' || process.env.NODE_ENV === 'test';
    if (!isTestMode) {
      await initializeWithBackup(CONVERSATIONS_DB_PATH);
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
          maxTokens: providerConfig!.settings.maxTokens,
          temperature: providerConfig!.settings.temperature,
          timeoutMs: providerConfig!.settings.timeout,
          maxRetries: providerConfig!.settings.maxRetries,
        };
        const visionAnalyzer = new VisionAnalyzer(visionModel, visionConfig);
        toolRegistry.registerProvider(new VisionToolProvider(visionAnalyzer, mcpClient, visionConfig));
      } catch (error) {
        app.log.warn({ err: error }, 'Vision tool provider initialization failed, continuing without vision tools');
      }
    }

    await toolRegistry.initializeAll();
    appService.setToolRegistry(toolRegistry);

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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  app.log.info({ signal }, '[ai-chat-service] shutdown');
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
