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
      const providerKeys = Object.keys(preflightConfig._resolved?.providers ?? {});
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
      console.warn('[WARN] Runtime compression disabled: no compatible decision client available');
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
    console.log('[INFO] Chat routes registered: /chat/ws');

    // Register WebSocket routes - /ws/* prefix architecture
    await app.register(chatSocketRoutes, { prefix: '/ws' });
    await app.register(debugSocketRoutes, { prefix: '/ws' });
    console.log('[INFO] WebSocket routes registered: /ws/chat, /ws/debug');

    // Register API chat routes - Async message handling and SSE streaming
    await app.register(apiChatRoutes, { prefix: '/api/chat' });
    console.log('[INFO] API chat routes registered: /api/chat/*');

    // Register Debug routes
    await app.register(debugRoutes, { prefix: '/debug' });
    console.log('[INFO] Debug routes registered: /debug/api/*, /debug/ws');

    const mcpStatus = taskService.getMCPStatus();
    console.log(`[INFO] Configuration loaded from: ${taskService.getConfigPath()}`);
    console.log(
      `[INFO] MCP Systems: [Browser: ${mcpStatus.enabled ? 'OK' : 'Disabled'}, File: ${mcpStatus.enabled ? 'OK' : 'Disabled'}]`
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
    console.log(`Proxy Adapter running on http://localhost:${PORT}`);
    console.log('Available endpoints:');
    console.log(`  POST http://localhost:${PORT}/api/task`);
    console.log(`  GET  http://localhost:${PORT}/api/health`);
    console.log(`  GET  http://localhost:${PORT}/api/config`);
    console.log(`  WS   ws://localhost:${PORT}/ws/debug     - Debug WebSocket (new)`);
    console.log(`  WS   ws://localhost:${PORT}/ws/chat      - Chat WebSocket (new)`);
    console.log(`  WS   ws://localhost:${PORT}/debug/ws    - Debug WebSocket (legacy)`);
    console.log(`  WS   ws://localhost:${PORT}/chat/ws      - Chat WebSocket (legacy)`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  if (conversationManager) {
    await conversationManager.close();
  }
  await taskService.shutdown();
  await app.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  if (conversationManager) {
    await conversationManager.close();
  }
  await taskService.shutdown();
  await app.close();
  process.exit(0);
});

start();
