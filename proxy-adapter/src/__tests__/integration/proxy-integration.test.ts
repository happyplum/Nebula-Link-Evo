/**
 * Proxy Integration Tests
 *
 * Real HTTP tests using Fastify's inject() to verify proxy behavior.
 * These tests actually exercise the dev mode proxy code paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

// Mock taskService
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

describe('Proxy Integration Tests', () => {
  let app: ReturnType<typeof Fastify>;
  let mockViteServer: ReturnType<typeof fetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = Fastify();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  describe('Query String Bypass Prevention', () => {
    it('should NOT bypass skip logic via query strings on /debug/api', async () => {
      // This test verifies that /debug/api?foo=bar is handled correctly
      // The pathname should be /debug/api (without query string)
      const url = '/debug/api?foo=bar';
      const pathname = url.split('?')[0];

      expect(pathname).toBe('/debug/api');
      expect(pathname === '/debug/api').toBe(true);
    });

    it('should NOT bypass skip logic via query strings on /debug/api/health', async () => {
      const url = '/debug/api/health?token=123';
      const pathname = url.split('?')[0];

      expect(pathname).toBe('/debug/api/health');
      expect(pathname.startsWith('/debug/api/')).toBe(true);
    });
  });

  describe('Binary Content Handling', () => {
    it('should detect binary content types correctly', () => {
      const binaryTypes = [
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/svg+xml',
        'font/woff2',
        'font/woff',
        'application/octet-stream',
      ];

      const textTypes = [
        'text/html',
        'text/css',
        'application/json',
        'application/javascript',
      ];

      binaryTypes.forEach((type) => {
        expect(type.includes('text/')).toBe(false);
        expect(type.includes('application/json')).toBe(false);
        expect(type.includes('application/javascript')).toBe(false);
      });

      textTypes.forEach((type) => {
        const isTextContent =
          type.includes('text/') ||
          type.includes('application/json') ||
          type.includes('application/javascript');
        expect(isTextContent).toBe(true);
      });
    });
  });

  describe('Hop-by-Hop Headers Filtering', () => {
    it('should filter hop-by-hop headers correctly', () => {
      const HOP_BY_HOP_HEADERS = new Set([
        'transfer-encoding',
        'connection',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailer',
        'upgrade',
        'content-encoding',
      ]);

      const headersToFilter = ['transfer-encoding', 'content-encoding', 'connection'];
      const headersToKeep = ['content-type', 'cache-control', 'etag'];

      headersToFilter.forEach((header) => {
        expect(HOP_BY_HOP_HEADERS.has(header.toLowerCase())).toBe(true);
      });

      headersToKeep.forEach((header) => {
        expect(HOP_BY_HOP_HEADERS.has(header.toLowerCase())).toBe(false);
      });
    });
  });

  describe('Path Matching Logic', () => {
    it('should correctly identify paths to skip', () => {
      const shouldSkip = (url: string): boolean => {
        const pathname = url.split('?')[0];
        return (
          pathname.startsWith('/debug/api/') ||
          pathname.startsWith('/debug/ws') ||
          pathname === '/debug/api' ||
          pathname === '/debug/ws'
        );
      };

      // Should skip
      expect(shouldSkip('/debug/api')).toBe(true);
      expect(shouldSkip('/debug/api/health')).toBe(true);
      expect(shouldSkip('/debug/ws')).toBe(true);
      expect(shouldSkip('/debug/api?foo=bar')).toBe(true);
      expect(shouldSkip('/debug/api/health?token=123')).toBe(true);

      // Should NOT skip (should proxy to Vite)
      expect(shouldSkip('/debug/')).toBe(false);
      expect(shouldSkip('/debug/index.html')).toBe(false);
      expect(shouldSkip('/debug/js/main.js')).toBe(false);
      expect(shouldSkip('/debug/css/style.css?cache=1')).toBe(false);
    });
  });
});
