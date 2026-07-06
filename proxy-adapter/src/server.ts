import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { appService } from './services/index.js';
import { browserClient } from './browser-client.js';
import { shutdownBrowserEngine } from './browser-engine/index.js';
import { ConversationManager, ChatHandler } from './conversation/index.js';
import { DatabaseManager } from './conversation/db.js';
import { createCompressionClient } from './clients/compression.js';
import { ChatSessionController } from './services/chat-session-controller.js';
import { SessionEventHub } from './services/session-event-hub.js';
import { debugEventHub } from './services/debug-event-hub.js';
import { debugStreamBridge } from './services/debug-stream-bridge.js';
import { initializeWithBackup } from './utils/db-backup.js';
import { normalizeLogLevel } from './services/logger.js';
import { ConversationJobQueue } from './services/conversation-job-queue.js';
import { StreamPersistWorker } from './services/stream-persist-worker.js';
import healthRoutes from './plugins/routes/health.js';
import configRoutes from './plugins/routes/config.js';
import livekitTokenRoutes from './plugins/routes/api/livekit-token.js';
import aiServiceRoutes from './plugins/routes/api/ai-service.js';
import debugRoutes from './plugins/routes/debug/index.js';
import apiChatRoutes from './plugins/routes/api/chat/index.js';
import { runPreflight } from './services/provider/preflight.js';
import { ToolRegistry } from './tools/registry.js';
import { BrowserToolsProvider } from './tools/providers/browser-tools-provider.js';
import { VisionAgentProvider } from './tools/providers/vision-agent-provider.js';
import { buildVisionAgentConfig } from './tools/providers/build-vision-agent-config.js';
import type { VisionConfigOverride } from './mcps/vision-agent/config.js';
import { MCPClientProvider } from './tools/providers/mcp-client-provider.js';
import mcpServerPlugin from './mcp-server/index.js';

const envLocal = path.join(process.cwd(), '.env');
const envRoot = path.join(process.cwd(), '..', '.env');

if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
} else if (fs.existsSync(envRoot)) {
  dotenv.config({ path: envRoot });
} else {
  dotenv.config();
}

const app = Fastify({
  logger: {
    level: normalizeLogLevel(),
  },
  disableRequestLogging: true,
});

const PORT = parseInt(process.env.PROXY_PORT || '3000');

/**
 * CORS origin configuration.
 * - Set CORS_ORIGINS to a comma-separated whitelist (e.g. "http://localhost:5173,http://localhost:3000")
 * - Set CORS_ORIGINS="*" to allow all origins (equivalent to previous behavior)
 * - Default: ["http://localhost:5173"] (debug-ui dev server)
 */
function resolveCorsOrigin(): (string | RegExp)[] | boolean {
  const envVal = process.env.CORS_ORIGINS;
  if (!envVal) {
    return ['http://localhost:5173'];
  }
  if (envVal === '*') {
    return true;
  }
  return envVal.split(',').map(o => o.trim()).filter(Boolean);
}

/**
 * Server bind address.
 * - Default: 127.0.0.1 (localhost only)
 * - Set HOST=0.0.0.0 to listen on all interfaces (for Docker/remote)
 */
const HOST = process.env.HOST || '127.0.0.1';

let conversationManager: ConversationManager;
let chatHandler: ChatHandler;
let toolRegistry: ToolRegistry;

