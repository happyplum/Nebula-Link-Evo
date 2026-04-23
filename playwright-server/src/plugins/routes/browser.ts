import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { BrowserService } from '../../services/browser-service.js';
import {
  BrowserOpenRequestSchema,
  BrowserNavigateRequestSchema,
  BrowserStatusResponseSchema,
  ScreenshotResponseSchema,
  BrowserTabsResponseSchema,
  BrowserSwitchTabRequestSchema,
} from '../../schemas/browser.js';
import type {
  BrowserOpenRequest,
  BrowserNavigateRequest,
  BrowserSwitchTabRequest,
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
        const { headless = false, viewport, cdpPort } = (request.body ?? {}) as BrowserOpenRequest;
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
        const { url, waitUntil = 'networkidle' } = request.body as BrowserNavigateRequest;
        await BrowserService.getInstance().navigate(url, waitUntil as 'load' | 'domcontentloaded' | 'networkidle');
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
        const { fullPage = false }: { fullPage?: boolean } = request.body ?? {};
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

  fastify.get(
    '/tabs',
    {
      schema: {
        description: 'Get list of all open tabs',
        tags: ['Browser'],
        summary: 'Get browser tabs',
        response: {
          200: BrowserTabsResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const tabs = await BrowserService.getInstance().getTabs();
        return { tabs };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/tabs/switch',
    {
      schema: {
        description: 'Switch to a specific tab',
        tags: ['Browser'],
        summary: 'Switch browser tab',
        body: BrowserSwitchTabRequestSchema,
        response: {
          200: SuccessResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await BrowserService.getInstance().switchTab((request.body as BrowserSwitchTabRequest).id);
        return { success: true, message: 'Switched tab successfully' };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );
};

export default routes;
