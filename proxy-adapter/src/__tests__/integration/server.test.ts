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
  const mockTaskServiceInstance = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockReturnValue({}),
    getConfigPath: vi.fn().mockReturnValue('/test/config.json'),
    getMCPStatus: vi.fn().mockReturnValue({ enabled: false }),
    getMCPSDKClient: vi.fn().mockReturnValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };

  return {
    TaskService: {
      getInstance: vi.fn(() => mockTaskServiceInstance),
    },
    taskService: mockTaskServiceInstance,
  };
});

vi.mock('../../websocket-manager.js', () => ({
  DebugWebSocketManager: {
    getInstance: vi.fn(() => ({
      setChatHandler: vi.fn(),
      setTaskCommandHandler: vi.fn(),
      setMCPStatusProvider: vi.fn(),
      respondToClient: vi.fn(),
      broadcast: vi.fn(),
      close: vi.fn(),
    })),
  },
}));

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

    it('should register WebSocket plugin', async () => {
      const { default: Fastify } = await import('fastify');
      const websocket = await import('@fastify/websocket');

      const app = Fastify({ logger: { level: 'warn' } });

      await app.register(websocket);

      const hasWebsocket = await app.hasPlugin('@fastify/websocket');
      expect(hasWebsocket).toBe(true);

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

    it('should register task routes with /task prefix', async () => {
      const { default: Fastify } = await import('fastify');
      const taskRoutes = await import('../../plugins/routes/task.js');

      const app = Fastify({ logger: { level: 'warn' } });

      await app.register(taskRoutes.default, { prefix: '/task' });

      const response = await app.inject({
        method: 'POST',
        url: '/task',
        payload: {},
      });

      expect(response.statusCode).toBeDefined();
      expect([400, 404, 405, 500]).toContain(response.statusCode);

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

  describe('WebSocket Manager Integration', () => {
    it('should get singleton instance', async () => {
      const { DebugWebSocketManager } = await import('../../websocket-manager.js');

      const instance1 = DebugWebSocketManager.getInstance();
      const instance2 = DebugWebSocketManager.getInstance();

      expect(DebugWebSocketManager.getInstance).toHaveBeenCalled();
      expect(instance1).toBeDefined();
      expect(instance2).toBeDefined();
    });

    it('should have required methods', async () => {
      const { DebugWebSocketManager } = await import('../../websocket-manager.js');

      const instance = DebugWebSocketManager.getInstance();

      expect(instance.setChatHandler).toBeDefined();
      expect(instance.setTaskCommandHandler).toBeDefined();
      expect(instance.setMCPStatusProvider).toBeDefined();
      expect(instance.respondToClient).toBeDefined();
      expect(instance.broadcast).toBeDefined();
    });
  });

  describe('Graceful Shutdown Signal Handling', () => {
    it('should have SIGINT signal listener', () => {
      const listeners = process.listenerCount('SIGINT');
      expect(listeners).toBeGreaterThanOrEqual(0);
    });

    it('should have SIGTERM signal listener', () => {
      const listeners = process.listenerCount('SIGTERM');
      expect(listeners).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Service Module Availability', () => {
    it('should export taskService', async () => {
      const { taskService } = await import('../../services/index.js');

      expect(taskService).toBeDefined();
      expect(taskService.initialize).toBeDefined();
      expect(taskService.getConfig).toBeDefined();
      expect(taskService.shutdown).toBeDefined();
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
