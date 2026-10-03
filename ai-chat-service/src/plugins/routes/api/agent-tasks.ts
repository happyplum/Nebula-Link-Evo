import {
  TypeBoxValidatorCompiler,
  type FastifyPluginAsyncTypebox,
} from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifySchema, FastifySchemaCompiler } from 'fastify';
import {
  CreateAgentTaskRequestSchema,
  AgentTaskProblemSchema,
  AgentTaskViewSchema,
  AgentTaskEventRecordSchema,
  AgentTaskCommandResultSchema,
  AgentTaskCommandRequestSchema,
  type CreateAgentTaskRequest,
  type AgentTaskCommandRequest,
  type AgentTaskEventRecord,
} from '@nebula-link-evo/shared/types/agent-task';
import { AgentTaskError } from '../../../agent-tasks/errors.js';
import type { AgentTaskService } from '../../../agent-tasks/service.js';

import { buildAgentTaskCapabilities } from '../../../agent-tasks/capabilities.js';
import type { SkillCatalogEntry } from '../../../skills/runtime.js';
import { BoundedSseWriter } from '../../../services/sse-writer.js';
import type { AgentStreamEventV1 } from '@nebula-link-evo/shared/types/agent-stream';

const ErrorSchema = Type.Object({ error: AgentTaskProblemSchema }, { additionalProperties: false });

const TaskIdParamsSchema = Type.Object(
  { taskId: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false }
);
const EventLogQuerySchema = Type.Object(
  {
    afterSeq: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
  },
  { additionalProperties: false }
);
const AgentStreamEventSchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai.agent-stream.event/1.0'),
    streamId: Type.String(),
    turnId: Type.String(),
    sectionId: Type.String(),
    seq: Type.Integer({ minimum: 0 }),
    occurredAt: Type.String(),
    type: Type.String(),
  },
  // Variant payloads are validated by the shared AgentStreamEventV1 guard at the
  // consumer boundary. Keeping them here is required because Fastify serializes
  // response objects from this schema and would otherwise strip section/state/delta.
  { additionalProperties: true }
);
const SkillCatalogEntrySchema = Type.Object(
  {
    skillId: Type.String(),
    version: Type.String(),
    contentHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    description: Type.String(),
    requiredModelRole: Type.Literal('decision'),
    requiredToolPatterns: Type.Array(Type.String()),
  },
  { additionalProperties: false }
);
const CapabilitiesSchema = Type.Object(
  {
    schema: Type.Literal('nebula.service-capabilities/1.0'),
    service: Type.Literal('ai-chat-service'),
    serviceVersion: Type.String(),
    protocols: Type.Record(
      Type.String(),
      Type.Object(
        {
          major: Type.Number(),
          minor: Type.Number(),
        },
        { additionalProperties: false }
      )
    ),
    features: Type.Record(
      Type.String(),
      Type.Union([Type.Boolean(), Type.String(), Type.Number()])
    ),
    limits: Type.Record(Type.String(), Type.Number()),
    generatedAt: Type.String(),
  },
  { additionalProperties: false }
);

export interface AgentTaskRoutesOptions {
  service: AgentTaskService;
  serviceVersion: string;
  localControlPlane: boolean;
  skillCatalog?: readonly SkillCatalogEntry[];
}

