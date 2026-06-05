import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { DebugStatusReason } from '@nebula-link-evo/shared/types/debug-events.js';
import { BrowserService } from '../../services/browser-service.js';
import { BrowserMutexError, getCurrentOwner } from '../../services/browser-lock.js';
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
import { debugEventHub } from '../../services/debug-event-hub.js';

async function publishDebugStatus(browserService: BrowserService, reason: DebugStatusReason): Promise<void> {
  try {
    debugEventHub.publish({
      type: 'debug.status',
      status: await browserService.getDebugStatus(reason),
      emittedAt: new Date().toISOString(),
    });
  } catch {
    // Best-effort publishing must never affect HTTP responses.
  }
}

const routes: FastifyPluginAsyncTypebox = async (fastify) => {
  const browserService = BrowserService.getInstance();

  fastify.post(
    '/open',
    {
      schema: {
        description: 'Open a new browser instance with optional headless mode and viewport settings',
        tags: ['Browser'],
        summary: 'Open browser',
        body: BrowserOpenRequestSchema,
        response: {
          200: SuccessResponseSchema,
          500: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const owner = (request.headers['x-browser-owner'] as string) || undefined;
      try {
        const { headless = false, viewport, cdpPort } = (request.body ?? {}) as BrowserOpenRequest;
        await browserService.open(headless, viewport, cdpPort, owner);
        await publishDebugStatus(browserService, 'open');
        return { success: true, message: 'Browser opened successfully' };
      } catch (error) {
        if (error instanceof BrowserMutexError) {
          return reply.code(409).send({ error: error.message, currentOwner: getCurrentOwner() });
        }
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
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const owner = (request.headers['x-browser-owner'] as string) || undefined;
      try {
        const { url, waitUntil = 'networkidle' } = request.body as BrowserNavigateRequest;
        await browserService.navigate(url, waitUntil as 'load' | 'domcontentloaded' | 'networkidle', owner);
        await publishDebugStatus(browserService, 'navigate');
        return {
          isOpen: browserService.isOpen(),
          currentUrl: browserService.getCurrentUrl(),
          title: await browserService.getTitle(),
        };
      } catch (error) {
        if (error instanceof BrowserMutexError) {
          return reply.code(409).send({ error: error.message, currentOwner: getCurrentOwner() });
        }
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
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const owner = (request.headers['x-browser-owner'] as string) || undefined;
      try {
        const { fullPage = false }: { fullPage?: boolean } = request.body ?? {};
        const result = await browserService.screenshot(fullPage, owner);
        return { success: true, ...result };
      } catch (error) {
        if (error instanceof BrowserMutexError) {
          return reply.code(409).send({ error: error.message, currentOwner: getCurrentOwner() });
        }
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
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const owner = (request.headers['x-browser-owner'] as string) || undefined;
      try {
        await browserService.close(owner);
        await publishDebugStatus(browserService, 'close');
        return { success: true, message: 'Browser closed successfully' };
      } catch (error) {
        if (error instanceof BrowserMutexError) {
          return reply.code(409).send({ error: error.message, currentOwner: getCurrentOwner() });
        }
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
        isOpen: browserService.isOpen(),
        currentUrl: browserService.getCurrentUrl(),
        title: await browserService.getTitle(),
        viewport: browserService.getViewport(),
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
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const owner = (request.headers['x-browser-owner'] as string) || undefined;
      try {
        const tabs = await browserService.getTabs(owner);
        return { tabs };
      } catch (error) {
        if (error instanceof BrowserMutexError) {
          return reply.code(409).send({ error: error.message, currentOwner: getCurrentOwner() });
        }
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
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const owner = (request.headers['x-browser-owner'] as string) || undefined;
      try {
        await browserService.switchTab((request.body as BrowserSwitchTabRequest).id, owner);
        await publishDebugStatus(browserService, 'switch_tab');
        return { success: true, message: 'Switched tab successfully' };
      } catch (error) {
        if (error instanceof BrowserMutexError) {
          return reply.code(409).send({ error: error.message, currentOwner: getCurrentOwner() });
        }
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );
};

export default routes;
