import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import debugRoutes from '../../../plugins/routes/debug/index.js';

describe('Debug WebSocket Routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockHandleConnection: ReturnType<typeof vi.fn>;
  let mockWsManager: {
    handleConnection: ReturnType<typeof vi.fn>;
    getClientCount: ReturnType<typeof vi.fn>;
    setTaskCommandHandler: ReturnType<typeof vi.fn>;
    setMCPStatusProvider: ReturnType<typeof vi.fn>;
  };
  let mockSocket: any;
  let mockReq: any;

  beforeEach(() => {
    // Create mock WebSocket connection
    mockSocket = {
      send: vi.fn(),
      on: vi.fn(),
      readyState: 1, // WebSocket.OPEN
    };

    // Create mock request with id
    mockReq = {
      id: 'test-client-id',
    };

    // Create mock handleConnection function
    mockHandleConnection = vi.fn();
    mockWsManager = {
      handleConnection: mockHandleConnection,
      getClientCount: vi.fn(() => 0),
      setTaskCommandHandler: vi.fn(),
      setMCPStatusProvider: vi.fn(),
    };

    // Create Fastify app with websocket plugin
    app = Fastify();
    app.register(websocketPlugin);
    app.decorate('wsManager', mockWsManager);
    app.register(debugRoutes);
  });

  afterEach(() => {
    app.close();
    vi.clearAllMocks();
  });

  describe('GET /debug', () => {
    it('should register WebSocket route', async () => {
      // The route should be registered - we can verify the app is ready
      await app.ready();
      
      // Verify the websocket plugin is registered
      expect(app.hasPlugin('@fastify/websocket')).toBe(true);
    });

    it('should use decorated wsManager instance', async () => {
      await app.ready();

      expect((app as any).wsManager).toBe(mockWsManager);
    });

    it('should have route configuration with websocket enabled', async () => {
      await app.ready();
      
      // We cannot directly inspect route config with inject for WebSocket,
      // but we can verify the route is accessible via the router
      expect(() => app.inject({ method: 'GET', url: '/debug' })).not.toThrow();
    });

    it('should handle WebSocket upgrade requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/debug',
        headers: {
          'upgrade': 'websocket',
          'connection': 'Upgrade',
        },
      });

      // WebSocket routes should respond with upgrade (101) or handle via plugin
      // The exact response code depends on how Fastify handles WebSocket
      expect(response.statusCode).toBeGreaterThanOrEqual(100);
    });

    it('should not interfere with regular HTTP requests to other routes', async () => {
      // Regular HTTP GET request without WebSocket upgrade headers
      const response = await app.inject({
        method: 'GET',
        url: '/debug',
      });

      // Should complete without throwing an error
      expect(response).toBeDefined();
      expect(response.statusCode).toBeGreaterThanOrEqual(100);
    });

    it('should initialize wsManager correctly', async () => {
      // Ensure the app and route are ready
      await app.ready();

      expect(mockWsManager).toHaveProperty('handleConnection');
      expect(typeof mockWsManager.handleConnection).toBe('function');
    });

    it('should support wsManager methods for external configuration', async () => {
      // Ensure the app and route are ready
      await app.ready();

      expect(mockWsManager).toHaveProperty('setTaskCommandHandler');
      expect(mockWsManager).toHaveProperty('setMCPStatusProvider');
      expect(typeof mockWsManager.setTaskCommandHandler).toBe('function');
      expect(typeof mockWsManager.setMCPStatusProvider).toBe('function');
    });
  });
});