const agentTaskRoutes: FastifyPluginAsyncTypebox<AgentTaskRoutesOptions> = async (
  fastify,
  options
) => {
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AgentTaskError) {
      return reply.status(error.statusCode).send({ error: error.toProblem() });
    }
    if (error && typeof error === 'object' && 'validation' in error && error.validation) {
      return reply.status(400).send({
        error: {
          code: 'validation_failed',
          message: error instanceof Error ? error.message : 'Request validation failed',
          retryable: false,
        },
      });
    }
    fastify.log.error({ err: error }, 'Agent task route failed');
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Agent task request failed', retryable: false },
    });
  });

  const requireLocalControlPlane = async () => {
    if (!options.localControlPlane) {
      throw new AgentTaskError(
        'tool_not_allowed',
        'Agent task control plane requires a loopback service binding'
      );
    }
  };

  fastify.get(
    '/capabilities',
    {
      schema: {
        description: 'Advertise the implemented Agent task protocol surface and limits',
        tags: ['Agent Tasks'],
        response: { 200: CapabilitiesSchema },
      },
    },
    async () =>
      buildAgentTaskCapabilities(
        options.serviceVersion,
        options.localControlPlane,
        options.skillCatalog?.length ?? 0
      )
  );

  fastify.get(
    '/skills',
    {
      preHandler: requireLocalControlPlane,
      schema: {
        description: 'List loaded immutable Skill versions without instructions or source paths',
        tags: ['Agent Tasks', 'Skills'],
        response: {
          200: Type.Array(SkillCatalogEntrySchema),
          403: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async () => [...(options.skillCatalog ?? [])]
  );

  fastify.post<{ Body: CreateAgentTaskRequest; Headers: { 'idempotency-key'?: string } }>(
    '/agent-tasks',
    {
      validatorCompiler: TypeBoxValidatorCompiler as FastifySchemaCompiler<FastifySchema>,
      preHandler: requireLocalControlPlane,
      schema: {
        description: 'Create one bounded decision-model Agent task',
        tags: ['Agent Tasks'],
        headers: Type.Object(
          {
            'idempotency-key': Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          },
          { additionalProperties: true }
        ),
        body: CreateAgentTaskRequestSchema,
        response: {
          200: AgentTaskViewSchema,
          202: AgentTaskViewSchema,
          400: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          500: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = options.service.create(request.body, {
        ...(request.headers['idempotency-key']
          ? { idempotencyKey: request.headers['idempotency-key'] }
          : {}),
      });
      return reply.status(result.created ? 202 : 200).send(result.task);
    }
  );

  fastify.get<{ Params: { taskId: string } }>(
    '/agent-tasks/:taskId',
    {
      preHandler: requireLocalControlPlane,
      schema: {
        description: 'Get the durable current state of an Agent task',
        tags: ['Agent Tasks'],
        params: Type.Object(
          { taskId: Type.String({ minLength: 1, maxLength: 128 }) },
          { additionalProperties: false }
        ),
        response: {
          200: AgentTaskViewSchema,
          400: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request) => options.service.get(request.params.taskId)
  );

  fastify.post<{
    Params: { taskId: string };
    Body: AgentTaskCommandRequest;
  }>(
    '/agent-tasks/:taskId/commands',
    {
      validatorCompiler: TypeBoxValidatorCompiler as FastifySchemaCompiler<FastifySchema>,
      preHandler: requireLocalControlPlane,
      schema: {
        description: 'Apply an idempotent optimistic command to an Agent task',
        tags: ['Agent Tasks'],
        params: TaskIdParamsSchema,
        body: AgentTaskCommandRequestSchema,
        response: {
          200: AgentTaskCommandResultSchema,
          400: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request) => options.service.command(request.params.taskId, request.body)
  );

  fastify.get<{
    Params: { taskId: string };
    Querystring: { afterSeq?: number; limit?: number };
  }>(
    '/agent-tasks/:taskId/event-log',
    {
      preHandler: requireLocalControlPlane,
      schema: {
        description: 'Read durable Agent task events after a sequence cursor',
        tags: ['Agent Tasks'],
        params: TaskIdParamsSchema,
        querystring: EventLogQuerySchema,
        response: {
          200: Type.Array(AgentTaskEventRecordSchema),
          400: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request) =>
      options.service.listEvents(
        request.params.taskId,
        request.query.afterSeq ?? 0,
        request.query.limit ?? 100
      )
  );

  fastify.get<{
    Params: { taskId: string };
    Querystring: { afterSeq?: number; limit?: number };
  }>(
    '/agent-tasks/:taskId/activity-log',
    {
      preHandler: requireLocalControlPlane,
      schema: {
        description: 'Read sanitized user-facing Agent activity after a presentation cursor',
        tags: ['Agent Tasks'],
        params: TaskIdParamsSchema,
        querystring: EventLogQuerySchema,
        response: {
          200: Type.Array(AgentStreamEventSchema),
          400: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request) =>
      options.service.listActivity(
        request.params.taskId,
        request.query.afterSeq ?? 0,
        request.query.limit ?? 100
      )
  );

  fastify.get<{ Params: { taskId: string } }>(
    '/agent-tasks/:taskId/activity',
    {
      preHandler: requireLocalControlPlane,
      schema: {
        description: 'Snapshot-first sanitized user-facing Agent activity stream',
        tags: ['Agent Tasks', 'SSE'],
        params: TaskIdParamsSchema,
      },
    },
    async (request, reply) => {
      const buffered: AgentStreamEventV1[] = [];
      let bootstrapComplete = false;
      let lastSeq = 0;
      let unsubscribe = (): void => {};
      const writer = new BoundedSseWriter(reply.raw, { onClose: () => unsubscribe() });
      unsubscribe = options.service.subscribeActivity(request.params.taskId, (event) => {
        try {
          if (!bootstrapComplete) {
            if (buffered.length >= 256) {
              writer.close('overflow', true);
              return;
            }
            buffered.push(event);
            return;
          }
          if (event.seq <= lastSeq) return;
          writeSse(writer, 'agent_stream.event', event.seq, event);
          lastSeq = event.seq;
        } catch {
          // The close handler releases the subscription.
        }
      });
      try {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const snapshot = options.service.getActivitySnapshot(request.params.taskId);
        writeSse(writer, 'agent_stream.snapshot', snapshot.seq, snapshot);
        lastSeq = snapshot.seq;
        bootstrapComplete = true;
        for (const event of buffered) {
          if (event.seq <= lastSeq) continue;
          writeSse(writer, 'agent_stream.event', event.seq, event);
          lastSeq = event.seq;
        }
      } catch (error) {
        unsubscribe();
        throw error;
      }
      const heartbeat = setInterval(() => {
        try {
          writer.push(': keepalive\n\n');
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);
      return new Promise<void>((resolve) => {
        request.raw.on('close', () => {
          clearInterval(heartbeat);
          unsubscribe();
          writer.close();
          resolve();
        });
      });
    }
  );

  fastify.get<{ Params: { taskId: string } }>(
    '/agent-tasks/:taskId/events',
    {
      preHandler: requireLocalControlPlane,
      schema: {
        description: 'Stream an Agent task snapshot followed by ordered durable events',
        tags: ['Agent Tasks', 'SSE'],
        params: TaskIdParamsSchema,
      },
    },
    async (request, reply) => {
      const bufferedEvents: AgentTaskEventRecord[] = [];
      let bootstrapComplete = false;
      let lastSeq = 0;
      let unsubscribe = (): void => {};
      const writer = new BoundedSseWriter(reply.raw, { onClose: () => unsubscribe() });
      unsubscribe = options.service.subscribeEvents(request.params.taskId, (event) => {
        try {
          if (!bootstrapComplete) {
            if (bufferedEvents.length >= 256) {
              writer.close('overflow', true);
              return;
            }
            bufferedEvents.push(event);
            return;
          }
          if (event.seq <= lastSeq) return;
          writeSse(writer, event.type, event.seq, event);
          lastSeq = event.seq;
        } catch {
          // The close handler releases the subscription.
        }
      });
      try {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const snapshot = options.service.getSnapshot(request.params.taskId);
        writeSse(writer, snapshot.type, snapshot.seq, snapshot);
        lastSeq = snapshot.seq;
        bootstrapComplete = true;
        for (const event of bufferedEvents) {
          if (event.seq <= lastSeq) continue;
          writeSse(writer, event.type, event.seq, event);
          lastSeq = event.seq;
        }
      } catch (error) {
        unsubscribe();
        throw error;
      }
      const heartbeat = setInterval(() => {
        try {
          writer.push(': keepalive\n\n');
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);
      return new Promise<void>((resolve) => {
        request.raw.on('close', () => {
          clearInterval(heartbeat);
          unsubscribe();
          writer.close();
          resolve();
        });
      });
    }
  );
};

export default agentTaskRoutes;

function writeSse(writer: BoundedSseWriter, type: string, seq: number, data: unknown): void {
  writer.push(`event: ${type}\nid: ${seq}\ndata: ${JSON.stringify(data)}\n\n`);
}
