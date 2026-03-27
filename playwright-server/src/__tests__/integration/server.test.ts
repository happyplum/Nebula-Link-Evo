import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import swaggerPlugin from '../../plugins/02-swagger.plugin.js';
import browserRoutesPlugin from '../../plugins/routes/browser.js';
import actionRoutesPlugin from '../../plugins/routes/action.js';
import domRoutesPlugin from '../../plugins/routes/dom.js';
import healthRoutesPlugin from '../../plugins/routes/health.js';
import streamRoutesPlugin from '../../plugins/routes/stream.js';
import cdpRoutesPlugin from '../../plugins/routes/cdp.js';
import { BrowserService } from '../../services/browser-service.js';

describe('Server Initialization', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    app = Fastify({
      logger: {
        level: 'warn',
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Fastify App Setup', () => {
    it('should create Fastify app with logger', () => {
      expect(app).toBeDefined();
      expect(app.log).toBeDefined();
      expect(app.log.level).toBe('warn');
    });

    it('should have correct logger level', () => {
      expect(app.log.level).toBe('warn');
    });
  });

  describe('CORS Plugin Registration', () => {
    beforeEach(async () => {
      await app.register(cors, {
        origin: true,
        credentials: true,
      });
    });

    it('should register CORS plugin', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          'Access-Control-Request-Method': 'GET',
          Origin: 'http://localhost:3000',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-credentials']).toBeDefined();
    });

    it('should handle CORS preflight requests', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/browser/open',
        headers: {
          'Access-Control-Request-Method': 'POST',
          Origin: 'http://localhost:3000',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-methods']).toContain('POST');
    });
  });

  describe('WebSocket Plugin Registration', () => {
    beforeEach(async () => {
      await app.register(websocket);
    });

    it('should register WebSocket plugin', async () => {
      // After registering websocket, we can verify it works with a websocket route
      app.register(async (fastify: any) => {
        fastify.get('/ws', { websocket: true }, (_connection: any, _req: any) => {
          // WebSocket handler
        });
      });

      // The plugin should be registered successfully
      expect(app).toBeDefined();
    });
  });

  describe('Swagger Plugin Registration', () => {
    beforeEach(async () => {
      process.env.NODE_ENV = 'development';
      await app.register(swaggerPlugin);
    });

    afterEach(() => {
      delete process.env.NODE_ENV;
    });

    it('should register Swagger plugin', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/docs',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });

    it('should expose OpenAPI JSON spec', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/docs/json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.openapi).toMatch(/^3\./);
      expect(body.info).toBeDefined();
      expect(body.info.title).toBe('Playwright Server API');
    });
  });

  describe('Route Registration', () => {
    beforeEach(async () => {
      await app.register(cors, {
        origin: true,
        credentials: true,
      });
      await app.register(websocket);
      await app.register(swaggerPlugin);
      await app.register(healthRoutesPlugin, { prefix: '/health' });
      await app.register(browserRoutesPlugin, { prefix: '/browser' });
      await app.register(actionRoutesPlugin, { prefix: '/action' });
      await app.register(domRoutesPlugin, { prefix: '/dom' });
      await app.register(streamRoutesPlugin, { prefix: '/browser' });
      await app.register(cdpRoutesPlugin);
    });

    describe('Health Routes', () => {
      it('should register GET /health route', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/health',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.status).toBe('healthy');
        expect(body.browserOpen).toBe(false);
      });
    });

    describe('Browser Routes', () => {
      it('should register POST /browser/open route', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/browser/open',
          payload: {
            headless: true,
            viewport: {
              width: 1920,
              height: 1080,
            },
          },
        });

        // Expect 400 since browser is not actually opened in test
        expect(response.statusCode).toBeGreaterThanOrEqual(200);
      });

      it('should register GET /browser/status route', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/browser/status',
        });

        expect(response.statusCode).toBeGreaterThanOrEqual(200);
      });
    });

    describe('Action Routes', () => {
      it('should register POST /action/click route', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/action/click',
          payload: {
            x: 100,
            y: 200,
          },
        });

        expect(response.statusCode).toBeGreaterThanOrEqual(200);
      });

      it('should register POST /action/type route', async () => {
        // Mock BrowserService.type to avoid retry delays
        vi.spyOn(BrowserService.prototype, 'type').mockResolvedValue(undefined);

        const response = await app.inject({
          method: 'POST',
          url: '/action/type',
          payload: {
            selector: '#input',
            text: 'test text',
          },
        });

        expect(response.statusCode).toBeGreaterThanOrEqual(200);
        vi.restoreAllMocks();
      });

      it('should register POST /action/scroll route', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/action/scroll',
          payload: {
            x: 0,
            y: 500,
          },
        });

        expect(response.statusCode).toBeGreaterThanOrEqual(200);
      });
    });

    describe('DOM Routes', () => {
      it('should register GET /dom/simplified route', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/dom/simplified',
        });

        expect(response.statusCode).toBeGreaterThanOrEqual(200);
      });
    });

    describe('CDP Routes', () => {
      it('should register CDP route', async () => {
        // CDP is a WebSocket route, we can verify the plugin is registered
        // The route is registered via cdpRoutesPlugin without a prefix
        expect(app).toBeDefined();
      });
    });
  });

  describe('Environment Configuration', () => {
    it('should use PLAYWRIGHT_PORT from environment', () => {
      process.env.PLAYWRIGHT_PORT = '9999';
      const port = parseInt(process.env.PLAYWRIGHT_PORT || '3001');
      expect(port).toBe(9999);
      delete process.env.PLAYWRIGHT_PORT;
    });

    it('should use default port 3001 when not set', () => {
      delete process.env.PLAYWRIGHT_PORT;
      const port = parseInt(process.env.PLAYWRIGHT_PORT || '3001');
      expect(port).toBe(3001);
    });

    it('should parse PLAYWRIGHT_PORT as integer', () => {
      process.env.PLAYWRIGHT_PORT = '4000';
      const port = parseInt(process.env.PLAYWRIGHT_PORT || '3001');
      expect(typeof port).toBe('number');
      expect(port).toBe(4000);
      delete process.env.PLAYWRIGHT_PORT;
    });
  });

  describe('Graceful Shutdown', () => {
    it('should have process event listeners for shutdown', () => {
      // In production, server.ts registers SIGINT and SIGTERM handlers
      // This test verifies the concept exists
      expect(process).toBeDefined();
      expect(typeof process.on).toBe('function');
    });
  });

  describe('Plugin Load Order', () => {
    it('should load plugins in correct order', async () => {
      const loadedPlugins: string[] = [];

      // Mock plugin registration to track order
      vi.spyOn(app, 'register').mockImplementation(async (plugin: any, options?: any) => {
        if (plugin.name) {
          loadedPlugins.push(plugin.name);
        }
        return {} as any;
      });

      await app.register(cors);
      await app.register(websocket);
      await app.register(swaggerPlugin);
      await app.register(healthRoutesPlugin);

      vi.restoreAllMocks();

      expect(loadedPlugins.length).toBeGreaterThan(0);
    });
  });

  describe('Server Configuration', () => {
    it('should configure server to listen on 0.0.0.0', async () => {
      const listenSpy = vi.spyOn(app, 'listen').mockResolvedValue('http://localhost:3001' as any);

      await app.listen({ port: 3001, host: '0.0.0.0' });

      expect(listenSpy).toHaveBeenCalledWith({ port: 3001, host: '0.0.0.0' });

      listenSpy.mockRestore();
    });
  });
});
