import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SemanticQueryService } from '../../services/semantic-query-service.js';
import { ServiceError } from '../../services/service-error.js';
import type { ApiSuccess, SemanticEventV1 } from '../../types/semantic-control.js';
import {
  ApiProblemSchema,
  SemanticAssetTypeSchema,
  SemanticEventSchema,
  ServiceCapabilitiesSchema,
  apiSuccessSchema,
} from '../../types/semantic-api.js';
import fp from '../plugins/fastify-plugin.js';

const IdSchema = Type.String({ minLength: 1, maxLength: 200 });
const VersionParamsSchema = Type.Object({ versionId: IdSchema }, { additionalProperties: false });
const JobParamsSchema = Type.Object({ jobId: IdSchema }, { additionalProperties: false });
const RunParamsSchema = Type.Object({ runId: IdSchema }, { additionalProperties: false });
const AssetParamsSchema = Type.Object(
  { assetType: SemanticAssetTypeSchema, assetId: IdSchema },
  { additionalProperties: false }
);
const RevisionParamsSchema = Type.Object(
  { ...AssetParamsSchema.properties, revisionId: IdSchema },
  { additionalProperties: false }
);
const EventLogQuerySchema = Type.Object(
  {
    afterSeq: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
  },
  { additionalProperties: false }
);

const UnknownSuccessSchema = apiSuccessSchema(Type.Unknown());
const EventLogSuccessSchema = apiSuccessSchema(
  Type.Object(
    {
      events: Type.Array(SemanticEventSchema),
      nextAfterSeq: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false }
  )
);
const ErrorResponses = {
  400: ApiProblemSchema,
  404: ApiProblemSchema,
  409: ApiProblemSchema,
  503: ApiProblemSchema,
};

export interface SemanticControlRoutesOptions {
  service?: SemanticQueryService;
}

