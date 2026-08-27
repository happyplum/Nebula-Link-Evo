import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AgentStreamEventV1 } from '@nebula-link-evo/shared/types/agent-stream';
import type { ApiSuccess } from '../../types/semantic-control.js';
import type {
  ActivityContext,
  AgentActivityRepository,
} from '../../database/repositories/agent-activity-repository.js';
import { ServiceError } from '../../services/service-error.js';
import fp from '../plugins/fastify-plugin.js';

const IdSchema = Type.String({ minLength: 1, maxLength: 200 });
const ParamsSchema = Type.Object({ contextId: IdSchema }, { additionalProperties: false });
const QuerySchema = Type.Object(
  {
    afterSeq: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
  },
  { additionalProperties: false }
);

export interface AgentActivityRoutesOptions {
  repository?: AgentActivityRepository;
}

const agentActivityRoutes: FastifyPluginAsyncTypebox<AgentActivityRoutesOptions> = async (
  fastify,
  options
) => {
  const requireRepository = (): AgentActivityRepository => {
    if (!options.repository) throw ServiceError.unavailable('Agent activity is not configured');
    return options.repository;
  };

  for (const descriptor of [
    { prefix: '/authoring-jobs', type: 'authoring' as const },
    { prefix: '/runs', type: 'run' as const },
  ]) {
    fastify.get<{
      Params: Static<typeof ParamsSchema>;
      Querystring: Static<typeof QuerySchema>;
    }>(
      `${descriptor.prefix}/:contextId/activity-log`,
      { schema: { params: ParamsSchema, querystring: QuerySchema } },
      async (request) => {
        const repository = requireRepository();
        const context = requireContext(repository, descriptor.type, request.params.contextId);
        return success(
          request,
          repository.list(context, request.query.afterSeq ?? 0, request.query.limit ?? 500)
        );
      }
    );

    fastify.get<{ Params: Static<typeof ParamsSchema> }>(
      `${descriptor.prefix}/:contextId/activity`,
      { schema: { params: ParamsSchema } },
      async (request, reply) => {
        const repository = requireRepository();
        const context = requireContext(repository, descriptor.type, request.params.contextId);
        openActivityStream(request, reply, repository, context);
      }
    );
  }
};

function requireContext(
  repository: AgentActivityRepository,
  type: ActivityContext['type'],
  id: string
): ActivityContext {
  const context = { type, id };
  if (!repository.hasContext(context))
    throw ServiceError.notFound(`${type} context ${id} not found`);
  return context;
}

function openActivityStream(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: AgentActivityRepository,
  context: ActivityContext
): void {
  const buffered: AgentStreamEventV1[] = [];
  let bootstrapComplete = false;
  let closed = false;
  let lastSeq = 0;
  const unsubscribe = repository.subscribe(context, (event) => {
    if (closed) return;
    if (!bootstrapComplete) {
      buffered.push(event);
      return;
    }
    if (event.seq <= lastSeq) return;
    write(reply, 'agent_stream.event', event.seq, event);
    lastSeq = event.seq;
  });
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const snapshot = repository.snapshot(context);
  write(reply, 'agent_stream.snapshot', snapshot.seq, snapshot);
  lastSeq = snapshot.seq;
  bootstrapComplete = true;
  for (const event of buffered) {
    if (event.seq <= lastSeq) continue;
    write(reply, 'agent_stream.event', event.seq, event);
    lastSeq = event.seq;
  }
  const projection = setInterval(() => {
    if (!closed) repository.syncControlEvents(context);
  }, 500);
  const heartbeat = setInterval(() => {
    if (!closed) reply.raw.write(': heartbeat\n\n');
  }, 15_000);
  request.raw.on('close', () => {
    closed = true;
    clearInterval(projection);
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function write(reply: FastifyReply, event: string, seq: number, data: unknown): void {
  reply.raw.write(`event: ${event}\nid: ${seq}\ndata: ${JSON.stringify(data)}\n\n`);
}

function success<T>(request: FastifyRequest, data: T): ApiSuccess<T> {
  const correlationHeader = request.headers['x-correlation-id'];
  const correlationId = Array.isArray(correlationHeader) ? correlationHeader[0] : correlationHeader;
  return {
    data,
    meta: {
      requestId: request.id,
      ...(correlationId ? { correlationId } : {}),
    },
  };
}

export default fp(agentActivityRoutes, {
  fastify: '5.x',
  name: 'agent-activity-routes',
  encapsulate: true,
});
