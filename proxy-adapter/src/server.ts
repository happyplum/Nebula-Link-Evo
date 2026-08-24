import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { appService } from './services/index.js';
import { browserClient } from './browser-client.js';
import { shutdownBrowserEngine } from './browser-engine/index.js';
import { debugEventHub } from './services/debug-event-hub.js';
import { initializeWithBackup } from './utils/db-backup.js';
import { normalizeLogLevel } from './services/logger.js';
import { interactionLogger } from './services/interaction-logger.js';
import healthRoutes from './plugins/routes/health.js';
import livekitTokenRoutes from './plugins/routes/api/livekit-token.js';
import debugRoutes from './plugins/routes/debug/index.js';
import { ToolRegistry } from './tools/registry.js';
import mcpServerPlugin from './mcp-server/index.js';
import { BrowserExecutionRepository } from './browser-execution/repository.js';
import { BrowserExecutionService } from './browser-execution/service.js';
import { PlaywrightBrowserExecutionBrowser } from './browser-execution/playwright-browser.js';
import { LocalBrowserArtifactStore } from './browser-execution/artifact-store.js';
import { BrowserExecutionToolsProvider } from './tools/providers/browser-execution-tools-provider.js';
import capabilitiesRoutes from './plugins/routes/capabilities.js';
import browserExecutionRoutes from './plugins/routes/browser-execution.js';

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
const DEBUG_DB_PATH = path.join(process.cwd(), 'data', 'proxy-adapter', 'debug.sqlite');
const BROWSER_EXECUTION_DB_PATH = path.join(
  process.cwd(),
  'data',
  'proxy-adapter',
  'browser-execution.sqlite'
);
const BROWSER_ARTIFACT_ROOT = path.join(process.cwd(), 'data', 'proxy-adapter', 'artifacts');

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
  return envVal
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Server bind address.
 * - Default: 127.0.0.1 (localhost only)
 * - Set HOST=0.0.0.0 to listen on all interfaces (for Docker/remote)
 */
const HOST = process.env.HOST || '127.0.0.1';

let toolRegistry: ToolRegistry;
let browserExecutionService: BrowserExecutionService | undefined;

async function start() {
  try {
    const isTestMode = process.env.TEST_MODE === 'true';
    if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
      throw new Error('proxy-adapter must bind to a loopback host');
    }

    // Initialize database backup before starting server (skip in unit tests)
    if (!isTestMode) {
      await initializeWithBackup(DEBUG_DB_PATH);
    }

    await app.register(cors, {
      origin: resolveCorsOrigin(),
      credentials: true,
    });

    // Initialize ToolRegistry and register providers
    toolRegistry = new ToolRegistry();

    browserExecutionService = new BrowserExecutionService({
      repository: new BrowserExecutionRepository(BROWSER_EXECUTION_DB_PATH),
      browser: new PlaywrightBrowserExecutionBrowser(),
      artifactStore: new LocalBrowserArtifactStore(BROWSER_ARTIFACT_ROOT),
      controlPlaneEnabled: true,
    });
    browserExecutionService.initialize();
    browserClient.setAccessArbiter(browserExecutionService);

    toolRegistry.registerProvider(new BrowserExecutionToolsProvider(browserExecutionService));

    await toolRegistry.initializeAll();

    // Make ToolRegistry accessible through AppService for debug endpoints
    appService.setToolRegistry(toolRegistry);

    // Register API routes with v1 versioning prefix
    // Versioned routes (canonical)
    await app.register(healthRoutes, { prefix: '/api/v1/health' });
    await app.register(livekitTokenRoutes, { prefix: '/api/v1' });
    await app.register(capabilitiesRoutes, {
      prefix: '/api/v1',
      browserExecutionService,
    });
    await app.register(browserExecutionRoutes, {
      prefix: '/api/v1/browser-execution',
      browserExecutionService,
    });

    // Register Debug routes
    await app.register(debugRoutes, {
      prefix: '/debug',
      browserExecutionService,
    });
    app.log.info({ prefix: '/debug' }, 'Debug routes registered');
    app.log.info({ subscribers: debugEventHub.getSubscriberCount() }, 'Debug event hub ready');

    // Register MCP Server plugin
    await app.register(mcpServerPlugin, { toolRegistry });

    const mcpStatus = appService.getMCPStatus();
    app.log.info(
      {
        browser: mcpStatus.enabled ? 'OK' : 'Disabled',
        file: mcpStatus.enabled ? 'OK' : 'Disabled',
      },
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
          mode: 'browser-gateway',
          endpoints: {
            'GET /api/v1/health': 'Health check',
            'GET /api/v1/capabilities': 'Browser execution capabilities',
            'POST /api/v1/browser-execution/sessions': 'Create a controlled browser session',
            'POST /mcp': 'MCP StreamableHTTP endpoint exposing browser-control tools',
            'GET /debug/api/*': 'Debug API endpoints',
          },
        };
      }
    );

    await app.listen({ port: PORT, host: HOST });
    app.log.info({ url: `http://localhost:${PORT}` }, 'Proxy Adapter running');
    app.log.info('Available endpoints:');
    app.log.info({ endpoint: 'GET  /api/v1/health' });
    app.log.info({ endpoint: 'GET  /api/v1/capabilities' });
    app.log.info({ endpoint: 'POST /api/v1/browser-execution/sessions' });
    app.log.info({ endpoint: 'POST /mcp              - MCP StreamableHTTP' });
    app.log.info({ endpoint: 'GET  /debug/api/*       - Debug API' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

let shutdownPromise: Promise<void> | undefined;

function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  shutdownPromise ??= (async () => {
    app.log.info({ signal }, '[proxy-adapter] shutdown');
    await app.close();
    await interactionLogger.destroy();
    if (toolRegistry) await toolRegistry.shutdownAll();
    if (browserExecutionService) await browserExecutionService.shutdown();
    await shutdownBrowserEngine();
  })();
  return shutdownPromise;
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => process.exit(0));
});

start();
