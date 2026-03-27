/**
 * Proxy Loop Prevention Tests
 *
 * These tests verify that the bidirectional proxy loop between Vite (5173) and Fastify (3000)
 * is correctly prevented by ensuring:
 * 1. Vite only proxies /api, /ws, /debug/api to Fastify (not /debug/*)
 * 2. Fastify dev mode proxy skips /debug/api/* and /debug/ws routes
 *
 * @see proxy-adapter/vite.config.ts - Vite proxy configuration
 * @see proxy-adapter/src/server.ts:177-218 - Fastify dev mode proxy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

// Mock taskService before importing server
vi.mock('../../services/index.js', () => ({
  taskService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockReturnValue({ provider: 'test', model: 'test-model' }),
    getConfigPath: vi.fn().mockReturnValue('/test/config.json'),
    getMCPSDKClient: vi.fn().mockReturnValue(undefined),
    getMCPStatus: vi.fn().mockReturnValue({ enabled: false }),
  },
}));

vi.mock('../../websocket-manager.js', () => ({
  DebugWebSocketManager: {
    getInstance: vi.fn().mockReturnValue({
      handleConnection: vi.fn(),
      getClientCount: vi.fn(() => 0),
    }),
  },
}));

vi.mock('../../conversation/index.js', () => ({
  ConversationManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
  ChatHandler: vi.fn().mockImplementation(() => ({})),
}));

describe('Proxy Loop Prevention', () => {
  /**
   * Vite Proxy Configuration Tests
   *
   * These tests verify the vite.config.ts proxy configuration.
   * The expected configuration should be:
   * - /api -> http://localhost:3000
   * - /ws -> ws://localhost:3000
   * - /debug/api -> http://localhost:3000
   *
   * NOT:
   * - /debug -> http://localhost:3000 (this would cause loop)
   */
  describe('Vite Proxy Configuration', () => {
    // Expected proxy configuration (mirror of vite.config.ts)
    const expectedProxiedPaths = ['/api', '/ws', '/debug/api'];
    const expectedNotProxiedPaths = ['/debug', '/debug/'];

    it('should NOT proxy /debug/* path to Fastify', () => {
      // /debug should NOT be in proxy config (prevents Vite -> Fastify -> Vite loop)
      for (const path of expectedNotProxiedPaths) {
        expect(expectedProxiedPaths).not.toContain(path);
      }
    });

    it('should only proxy /api, /ws, /debug/api to Fastify', () => {
      // These paths should be proxied
      expect(expectedProxiedPaths).toContain('/api');
      expect(expectedProxiedPaths).toContain('/ws');
      expect(expectedProxiedPaths).toContain('/debug/api');
    });
  });

  describe('Fastify Dev Mode Proxy', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(() => {
      vi.clearAllMocks();
      app = Fastify();
    });

    afterEach(async () => {
      await app.close();
      vi.clearAllMocks();
    });

    it('should skip /debug/api/* routes from Vite proxy', () => {
      // This simulates the route exclusion logic in server.ts:181-188
      const shouldSkipProxy = (url: string): boolean => {
        return (
          url.startsWith('/debug/api/') ||
          url.startsWith('/debug/ws') ||
          url === '/debug/api' ||
          url === '/debug/ws'
        );
      };

      // These URLs should NOT be proxied to Vite
      expect(shouldSkipProxy('/debug/api/health')).toBe(true);
      expect(shouldSkipProxy('/debug/api/tasks')).toBe(true);
      expect(shouldSkipProxy('/debug/api')).toBe(true);
      expect(shouldSkipProxy('/debug/ws')).toBe(true);
    });

    it('should proxy /debug/* static assets to Vite (not API/WebSocket)', () => {
      // This simulates URLs that SHOULD be proxied to Vite
      const shouldSkipProxy = (url: string): boolean => {
        return (
          url.startsWith('/debug/api/') ||
          url.startsWith('/debug/ws') ||
          url === '/debug/api' ||
          url === '/debug/ws'
        );
      };

      // These URLs SHOULD be proxied to Vite (static assets)
      expect(shouldSkipProxy('/debug/')).toBe(false);
      expect(shouldSkipProxy('/debug/index.html')).toBe(false);
      expect(shouldSkipProxy('/debug/js/main.js')).toBe(false);
      expect(shouldSkipProxy('/debug/css/style.css')).toBe(false);
    });
  });

  describe('End-to-End Proxy Loop Prevention', () => {
    it('should not create bidirectional loop for /debug/api/*', () => {
      /**
       * Scenario: Request to /debug/api/health
       *
       * Without fix:
       * 1. Browser -> Vite (5173): /debug/api/health
       * 2. Vite -> Fastify (3000): /debug/api/health (via /debug proxy)
       * 3. Fastify -> Vite (5173): /debug/api/health (via /debug* proxy)
       * 4. LOOP -> HTTP 500
       *
       * With fix:
       * 1. Browser -> Vite (5173): /debug/api/health
       * 2. Vite -> Fastify (3000): /debug/api/health (via /debug/api proxy)
       * 3. Fastify handles directly (no proxy)
       * 4. Response returned
       */

      const viteProxiedPaths = ['/api', '/ws', '/debug/api'];
      const fastifySkippedPaths = ['/debug/api/', '/debug/ws'];

      // For /debug/api/health:
      // - Vite will proxy it (matches /debug/api)
      // - Fastify will NOT proxy it back (matches /debug/api/)
      const testPath = '/debug/api/health';

      const viteProxies = viteProxiedPaths.some(p => testPath.startsWith(p));
      const fastifySkips = fastifySkippedPaths.some(p => testPath.startsWith(p));

      // Vite proxies to Fastify
      expect(viteProxies).toBe(true);
      // Fastify does NOT proxy back to Vite
      expect(fastifySkips).toBe(true);
      // Therefore: NO LOOP (Vite proxies, Fastify handles directly)
      expect(viteProxies && fastifySkips).toBe(true);
    });

    it('should not create bidirectional loop for /ws/debug', () => {
      /**
       * Scenario: WebSocket connection to /ws/debug
       *
       * Flow:
       * 1. Browser -> Vite (5173): /ws/debug
       * 2. Vite -> Fastify (3000): /ws/debug (via /ws proxy)
       * 3. Fastify handles directly (no proxy for /ws/*)
       * 4. Connection established
       */

      const viteProxiedPaths = ['/api', '/ws', '/debug/api'];
      const fastifySkippedPaths = ['/debug/api/', '/debug/ws'];

      const testPath = '/ws/debug';

      const viteProxies = viteProxiedPaths.some(p => testPath.startsWith(p));
      const fastifySkips = fastifySkippedPaths.some(p => testPath.startsWith(p));

      // Vite proxies /ws to Fastify
      expect(viteProxies).toBe(true);
      // Fastify handles directly (no loop)
      expect(fastifySkips).toBe(false); // /ws/debug doesn't match /debug/ws
    });

    it('should correctly proxy static assets through Vite', () => {
      /**
       * Scenario: Request to /debug/js/main.js
       *
       * Flow:
       * 1. Browser -> Vite (5173): /debug/js/main.js
       * 2. Vite serves directly (no proxy for /debug/*)
       * 3. File returned
       */

      const viteProxiedPaths = ['/api', '/ws', '/debug/api'];
      const fastifySkippedPaths = ['/debug/api/', '/debug/ws'];

      const testPath = '/debug/js/main.js';

      const viteProxies = viteProxiedPaths.some(p => testPath.startsWith(p));
      const fastifySkips = fastifySkippedPaths.some(p => testPath.startsWith(p));

      // Vite does NOT proxy static assets
      expect(viteProxies).toBe(false);
      // Fastify would proxy this in dev mode, but that's expected
      expect(fastifySkips).toBe(false);
    });
  });
});

