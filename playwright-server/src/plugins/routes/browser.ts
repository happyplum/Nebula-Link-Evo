import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { BrowserService } from '../../services/browser-service.js';
import {
  BrowserOpenRequestSchema,
  BrowserNavigateRequestSchema,
  BrowserStatusResponseSchema,
  ScreenshotResponseSchema,
} from '../../schemas/browser.js';
import { SuccessResponseSchema, ErrorResponseSchema } from '../../schemas/common.js';

const routes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post(
    '/open',
    {
      schema: {
        description:
          'Open a new browser instance with optional headless mode and viewport settings',
        tags: ['Browser'],
        summary: 'Open browser',
        body: BrowserOpenRequestSchema,
        response: {
          200: SuccessResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const body = request.body as any;
        const { headless = false, viewport, cdpPort } = body || {};
        await BrowserService.getInstance().open(headless, viewport, cdpPort);
        return { success: true, message: 'Browser opened successfully' };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/navigate',
    {
      schema: {
        description: 'Navigate browser to specified URL with wait strategy',
        tags: ['Browser'],
        summary: 'Navigate to URL',
        body: BrowserNavigateRequestSchema,
        response: {
          200: BrowserStatusResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const body = request.body as any;
        const { url, waitUntil = 'networkidle' } = body;
        await BrowserService.getInstance().navigate(url, waitUntil);
        return {
          success: true,
          isOpen: BrowserService.getInstance().isOpen(),
          currentUrl: BrowserService.getInstance().getCurrentUrl(),
          title: await BrowserService.getInstance().getTitle(),
        };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/screenshot',
    {
      schema: {
        description: 'Capture screenshot of current page',
        tags: ['Browser'],
        summary: 'Capture screenshot',
        response: {
          200: ScreenshotResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const body = request.body as any;
        const { fullPage = false } = body || {};
        const result = await BrowserService.getInstance().screenshot(fullPage);
        return { success: true, ...result };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/close',
    {
      schema: {
        description: 'Close the current browser instance',
        tags: ['Browser'],
        summary: 'Close browser',
        response: {
          200: SuccessResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await BrowserService.getInstance().close();
        return { success: true, message: 'Browser closed successfully' };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.get(
    '/status',
    {
      schema: {
        description: 'Get current browser status including URL and title',
        tags: ['Browser'],
        summary: 'Get browser status',
        response: {
          200: BrowserStatusResponseSchema,
        },
      },
    },
    async () => {
      return {
        isOpen: BrowserService.getInstance().isOpen(),
        currentUrl: BrowserService.getInstance().getCurrentUrl(),
        title: await BrowserService.getInstance().getTitle(),
        viewport: BrowserService.getInstance().getViewport(),
      };
    }
  );
};

export default routes;
