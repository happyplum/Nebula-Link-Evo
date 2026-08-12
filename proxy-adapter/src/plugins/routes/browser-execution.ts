import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  BrowserExecutionError,
  toBrowserExecutionProblem,
} from '../../browser-execution/errors.js';
import type { BrowserExecutionService } from '../../browser-execution/service.js';
import type {
  BrowserExecutionCredentials,
  BrowserLeaseMode,
  BrowserOperationName,
  BrowserSessionOptions,
  CreateBrowserLeaseRequest,
} from '../../browser-execution/types.js';

export interface BrowserExecutionRoutesOptions {
  browserExecutionService: BrowserExecutionService;
}

const IdSchema = Type.String({ format: 'uuid' });
const SuccessSchema = Type.Object({
  data: Type.Any(),
  meta: Type.Object({
    requestId: Type.String(),
    correlationId: Type.Optional(Type.String()),
  }),
});
const ProblemSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  retryable: Type.Boolean(),
  correlationId: Type.String(),
  details: Type.Optional(Type.Record(Type.String(), Type.Any())),
});
const MutationHeadersSchema = Type.Object(
  {
    'idempotency-key': Type.String({ minLength: 1, maxLength: 200 }),
    'x-correlation-id': Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    authorization: Type.Optional(Type.String()),
    'x-browser-lease-id': Type.Optional(IdSchema),
  },
  { additionalProperties: true }
);
const SessionParamsSchema = Type.Object({ sessionId: IdSchema });
const LeaseParamsSchema = Type.Object({ sessionId: IdSchema, leaseId: IdSchema });
const OperationParamsSchema = Type.Object({ operationId: IdSchema });
const SessionBodySchema = Type.Object(
  {
    headless: Type.Optional(Type.Literal(false)),
    viewport: Type.Optional(
      Type.Object({
        width: Type.Integer({ minimum: 320, maximum: 7680 }),
        height: Type.Integer({ minimum: 240, maximum: 4320 }),
      })
    ),
    cdpPort: Type.Optional(Type.Integer({ minimum: 0, maximum: 65535 })),
  },
  { additionalProperties: false }
);
const LeaseBodySchema = Type.Object(
  {
    mode: Type.Union([Type.Literal('observe'), Type.Literal('control')]),
    ttlSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
    tabIds: Type.Optional(Type.Array(IdSchema, { minItems: 1, uniqueItems: true })),
    operations: Type.Optional(Type.Array(Type.String(), { minItems: 1, uniqueItems: true })),
  },
  { additionalProperties: false }
);

