import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { BrowserService } from '../../services/browser-service.js';
import { BrowserMutexError, getCurrentOwner } from '../../services/browser-lock.js';
import { SimplifiedDOMResponseSchema } from '../../schemas/dom.js';
import { SuccessResponseSchema, ErrorResponseSchema } from '../../schemas/common.js';
import { Type } from '@sinclair/typebox';

interface ExecuteScriptRequest {
  script: string;
  args?: unknown[];
}

const ExecuteScriptRequestSchema = Type.Object({
  script: Type.String(),
  args: Type.Optional(Type.Array(Type.Any())),
});

const ElementAtQuerySchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
});

const ElementInfoSchema = Type.Object({
  selector: Type.String(),
  tag: Type.String(),
  id: Type.Optional(Type.String()),
  class: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  placeholder: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  href: Type.Optional(Type.String()),
  src: Type.Optional(Type.String()),
  alt: Type.Optional(Type.String()),
  bbox: Type.Optional(
    Type.Object({
      x: Type.Number(),
      y: Type.Number(),
      width: Type.Number(),
      height: Type.Number(),
    })
  ),
  isVisible: Type.Boolean(),
  isInteractable: Type.Boolean(),
});

const ElementAtResponseSchema = Type.Object({
  success: Type.Boolean(),
  element: Type.Optional(ElementInfoSchema),
});

const routes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/simplified',
    {
      schema: {
        description: 'Get simplified DOM tree of current page with interactive elements',
        tags: ['DOM'],
        summary: 'Get simplified DOM',
        response: {
          200: SimplifiedDOMResponseSchema,
          400: ErrorResponseSchema,
          503: ErrorResponseSchema,
          500: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
      serializerCompiler: () => JSON.stringify,
    },
    async (request, reply) => {
      try {
        if (!BrowserService.getInstance().isOpen()) {
          reply.status(503);
          return { success: false, error: 'Browser is not open', code: 'BROWSER_NOT_OPEN' };
        }

        if (!BrowserService.getInstance().getPage()) {
          reply.status(503);
          return { success: false, error: 'No page available', code: 'NO_PAGE_AVAILABLE' };
        }

        request.log.info('DOM simplified v2.0 format requested');
        const dom = await BrowserService.getInstance().getSimplifiedDOMV2();
        request.log.info({ snapshot_id: dom.snapshot_id }, 'DOM snapshot generated');
        return dom;
      } catch (error) {
        if (error instanceof BrowserMutexError) {
          return reply.code(409).send({ error: error.message, currentOwner: getCurrentOwner() });
        }
        request.log.error({ err: error }, 'DOM simplified request failed');
        reply.status(500);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', code: 'INTERNAL_ERROR' };
      }
    }
  );

  fastify.post<{ Body: ExecuteScriptRequest }>(
    '/script',
    {
      schema: {
        description: 'Execute JavaScript in browser context (with safety checks)',
        tags: ['DOM'],
        summary: 'Execute script',
        body: ExecuteScriptRequestSchema,
        response: {
          200: SuccessResponseSchema,
          500: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { script, args = [] } = request.body as ExecuteScriptRequest;

        const dangerousPatterns = [
          /eval\s*\(/,
          /Function\s*\(/,
          /document\.cookie/,
          /localStorage\.setItem/,
          /fetch\s*\(/,
          /XMLHttpRequest/,
          /\$http/,
        ];

        for (const pattern of dangerousPatterns) {
          if (pattern.test(script)) {
            throw new Error('Potentially dangerous script detected');
          }
        }

        const result = await BrowserService.getInstance().executeScript(script, args);
        return { success: true, result };
      } catch (error) {
        if (error instanceof BrowserMutexError) {
          return reply.code(409).send({ error: error.message, currentOwner: getCurrentOwner() });
        }
        reply.status(500);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.get<{ Querystring: { x: number; y: number } }>(
    '/element-at',
    {
      schema: {
        description: 'Get element information at specified coordinates',
        tags: ['DOM'],
        summary: 'Get element at coordinates',
        querystring: ElementAtQuerySchema,
        response: {
          200: ElementAtResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { x, y } = request.query;
        const elementInfo = await BrowserService.getInstance().getElementAt(x, y);

        if (!elementInfo) {
          reply.status(404);
          return { success: false, error: 'No element found at specified coordinates' };
        }

        return { success: true, element: elementInfo };
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