const semanticControlRoutes: FastifyPluginAsyncTypebox<SemanticControlRoutesOptions> = async (
  fastify,
  options
) => {
  const requireService = (): SemanticQueryService => {
    if (!options.service) {
      throw ServiceError.unavailable('Semantic control service is not configured');
    }
    return options.service;
  };

  fastify.get(
    '/capabilities',
    {
      schema: {
        response: { 200: apiSuccessSchema(ServiceCapabilitiesSchema), ...ErrorResponses },
      },
    },
    async (request) => success(request, requireService().getCapabilities())
  );

  fastify.get<{ Params: Static<typeof VersionParamsSchema> }>(
    '/business-versions/:versionId/workspace',
    {
      schema: {
        params: VersionParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) => success(request, requireService().getWorkspace(request.params.versionId))
  );

  fastify.get<{ Params: Static<typeof VersionParamsSchema> }>(
    '/business-versions/:versionId/pages',
    {
      schema: {
        params: VersionParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) => {
      const workspace = requireService().getWorkspace(request.params.versionId);
      return success(request, { pages: workspace.pages });
    }
  );

  fastify.get<{ Params: Static<typeof VersionParamsSchema> }>(
    '/business-versions/:versionId/modules',
    {
      schema: {
        params: VersionParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) => {
      const workspace = requireService().getWorkspace(request.params.versionId);
      return success(request, {
        businessModules: workspace.businessModules,
        functionalModules: workspace.functionalModules,
      });
    }
  );

  fastify.get<{ Params: Static<typeof VersionParamsSchema> }>(
    '/business-versions/:versionId/functional-scripts',
    {
      schema: {
        params: VersionParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) => {
      const workspace = requireService().getWorkspace(request.params.versionId);
      return success(request, { functionalScripts: workspace.functionalScripts });
    }
  );

  fastify.get<{ Params: Static<typeof VersionParamsSchema> }>(
    '/business-versions/:versionId/scenarios',
    {
      schema: {
        params: VersionParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) => {
      const workspace = requireService().getWorkspace(request.params.versionId);
      return success(request, { scenarios: workspace.scenarios });
    }
  );

  fastify.get<{ Params: Static<typeof AssetParamsSchema> }>(
    '/assets/:assetType/:assetId/revisions',
    {
      schema: {
        params: AssetParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) =>
      success(
        request,
        requireService().getRevisionHistory(request.params.assetType, request.params.assetId)
      )
  );

  fastify.get<{ Params: Static<typeof RevisionParamsSchema> }>(
    '/assets/:assetType/:assetId/revisions/:revisionId',
    {
      schema: {
        params: RevisionParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) =>
      success(
        request,
        requireService().getRevision(
          request.params.assetType,
          request.params.assetId,
          request.params.revisionId
        )
      )
  );

  fastify.get<{ Params: Static<typeof JobParamsSchema> }>(
    '/authoring-jobs/:jobId',
    {
      schema: {
        params: JobParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) => {
      const snapshot = requireService().getAuthoringSnapshot(request.params.jobId);
      return success(request, snapshot, { stateVersion: snapshot.stateVersion });
    }
  );

  fastify.get<{ Params: Static<typeof JobParamsSchema> }>(
    '/authoring-jobs/:jobId/events',
    { schema: { params: JobParamsSchema } },
    async (request, reply) => {
      const service = requireService();
      const snapshot = service.getAuthoringSnapshot(request.params.jobId);
      openSnapshotFirstStream(request, reply, 'authoring.snapshot', snapshot, (afterSeq) =>
        service.listAuthoringEvents(request.params.jobId, afterSeq, 500)
      );
    }
  );

  fastify.get<{
    Params: Static<typeof JobParamsSchema>;
    Querystring: Static<typeof EventLogQuerySchema>;
  }>(
    '/authoring-jobs/:jobId/event-log',
    {
      schema: {
        params: JobParamsSchema,
        querystring: EventLogQuerySchema,
        response: { 200: EventLogSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) => {
      const events = requireService().listAuthoringEvents(
        request.params.jobId,
        request.query.afterSeq,
        request.query.limit
      );
      return success(request, {
        events,
        nextAfterSeq: events.at(-1)?.seq ?? request.query.afterSeq ?? 0,
      });
    }
  );

  fastify.get<{ Params: Static<typeof RunParamsSchema> }>(
    '/runs/:runId',
    {
      schema: {
        params: RunParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) => {
      const snapshot = requireService().getRunSnapshot(request.params.runId);
      return success(request, snapshot, { stateVersion: snapshot.stateVersion });
    }
  );

  fastify.get<{ Params: Static<typeof RunParamsSchema> }>(
    '/runs/:runId/events',
    { schema: { params: RunParamsSchema } },
    async (request, reply) => {
      const service = requireService();
      const snapshot = service.getRunSnapshot(request.params.runId);
      openSnapshotFirstStream(request, reply, 'run.snapshot', snapshot, (afterSeq) =>
        service.listRunEvents(request.params.runId, afterSeq, 500)
      );
    }
  );

  for (const [suffix, select] of [
    [
      '/plan',
      (snapshot: ReturnType<SemanticQueryService['getRunSnapshot']>) => ({
        plan: snapshot.plan,
        amendments: snapshot.amendments,
      }),
    ],
    [
      '/todos',
      (snapshot: ReturnType<SemanticQueryService['getRunSnapshot']>) => ({
        todos: snapshot.todos,
        dependencies: snapshot.dependencies,
        pageTasks: snapshot.pageTasks,
        attempts: snapshot.attempts,
      }),
    ],
    [
      '/decisions',
      (snapshot: ReturnType<SemanticQueryService['getRunSnapshot']>) => ({
        decisions: snapshot.decisions,
      }),
    ],
    [
      '/evidence',
      (snapshot: ReturnType<SemanticQueryService['getRunSnapshot']>) => ({
        evidence: snapshot.evidence,
      }),
    ],
  ] as const) {
    fastify.get<{ Params: Static<typeof RunParamsSchema> }>(
      `/runs/:runId${suffix}`,
      {
        schema: {
          params: RunParamsSchema,
          response: { 200: UnknownSuccessSchema, ...ErrorResponses },
        },
      },
      async (request) =>
        success(request, select(requireService().getRunSnapshot(request.params.runId)))
    );
  }

  fastify.get<{
    Params: Static<typeof RunParamsSchema>;
    Querystring: Static<typeof EventLogQuerySchema>;
  }>(
    '/runs/:runId/event-log',
    {
      schema: {
        params: RunParamsSchema,
        querystring: EventLogQuerySchema,
        response: { 200: EventLogSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) => {
      const events = requireService().listRunEvents(
        request.params.runId,
        request.query.afterSeq,
        request.query.limit
      );
      return success(request, {
        events,
        nextAfterSeq: events.at(-1)?.seq ?? request.query.afterSeq ?? 0,
      });
    }
  );
};

type Snapshot = { seq: number; stateVersion: number; schema: string };

function openSnapshotFirstStream<T extends Snapshot>(
  request: FastifyRequest,
  reply: FastifyReply,
  snapshotEvent: 'authoring.snapshot' | 'run.snapshot',
  snapshot: T,
  listEvents: (afterSeq: number) => SemanticEventV1[]
): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  reply.raw.write(
    encodeSseEvent({
      id: String(snapshot.seq),
      event: snapshotEvent,
      retry: 1_000,
      data: {
        schema: 'nebula.ai-e2e.snapshot-event/1.0',
        seq: snapshot.seq,
        stateVersion: snapshot.stateVersion,
        snapshot,
      },
    })
  );

  let afterSeq = snapshot.seq;
  let closed = false;
  const poll = setInterval(() => {
    if (closed) return;
    try {
      const events = listEvents(afterSeq);
      for (const event of events) {
        reply.raw.write(encodeSseEvent({ id: String(event.seq), event: event.type, data: event }));
        afterSeq = event.seq;
      }
    } catch (error) {
      reply.raw.write(
        encodeSseEvent({
          event: 'stream.error',
          data: {
            retryable: true,
            message: error instanceof Error ? error.message : 'Event stream failed',
          },
        })
      );
      cleanup();
      reply.raw.end();
    }
  }, 500);
  const heartbeat = setInterval(() => {
    if (!closed) reply.raw.write(': heartbeat\n\n');
  }, 15_000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
  };
  request.raw.once('close', cleanup);
  reply.raw.once('close', cleanup);
}

export function encodeSseEvent(input: {
  id?: string;
  event: string;
  retry?: number;
  data: unknown;
}): string {
  return [
    ...(input.id ? [`id: ${input.id}`] : []),
    `event: ${input.event}`,
    ...(input.retry ? [`retry: ${input.retry}`] : []),
    `data: ${JSON.stringify(input.data)}`,
    '',
    '',
  ].join('\n');
}

function success<T>(
  request: FastifyRequest,
  data: T,
  meta: { stateVersion?: number } = {}
): ApiSuccess<T> {
  const correlationHeader = request.headers['x-correlation-id'];
  const correlationId = Array.isArray(correlationHeader) ? correlationHeader[0] : correlationHeader;
  return {
    data,
    meta: {
      requestId: request.id,
      ...(correlationId ? { correlationId } : {}),
      ...meta,
    },
  };
}

export default fp(semanticControlRoutes, {
  fastify: '5.x',
  name: 'semantic-control-routes',
  encapsulate: true,
});
