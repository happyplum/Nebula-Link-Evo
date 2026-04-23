import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { BrowserService } from '../../services/browser-service.js';
import type { MarkerActionResult } from '../../services/page-actions.js';
import {
  ClickRequestSchema,
  ClickBySelectorRequestSchema,
  ClickByMarkerRequestSchema,
  TypeRequestSchema,
  ScrollRequestSchema,
  ExecuteByMarkerRequestSchema,
} from '../../schemas/action.js';
import type {
  ClickRequest,
  ClickBySelectorRequest,
  ClickByMarkerRequest,
  TypeRequest,
  ScrollRequest,
  ExecuteByMarkerRequest,
} from '../../schemas/action.js';
import { SuccessResponseSchema, ErrorResponseSchema } from '../../schemas/common.js';

const routes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post(
    '/click',
    {
      schema: {
        description: 'Click at specified coordinates with automatic retry',
        tags: ['Action'],
        summary: 'Click coordinates',
        body: ClickRequestSchema,
        response: {
          200: SuccessResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { x, y } = request.body as ClickRequest;

        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await BrowserService.getInstance().click(x, y);
            return {
              success: true,
              message: `Clicked at (${x}, ${y})`,
              attempts: attempt,
            };
          } catch (error) {
            lastError = error as Error;
            if (attempt < 3) {
              await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
            }
          }
        }

        throw lastError;
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/click-by-selector',
    {
      schema: {
        description: 'Click element by CSS selector with fallback to force click',
        tags: ['Action'],
        summary: 'Click by selector',
        body: ClickBySelectorRequestSchema,
        response: {
          200: SuccessResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { selector, options } = request.body as ClickBySelectorRequest;

        try {
          await BrowserService.getInstance().clickBySelector(selector, options as {
            button?: 'left' | 'right' | 'middle';
            clickCount?: number;
            delay?: number;
            force?: boolean;
          });
        } catch {
          console.log(`[Action] Normal click failed, retrying with force option...`);
          await BrowserService.getInstance().clickBySelector(selector, { ...options, force: true } as {
            button?: 'left' | 'right' | 'middle';
            clickCount?: number;
            delay?: number;
            force?: boolean;
          });
        }

        return { success: true, message: `Clicked element: ${selector}` };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/click-by-marker',
    {
      schema: {
        description: 'Click element by marker ID with multi-strategy fallback',
        tags: ['Action'],
        summary: 'Click by marker',
        body: ClickByMarkerRequestSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              strategy_used: { type: 'string' },
              attempts: { type: 'number' },
              latency_ms: { type: 'number' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { snapshot_id, nebula_id } = request.body as ClickByMarkerRequest;

        const result = await BrowserService.getInstance().clickByMarker(snapshot_id, nebula_id);

        if (result.success) {
          return {
            success: true,
            strategy_used: result.strategy_used,
            attempts: result.attempts,
            latency_ms: result.latency_ms,
          };
        } else {
          reply.status(200);
          return {
            success: false,
            strategy_used: result.strategy_used,
            attempts: result.attempts,
            latency_ms: result.latency_ms,
            error: {
              code: result.error?.code || 'unknown_error',
              message: result.error?.message || 'Unknown error',
            },
          };
        }
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/type',
    {
      schema: {
        description: 'Type text into element specified by selector',
        tags: ['Action'],
        summary: 'Type text',
        body: TypeRequestSchema,
        response: {
          200: SuccessResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { selector, text, options } = request.body as TypeRequest;
        let currentOptions: { delay?: number; clear?: boolean; force?: boolean } | undefined = options;

        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await BrowserService.getInstance().type(selector, text, currentOptions);
            return {
              success: true,
              message: `Typed "${text}" into ${selector}`,
              attempts: attempt,
            };
          } catch (error) {
            lastError = error as Error;

            if (attempt < 3) {
              console.log(`[Action] Type attempt ${attempt} failed, retrying...`);
              await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
              if (!currentOptions?.force) {
                currentOptions = { ...currentOptions, force: true };
              }
            }
          }
        }

        throw lastError;
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/scroll',
    {
      schema: {
        description: 'Scroll page by specified x and y offsets',
        tags: ['Action'],
        summary: 'Scroll page',
        body: ScrollRequestSchema,
        response: {
          200: SuccessResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { x = 0, y = 0 } = request.body as ScrollRequest;
        await BrowserService.getInstance().scroll(x, y);
        return { success: true, message: `Scrolled by (${x}, ${y})` };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );
  fastify.post(
    '/focus',
    {
      schema: {
        description: 'Focus element by CSS selector',
        tags: ['Action'],
        summary: 'Focus element',
        body: {
          type: 'object',
          properties: { selector: { type: 'string' } },
          required: ['selector'],
        },
        response: { 200: SuccessResponseSchema, 500: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { selector } = request.body as { selector: string };
        await BrowserService.getInstance().focus(selector);
        return { success: true, message: `Focused element: ${selector}` };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );
  fastify.post(
    '/blur',
    {
      schema: {
        description: 'Blur element by CSS selector',
        tags: ['Action'],
        summary: 'Blur element',
        body: {
          type: 'object',
          properties: { selector: { type: 'string' } },
          required: ['selector'],
        },
        response: { 200: SuccessResponseSchema, 500: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { selector } = request.body as { selector: string };
        await BrowserService.getInstance().blur(selector);
        return { success: true, message: `Blurred element: ${selector}` };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );
  fastify.post(
    '/hover',
    {
      schema: {
        description: 'Hover element by CSS selector',
        tags: ['Action'],
        summary: 'Hover element',
        body: {
          type: 'object',
          properties: { selector: { type: 'string' } },
          required: ['selector'],
        },
        response: { 200: SuccessResponseSchema, 500: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { selector } = request.body as { selector: string };
        await BrowserService.getInstance().hover(selector);
        return { success: true, message: `Hovered element: ${selector}` };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );
  fastify.post(
    '/value',
    {
      schema: {
        description: 'Set value of form element by CSS selector',
        tags: ['Action'],
        summary: 'Set value',
        body: {
          type: 'object',
          properties: { selector: { type: 'string' }, value: { type: 'string' } },
          required: ['selector', 'value'],
        },
        response: { 200: SuccessResponseSchema, 500: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { selector, value } = request.body as { selector: string; value: string };
        await BrowserService.getInstance().setValue(selector, value);
        return { success: true, message: `Set value of ${selector}` };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );
  fastify.post(
    '/dispatch',
    {
      schema: {
        description: 'Dispatch custom event on element by CSS selector',
        tags: ['Action'],
        summary: 'Dispatch event',
        body: {
          type: 'object',
          properties: { selector: { type: 'string' }, eventType: { type: 'string' } },
          required: ['selector', 'eventType'],
        },
        response: { 200: SuccessResponseSchema, 500: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { selector, eventType } = request.body as { selector: string; eventType: string };
        await BrowserService.getInstance().dispatchEvent(selector, eventType);
        return { success: true, message: `Dispatched ${eventType} on ${selector}` };
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/execute-by-marker',
    {
      schema: {
        description: 'Execute action on element by marker ID with multi-strategy fallback',
        tags: ['Action'],
        summary: 'Execute by marker',
        body: ExecuteByMarkerRequestSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              strategy_used: { type: 'string' },
              attempts: { type: 'number' },
              latency_ms: { type: 'number' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { snapshot_id, nebula_id, action, param } = request.body as ExecuteByMarkerRequest;

        let result: MarkerActionResult;
        switch (action) {
          case 'click':
            result = await BrowserService.getInstance().clickByMarker(snapshot_id, nebula_id);
            break;
          case 'type':
            result = await BrowserService.getInstance().typeByMarker(
              snapshot_id,
              nebula_id,
              typeof param === 'string' ? param : (param as Record<string, string>)?.text,
              typeof param === 'object' ? (param as Record<string, unknown>)?.options as { delay?: number; clear?: boolean; force?: boolean } : undefined
            );
            break;
          case 'focus':
            result = await BrowserService.getInstance().focusByMarker(snapshot_id, nebula_id);
            break;
          case 'blur':
            result = await BrowserService.getInstance().blurByMarker(snapshot_id, nebula_id);
            break;
          case 'hover':
            result = await BrowserService.getInstance().hoverByMarker(snapshot_id, nebula_id);
            break;
          case 'value':
            result = await BrowserService.getInstance().setValueByMarker(
              snapshot_id,
              nebula_id,
              typeof param === 'string' ? param : (param as Record<string, string>)?.value
            );
            break;
          case 'dispatch':
            result = await BrowserService.getInstance().dispatchEventByMarker(
              snapshot_id,
              nebula_id,
              typeof param === 'string' ? param : (param as Record<string, string>)?.eventType
            );
            break;
          default:
            throw new Error(`Unknown action: ${action}`);
        }

        if (result.success) {
          return {
            success: true,
            strategy_used: result.strategy_used,
            attempts: result.attempts,
            latency_ms: result.latency_ms,
          };
        } else {
          reply.status(200);
          return {
            success: false,
            strategy_used: result.strategy_used,
            attempts: result.attempts,
            latency_ms: result.latency_ms,
            error: {
              code: result.error?.code || 'unknown_error',
              message: result.error?.message || 'Unknown error',
            },
          };
        }
      } catch (error) {
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );
};

export default routes;