async function start() {
  try {
    const isTestMode = process.env.TEST_MODE === 'true';

    // Initialize database backup before starting server (skip in unit tests)
    if (!isTestMode) {
      await initializeWithBackup();
    }

    await app.register(cors, {
      origin: resolveCorsOrigin(),
      credentials: true,
    });

    await app.decorate('taskExecutor', appService);
    await app.decorate('browserClient', browserClient);

    // Initialize task service first to load configuration
    // This must happen before route registration to ensure config is available
    await appService.initialize();
    debugStreamBridge.start();

    // Run provider preflight checks
    const registry = appService.getRegistry();
    const preflightConfig = appService.getConfig();
    if (registry && preflightConfig) {
      const providerKeys = Object.keys(preflightConfig.providers ?? {}).filter(k => preflightConfig.providers[k].enabled);
      await runPreflight(registry, providerKeys);
    }

    // Get config for chat handler
    const config = appService.getConfig();
    if (!config) {
      throw new Error('Task service configuration is unavailable');
    }

    // Initialize conversation management
    const dbPath = path.join(process.cwd(), 'conversations.sqlite');
    conversationManager = new ConversationManager(dbPath);
    await conversationManager.initialize();

    const compressionClient = createCompressionClient(null);
    if (compressionClient) {
      conversationManager.setAiClient(compressionClient);
    } else {
      app.log.warn('Runtime compression disabled: no compatible decision client available');
    }

    // Initialize chat session controller (recover crashed sessions)
    // In unit tests, ConversationManager/DB may be mocked and not initialized.
    const sessionController = ChatSessionController.getInstance();
    if (!isTestMode) {
      sessionController.initialize();
    }

    // Initialize chat handler
    const dbManager = DatabaseManager.getInstance();
    const sessionEventsDAO = dbManager.getSessionEventsDAO();
    const sessionEventHub = SessionEventHub.getInstance();

    // Initialize ToolRegistry and register providers
    toolRegistry = new ToolRegistry();

    const browserToolsProvider = new BrowserToolsProvider(browserClient);
    toolRegistry.registerProvider(browserToolsProvider);

    const visionConfigOverride = buildVisionAgentConfig(config);
    const visionAgentProvider = new VisionAgentProvider(browserClient, visionConfigOverride);
    toolRegistry.registerProvider(visionAgentProvider);

    const mcpClient = appService.getMCPSDKClient();
    if (mcpClient) {
      const mcpClientProvider = new MCPClientProvider(mcpClient);
      toolRegistry.registerProvider(mcpClientProvider);
    }

    await toolRegistry.initializeAll();

    // Make ToolRegistry accessible through AppService for debug endpoints
    appService.setToolRegistry(toolRegistry);

    chatHandler = new ChatHandler(
      conversationManager,
      config,
      mcpClient || undefined,
      sessionEventsDAO,
      sessionEventHub,
      browserClient,
      toolRegistry,
    );

    // Decorate Fastify with conversation management
    await app.decorate('conversationManager', conversationManager);
    await app.decorate('chatHandler', chatHandler);

    // Initialize and decorate job queue
    const persistWorker = new StreamPersistWorker();
    const jobQueue = new ConversationJobQueue(persistWorker, SessionEventHub.getInstance());
    await app.decorate('jobQueue', jobQueue);

    // Register API routes with v1 versioning prefix
    // Versioned routes (canonical)
    await app.register(healthRoutes, { prefix: '/api/v1/health' });
    await app.register(configRoutes, { prefix: '/api/v1/config' });
    await app.register(livekitTokenRoutes, { prefix: '/api/v1' });
    await app.register(aiServiceRoutes, { prefix: '/api/v1/ai' });
    await app.register(apiChatRoutes, { prefix: '/api/v1/chat' });

    // Legacy unversioned routes (backward compatibility, will be deprecated)
    await app.register(healthRoutes, { prefix: '/api/health' });
    await app.register(configRoutes, { prefix: '/api/config' });
    await app.register(livekitTokenRoutes, { prefix: '/api' });
    await app.register(aiServiceRoutes, { prefix: '/api/ai' });
    await app.register(apiChatRoutes, { prefix: '/api/chat' });

    app.log.info({ prefix: '/api/v1/chat' }, 'API v1 chat routes registered');
    app.log.info({ prefix: '/api/v1/ai' }, 'API v1 AI service routes registered');
    app.log.info({ prefix: '/api/chat' }, 'Legacy chat routes registered (deprecated)');
    app.log.info({ prefix: '/api/ai' }, 'Legacy AI routes registered (deprecated)');

    // Register Debug routes
    await app.register(debugRoutes, { prefix: '/debug' });
    app.log.info({ prefix: '/debug' }, 'Debug routes registered');
    app.log.info({ subscribers: debugEventHub.getSubscriberCount() }, 'Debug event hub ready');

    // Register MCP Server plugin
    await app.register(mcpServerPlugin, { toolRegistry });

    const mcpStatus = appService.getMCPStatus();
    app.log.info({ configPath: appService.getConfigPath() }, 'Configuration loaded');
    app.log.info(
      { browser: mcpStatus.enabled ? 'OK' : 'Disabled', file: mcpStatus.enabled ? 'OK' : 'Disabled' },
      'MCP Systems status'
    );

    app.get(
      '/',
      {
        schema: {
          description: 'Get service info and available endpoints',
          tags: ['Health'],
          response: {
            200: {
              type: 'object',
              properties: {
                service: { type: 'string' },
                version: { type: 'string' },
                mode: { type: 'string' },
                endpoints: { type: 'object' },
              },
            },
          },
        },
      },
      async () => {
        return {
              service: 'Proxy Adapter',
              version: '2.0.0',
              mode: 'multi-model',
              endpoints: {
                'GET /api/v1/health': 'Health check',
                'GET /api/v1/config': 'Show current configuration',
                'POST /api/v1/ai/generate': 'Generate plain text with the decision model',
                'GET /api/v1/chat/*': 'Chat API (SSE)',
                'GET /debug/api/*': 'Debug API endpoints',
              },
              deprecation: {
                note: 'Unversioned /api/* routes are deprecated. Use /api/v1/* instead.',
              },
            };
      }
    );

    await app.listen({ port: PORT, host: HOST });
    app.log.info({ url: `http://localhost:${PORT}` }, 'Proxy Adapter running');
    app.log.info('Available endpoints:');
    app.log.info({ endpoint: 'GET  /api/v1/health' });
    app.log.info({ endpoint: 'GET  /api/v1/config' });
    app.log.info({ endpoint: 'POST /api/v1/ai/generate' });
    app.log.info({ endpoint: 'GET  /api/v1/chat/*    - Chat API (SSE)' });
    app.log.info({ endpoint: 'GET  /debug/api/*       - Debug API' });
    app.log.info({ endpoint: '(deprecated) /api/*     - Use /api/v1/* instead' });
  } catch (err) {
    await debugStreamBridge.stop();
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  app.log.info('Shutting down gracefully...');
  if (toolRegistry) {
    await toolRegistry.shutdownAll();
  }
  if (conversationManager) {
    await conversationManager.close();
  }
  await debugStreamBridge.stop();
  await shutdownBrowserEngine();
  await appService.shutdown();
  await app.close();
  process.exit(0);
});

start();