const browserExecutionRoutes: FastifyPluginAsync<BrowserExecutionRoutesOptions> = async (
  fastify,
  options
) => {
  const { browserExecutionService } = options;

  fastify.setErrorHandler((error, request, reply) => {
    const correlationId = correlationIdFrom(request);
    const validation =
      error && typeof error === 'object' && 'validation' in error
        ? (error as { validation?: unknown }).validation
        : undefined;
    if (validation) {
      const problem = toBrowserExecutionProblem(
        new BrowserExecutionError('validation_failed', 'Request validation failed', {
          details: { validation },
        }),
        correlationId
      );
      return reply.code(400).send(problem);
    }
    if (error instanceof BrowserExecutionError) {
      return reply.code(error.statusCode).send(toBrowserExecutionProblem(error, correlationId));
    }
    request.log.error({ err: error }, 'Browser execution route failed');
    return reply.code(500).send(toBrowserExecutionProblem(error, correlationId));
  });

  fastify.post<{ Headers: Record<string, string | undefined>; Body: BrowserSessionOptions }>(
    '/sessions',
    {
      schema: {
        description: 'Create or bind the single visible browser execution session',
        tags: ['Browser Execution'],
        headers: MutationHeadersSchema,
        body: SessionBodySchema,
        response: {
          201: SuccessSchema,
          400: ProblemSchema,
          409: ProblemSchema,
          503: ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await browserExecutionService.createSession(
        idempotencyKeyFrom(request),
        request.body
      );
      return reply.code(201).send(success(request, session));
    }
  );

  fastify.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    {
      schema: {
        description: 'Read browser session, tabs, leases, and live-view summary',
        tags: ['Browser Execution'],
        params: SessionParamsSchema,
        response: { 200: SuccessSchema, 404: ProblemSchema },
      },
    },
    async (request) =>
      success(request, await browserExecutionService.getSession(request.params.sessionId))
  );

  fastify.delete<{
    Params: { sessionId: string };
    Headers: Record<string, string | undefined>;
  }>(
    '/sessions/:sessionId',
    {
      schema: {
        description: 'Close a browser execution session',
        tags: ['Browser Execution'],
        params: SessionParamsSchema,
        headers: MutationHeadersSchema,
        response: {
          200: SuccessSchema,
          403: ProblemSchema,
          404: ProblemSchema,
          409: ProblemSchema,
        },
      },
    },
    async (request) => {
      const session = await browserExecutionService.closeSession(
        request.params.sessionId,
        idempotencyKeyFrom(request),
        credentialsFrom(request, request.params.sessionId, false)
      );
      return success(request, session);
    }
  );

  fastify.post<{
    Params: { sessionId: string };
    Headers: Record<string, string | undefined>;
    Body: {
      mode: BrowserLeaseMode;
      ttlSeconds?: number;
      tabIds?: string[];
      operations?: BrowserOperationName[];
    };
  }>(
    '/sessions/:sessionId/leases',
    {
      schema: {
        description: 'Issue a bounded observe or control lease',
        tags: ['Browser Execution'],
        params: SessionParamsSchema,
        headers: MutationHeadersSchema,
        body: LeaseBodySchema,
        response: {
          201: SuccessSchema,
          400: ProblemSchema,
          404: ProblemSchema,
          409: ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const issued = await browserExecutionService.createLease(
        request.params.sessionId,
        idempotencyKeyFrom(request),
        request.body as CreateBrowserLeaseRequest
      );
      return reply.code(201).send(success(request, issued));
    }
  );

  fastify.delete<{
    Params: { sessionId: string; leaseId: string };
    Headers: Record<string, string | undefined>;
  }>(
    '/sessions/:sessionId/leases/:leaseId',
    {
      schema: {
        description: 'Revoke a browser lease',
        tags: ['Browser Execution'],
        params: LeaseParamsSchema,
        headers: MutationHeadersSchema,
        response: {
          200: SuccessSchema,
          403: ProblemSchema,
          404: ProblemSchema,
          409: ProblemSchema,
        },
      },
    },
    async (request) => {
      const credentials = credentialsForLeasePath(
        request,
        request.params.sessionId,
        request.params.leaseId
      );
      const lease = await browserExecutionService.revokeLease(
        credentials,
        idempotencyKeyFrom(request)
      );
      return success(request, lease);
    }
  );

  fastify.get<{ Params: { operationId: string } }>(
    '/operations/:operationId',
    {
      schema: {
        description: 'Read a durable browser operation result',
        tags: ['Browser Execution'],
        params: OperationParamsSchema,
        response: { 200: SuccessSchema, 404: ProblemSchema },
      },
    },
    async (request) =>
      success(request, browserExecutionService.getOperation(request.params.operationId))
  );
};

function success<T>(request: FastifyRequest, data: T) {
  const correlationId = correlationIdFrom(request);
  return {
    data,
    meta: {
      requestId: request.id,
      ...(correlationId ? { correlationId } : {}),
    },
  };
}

function correlationIdFrom(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'];
  return typeof header === 'string' && header ? header : randomUUID();
}

function credentialsFrom(
  request: FastifyRequest<{ Headers: Record<string, string | undefined> }>,
  sessionId: string,
  required: boolean
): BrowserExecutionCredentials | undefined {
  const leaseId = request.headers['x-browser-lease-id'];
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  if (!leaseId && !token && !required) {
    return undefined;
  }
  if (!leaseId || !token) {
    throw new BrowserExecutionError(
      'permission_denied',
      'X-Browser-Lease-ID and Authorization: Bearer are required'
    );
  }
  return { sessionId, leaseId, leaseToken: token };
}

function credentialsForLeasePath(
  request: FastifyRequest<{ Headers: Record<string, string | undefined> }>,
  sessionId: string,
  leaseId: string
): BrowserExecutionCredentials {
  const headerLeaseId = request.headers['x-browser-lease-id'];
  if (headerLeaseId && headerLeaseId !== leaseId) {
    throw new BrowserExecutionError(
      'permission_denied',
      'Browser lease header and path do not match'
    );
  }
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  if (!token) {
    throw new BrowserExecutionError('permission_denied', 'Authorization: Bearer is required');
  }
  return { sessionId, leaseId, leaseToken: token };
}

function idempotencyKeyFrom(
  request: FastifyRequest<{ Headers: Record<string, string | undefined> }>
): string {
  const key = request.headers['idempotency-key'];
  if (!key) {
    throw new BrowserExecutionError('validation_failed', 'Idempotency-Key is required');
  }
  return key;
}

export default browserExecutionRoutes;
