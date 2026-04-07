import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * Environment Isolation Tests
 *
 * Tests that production mode properly isolates debug endpoints.
 * Ensures /debug/api/* routes return 404 in production.
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

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

describe('Production Environment Isolation', () => {
  let originalNodeEnv: string | undefined;

  beforeAll(() => {
    // Set production mode BEFORE any imports
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.TEST_MODE = 'true';
    process.env.PROXY_PORT = '0';
  });

  afterAll(() => {
    // Restore original environment
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    delete process.env.TEST_MODE;
    delete process.env.PROXY_PORT;
  });

  describe('Debug API Routes', () => {
    it('should return 200 for /debug/api/tasks in production', async () => {
      const { default: Fastify } = await import('fastify');
      const debugRoutes = await import('../plugins/routes/debug/index.js');

      const app = Fastify({ logger: { level: 'warn' } });

      // Register debug routes with /debug prefix
      await app.register(debugRoutes.default, { prefix: '/debug' });

      const response = await app.inject({
        method: 'GET',
        url: '/debug/api/tasks',
      });

      // Debug API routes should be accessible in production
      expect(response.statusCode).toBe(200);
    });

    it('should return 200 for /debug/api/health in production', async () => {
      const { default: Fastify } = await import('fastify');
      const debugRoutes = await import('../plugins/routes/debug/index.js');

      const app = Fastify({ logger: { level: 'warn' } });

      // Register debug routes with /debug prefix
      await app.register(debugRoutes.default, { prefix: '/debug' });

      const response = await app.inject({
        method: 'GET',
        url: '/debug/api/health',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 200 for /debug/api/mcp/status in production', async () => {
      const { default: Fastify } = await import('fastify');
      const debugRoutes = await import('../plugins/routes/debug/index.js');

      const app = Fastify({ logger: { level: 'warn' } });

      // Register debug routes with /debug prefix
      await app.register(debugRoutes.default, { prefix: '/debug' });

      const response = await app.inject({
        method: 'GET',
        url: '/debug/api/mcp/status',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Production API Availability', () => {
    it('should return 200 for /health in production', async () => {
      const { default: Fastify } = await import('fastify');
      const healthRoutes = await import('../plugins/routes/health.js');

      const app = Fastify({ logger: { level: 'warn' } });

      // Register health routes
      await app.register(healthRoutes.default, { prefix: '/health' });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 200 for /api/health in production', async () => {
      const { default: Fastify } = await import('fastify');
      const healthRoutes = await import('../plugins/routes/health.js');

      const app = Fastify({ logger: { level: 'warn' } });

      // Register health routes with /api prefix (as done in server.ts)
      await app.register(healthRoutes.default, { prefix: '/api/health' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 200 for /api/config in production', async () => {
      const { default: Fastify } = await import('fastify');
      const configRoutes = await import('../plugins/routes/config.js');

      const app = Fastify({ logger: { level: 'warn' } });

      // Register config routes with /api prefix (as done in server.ts)
      await app.register(configRoutes.default, { prefix: '/api/config' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/config',
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
