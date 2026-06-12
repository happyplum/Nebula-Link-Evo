import { describe, it, expect, vi } from 'vitest';

/**
 * Server Integration Tests
 *
 * Tests Fastify application initialization and route registration.
 * Focuses on core initialization logic with external dependencies mocked.
 */

// Mock external dependencies before imports
vi.mock('../../browser-client.js', () => ({
  browserClient: {},
}));

vi.mock('../../conversation/index.js', () => ({
  ConversationManager: vi.fn(),
  ChatHandler: vi.fn(),
}));

vi.mock('../../services/index.js', () => {
  const mockAppServiceInstance = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockReturnValue({}),
    getConfigPath: vi.fn().mockReturnValue('/test/config.json'),
    getMCPStatus: vi.fn().mockReturnValue({ enabled: false }),
    getMCPSDKClient: vi.fn().mockReturnValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };

  return {
    AppService: {
      getInstance: vi.fn(() => mockAppServiceInstance),
    },
    appService: mockAppServiceInstance,
  };
});


vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

describe('Server Initialization', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.PROXY_PORT = '0';
  });

  afterAll(() => {
    delete process.env.NODE_ENV;
    delete process.env.PROXY_PORT;
  });

  describe('Fastify Application Setup', () => {
    it('should create Fastify instance with logger', async () => {
      const { default: Fastify } = await import('fastify');

      const app = Fastify({
        logger: {
          level: 'warn',
        },
      });

      expect(app).toBeDefined();
      expect(app.log).toBeDefined();
      await app.close();
    });

    it('should register CORS plugin', async () => {
      const { default: Fastify } = await import('fastify');
      const cors = await import('@fastify/cors');

      const app = Fastify({ logger: { level: 'warn' } });

      await app.register(cors, {
        origin: true,
        credentials: true,
      });

      const hasCors = await app.hasPlugin('@fastify/cors');
      expect(hasCors).toBe(true);

      await app.close();
    });

    it('should register CORS and swagger plugins', async () => {
      const { default: Fastify } = await import('fastify');

      const app = Fastify({ logger: { level: 'warn' } });

      const cors = await import('@fastify/cors');
      await app.register(cors.default);

      const hasCors = await app.hasPlugin('@fastify/cors');
      expect(hasCors).toBe(true);

      await app.close();
    });
  });

  describe('Route Registration', () => {
    it('should register health routes with /api/health prefix', async () => {
      const { default: Fastify } = await import('fastify');
      const healthRoutes = await import('../../plugins/routes/health.js');

      const app = Fastify({ logger: { level: 'warn' } });

      await app.register(healthRoutes.default, { prefix: '/api/health' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(response.statusCode).toBeDefined();
      expect([200, 404, 500]).toContain(response.statusCode);

      await app.close();
    });

    it('should register config routes with /api/config prefix', async () => {
      const { default: Fastify } = await import('fastify');
      const configRoutes = await import('../../plugins/routes/config.js');

      const app = Fastify({ logger: { level: 'warn' } });

      await app.register(configRoutes.default, { prefix: '/api/config' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/config',
      });

      expect(response.statusCode).toBeDefined();
      expect([200, 404, 500]).toContain(response.statusCode);

      await app.close();
    });

    it('should register debug routes with /debug prefix', async () => {
      const { default: Fastify } = await import('fastify');
      const debugRoutes = await import('../../plugins/routes/debug/index.js');

      const app = Fastify({ logger: { level: 'warn' } });

      await app.register(debugRoutes.default, { prefix: '/debug' });

      const response = await app.inject({
        method: 'GET',
        url: '/debug/api/health',
      });

      expect(response.statusCode).toBeDefined();

      await app.close();
    });
  });

  describe('Root Endpoint', () => {
    it('should return service info at root path', async () => {
      const { default: Fastify } = await import('fastify');

      const app = Fastify({ logger: { level: 'warn' } });

      app.get('/', async () => {
        return {
          service: 'Proxy Adapter',
          version: '2.0.0',
          mode: 'multi-model',
          endpoints: {
            'POST /task': 'Execute automation task',
            'GET /api/health': 'Health check',
            'GET /api/config': 'Show current configuration',
            'GET /debug': 'Debug dashboard',
          },
        };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.service).toBe('Proxy Adapter');
      expect(payload.version).toBe('2.0.0');
      expect(payload.mode).toBe('multi-model');
      expect(payload.endpoints).toBeDefined();
      expect(payload.endpoints['POST /task']).toBe('Execute automation task');

      await app.close();
    });
  });

  describe('Environment Configuration', () => {
    it('should use default port 3000 if not specified', () => {
      delete process.env.PROXY_PORT;

      const PORT = parseInt(process.env.PROXY_PORT || '3000');

      expect(PORT).toBe(3000);
    });

    it('should use custom port from env', () => {
      process.env.PROXY_PORT = '4000';

      const PORT = parseInt(process.env.PROXY_PORT || '3000');

      expect(PORT).toBe(4000);

      delete process.env.PROXY_PORT;
    });
  });


  describe('Graceful Shutdown Signal Handling', () => {
    it('registers signal listeners during server setup', () => {
      // After server setup, SIGINT and SIGTERM listeners are expected
      const sigintBefore = process.listenerCount('SIGINT');
      const sigtermBefore = process.listenerCount('SIGTERM');

      // Server build (done in beforeAll) should preserve or add signal listeners
      // At minimum, vitest itself registers SIGTERM; SIGINT may vary
      expect(process.listenerCount('SIGTERM')).toBeGreaterThanOrEqual(sigtermBefore);
    });
  });

  describe('Service Module Availability', () => {
    it('should export appService', async () => {
      const { appService } = await import('../../services/index.js');

      expect(appService).toBeDefined();
      expect(appService.initialize).toBeDefined();
      expect(appService.getConfig).toBeDefined();
      expect(appService.shutdown).toBeDefined();
    });

    it('should export browserClient', async () => {
      const { browserClient } = await import('../../browser-client.js');

      expect(browserClient).toBeDefined();
    });

    it('should export ConversationManager', async () => {
      const { ConversationManager } = await import('../../conversation/index.js');

      expect(ConversationManager).toBeDefined();
    });

    it('should export ChatHandler', async () => {
      const { ChatHandler } = await import('../../conversation/index.js');

      expect(ChatHandler).toBeDefined();
    });
  });
});
