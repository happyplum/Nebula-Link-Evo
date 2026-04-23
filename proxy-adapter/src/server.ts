import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { taskService } from './services/index.js';
import { DebugWebSocketManager } from './websocket-manager.js';
import { browserClient } from './browser-client.js';
import { ConversationManager, ChatHandler } from './conversation/index.js';
import { DatabaseManager } from './conversation/db.js';
import { createCompressionClient } from './clients/compression.js';
import { ChatSessionController } from './services/chat-session-controller.js';
import { SessionEventHub } from './services/session-event-hub.js';
import { initializeWithBackup } from './utils/db-backup.js';
import healthRoutes from './plugins/routes/health.js';
import configRoutes from './plugins/routes/config.js';
import taskRoutes from './plugins/routes/task.js';
import livekitTokenRoutes from './plugins/routes/api/livekit-token.js';
import debugRoutes from './plugins/routes/debug/index.js';
import chatRoutes from './plugins/routes/chat/index.js';
import apiChatRoutes from './plugins/routes/api/chat/index.js';
import chatSocketRoutes from './plugins/routes/ws/chat-socket.js';
import debugSocketRoutes from './plugins/routes/ws/debug-socket.js';
import { runPreflight } from './services/provider/preflight.js';

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
    level: 'warn',
  },
});

const wsManager = DebugWebSocketManager.getInstance();
const PORT = parseInt(process.env.PROXY_PORT || '3000');

let conversationManager: ConversationManager;
let chatHandler: ChatHandler;

async function start() {
  try {
    const isTestMode = process.env.TEST_MODE === 'true';

    // Initialize database backup before starting server (skip in unit tests)
    if (!isTestMode) {
      await initializeWithBackup();
    }

    await app.register(cors, {
      origin: true,
      credentials: true,
    });

    await app.register(websocket);

    await app.decorate('taskExecutor', taskService);
    await app.decorate('wsManager', wsManager);
    await app.decorate('browserClient', browserClient);

    // Initialize task service first to load configuration
    // This must happen before route registration to ensure config is available
    await taskService.initialize();

    // Run provider preflight checks
    const registry = taskService.getRegistry();
    const preflightConfig = taskService.getConfig();
    if (registry && preflightConfig) {
      const providerKeys = Object.keys(preflightConfig.providers ?? {}).filter(k => preflightConfig.providers[k].enabled);
      await runPreflight(registry, providerKeys);
    }

    // Get config for chat handler
    const config = taskService.getConfig();
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

    chatHandler = new ChatHandler(
      conversationManager,
      config,
      wsManager,
      taskService.getMCPSDKClient() || undefined,
      sessionEventsDAO,
      sessionEventHub
    );

    // Decorate Fastify with conversation management
    await app.decorate('conversationManager', conversationManager);
    await app.decorate('chatHandler', chatHandler);

    // Set chat handler in WebSocket manager
    wsManager.setChatHandler(chatHandler);

    await app.register(healthRoutes, { prefix: '/api/health' });
    await app.register(configRoutes, { prefix: '/api/config' });
    await app.register(taskRoutes, { prefix: '/api/task' });
    await app.register(livekitTokenRoutes, { prefix: '/api' });

    // Register Chat routes - Independent WebSocket channel for chat sessions
    await app.register(chatRoutes, { prefix: '/chat' });
    app.log.info({ prefix: '/chat' }, 'Chat routes registered');

    // Register WebSocket routes - /ws/* prefix architecture
    await app.register(chatSocketRoutes, { prefix: '/ws' });
    await app.register(debugSocketRoutes, { prefix: '/ws' });
    app.log.info({ prefix: '/ws' }, 'WebSocket routes registered');

    // Register API chat routes - Async message handling and SSE streaming
    await app.register(apiChatRoutes, { prefix: '/api/chat' });
    app.log.info({ prefix: '/api/chat' }, 'API chat routes registered');

    // Register Debug routes
    await app.register(debugRoutes, { prefix: '/debug' });
    app.log.info({ prefix: '/debug' }, 'Debug routes registered');

    const mcpStatus = taskService.getMCPStatus();
    app.log.info({ configPath: taskService.getConfigPath() }, 'Configuration loaded');
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
            'POST /api/task': 'Execute automation task',
            'GET /api/health': 'Health check',
            'GET /api/config': 'Show current configuration',
            'GET /debug/api/*': 'Debug API endpoints',
            'WS /chat/ws': 'Chat WebSocket for session subscriptions (legacy)',
            'WS /ws/chat': 'Chat WebSocket for session subscriptions (new)',
            'WS /debug/ws': 'Debug WebSocket for real-time updates',
          },
        };
      }
    );

    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info({ url: `http://localhost:${PORT}` }, 'Proxy Adapter running');
    app.log.info('Available endpoints:');
    app.log.info({ endpoint: 'POST /api/task' });
    app.log.info({ endpoint: 'GET  /api/health' });
    app.log.info({ endpoint: 'GET  /api/config' });
    app.log.info({ endpoint: 'WS   /ws/debug     - Debug WebSocket (new)' });
    app.log.info({ endpoint: 'WS   /ws/chat      - Chat WebSocket (new)' });
    app.log.info({ endpoint: 'WS   /debug/ws    - Debug WebSocket (legacy)' });
    app.log.info({ endpoint: 'WS   /chat/ws      - Chat WebSocket (legacy)' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  app.log.info('Shutting down gracefully...');
  if (conversationManager) {
    await conversationManager.close();
  }
  await taskService.shutdown();
  await app.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  app.log.info('Shutting down gracefully...');
  if (conversationManager) {
    await conversationManager.close();
  }
  await taskService.shutdown();
  await app.close();
  process.exit(0);
});

start();
