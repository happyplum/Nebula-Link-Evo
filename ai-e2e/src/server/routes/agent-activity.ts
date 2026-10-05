import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SnapshotFirstSseWriter, encodeSseJsonFrame } from '@nebula-link-evo/shared';
import type {
  AgentStreamEventV1,
  AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import type { ApiSuccess } from '../../contracts/semantic-control.js';
import type {
  ActivityContext,
  AgentActivityRepository,
} from '../../database/repositories/agent-activity-repository.js';
import type { SemanticControlEventHubPort } from '../../services/semantic-control-event-hub.js';
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
  eventHub?: SemanticControlEventHubPort;
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
        await openActivityStream(request, reply, repository, context, options.eventHub);
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

async function openActivityStream(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: AgentActivityRepository,
  context: ActivityContext,
  eventHub?: SemanticControlEventHubPort
): Promise<void> {
  reply.hijack();
  const writer = new SnapshotFirstSseWriter<AgentStreamSnapshotV1, AgentStreamEventV1>({
    target: reply.raw,
    lifecycleTargets: [request.raw],
    statusCode: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
    getSnapshot: () => repository.snapshot(context),
    getSnapshotSeq: (snapshot) => snapshot.seq,
    getEventSeq: (event) => event.seq,
    encodeSnapshot: (snapshot) =>
      encodeSseJsonFrame({
        event: 'agent_stream.snapshot',
        id: String(snapshot.seq),
        data: snapshot,
        fieldOrder: ['event', 'id', 'data'],
      }),
    encodeEvent: (event) =>
      encodeSseJsonFrame({
        event: 'agent_stream.event',
        id: String(event.seq),
        data: event,
        fieldOrder: ['event', 'id', 'data'],
      }),
    feed: {
      subscribe: (listener) => {
        const unsubscribeActivity = repository.subscribe(context, listener);
        const unsubscribeControl = eventHub?.subscribe(context.type, context.id, (message) => {
          if (message.kind === 'control') {
            repository.ingestControlEvent(context, message.event);
          } else if (context.type === 'authoring') {
            repository.ingestAuthoringMessage(context, message.message);
          }
        });
        return () => {
          unsubscribeActivity();
          unsubscribeControl?.();
        };
      },
      poll: {
        intervalMs: 5_000,
        read: (afterSeq) => {
          repository.syncControlEvents(context);
          return repository.listSynced(context, afterSeq);
        },
      },
    },
    maxBufferedEvents: null,
    deduplicate: true,
    heartbeat: { intervalMs: 15_000, createChunk: () => ': heartbeat\n\n' },
  });
  await writer.start();
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
