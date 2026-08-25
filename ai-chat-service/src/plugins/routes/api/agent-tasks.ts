import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { AgentTaskError } from '../../../agent-tasks/errors.js';
import type { AgentTaskService } from '../../../agent-tasks/service.js';
import type { AgentTaskEventRecord } from '../../../agent-tasks/repository.js';
import { buildAgentTaskCapabilities } from '../../../agent-tasks/capabilities.js';
import type { SkillCatalogEntry } from '../../../skills/runtime.js';
import { BoundedSseWriter } from '../../../services/sse-writer.js';

const ProblemSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    retryable: Type.Boolean(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false }
);

const ToolCallSchema = Type.Object(
  {
    toolCallId: Type.String(),
    toolName: Type.String(),
    status: Type.Union([
      Type.Literal('succeeded'),
      Type.Literal('failed'),
      Type.Literal('outcome_unknown'),
    ]),
    stepId: Type.Optional(Type.String()),
    operationId: Type.Optional(Type.String()),
    operation: Type.Optional(Type.String()),
    effectId: Type.Optional(Type.String()),
    errorCode: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);

const TaskSchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai.agent-task/1.0'),
    taskId: Type.String(),
    clientTaskId: Type.String(),
    status: Type.Union([
      Type.Literal('created'),
      Type.Literal('running'),
      Type.Literal('paused'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('interrupted'),
      Type.Literal('cancelled'),
      Type.Literal('blocked'),
    ]),
    stateVersion: Type.Integer({ minimum: 1 }),
    eventSeq: Type.Integer({ minimum: 0 }),
    lastCheckpointId: Type.Optional(Type.String()),
    modelRole: Type.Literal('decision'),
    request: Type.Unknown(),
    output: Type.Optional(Type.Unknown()),
    error: Type.Optional(ProblemSchema),
    terminationReason: Type.Optional(Type.String()),
    usage: Type.Optional(
      Type.Object(
        {
          inputTokens: Type.Number(),
          outputTokens: Type.Number(),
          totalTokens: Type.Number(),
          modelTurns: Type.Number(),
          toolCalls: Type.Number(),
        },
        { additionalProperties: false }
      )
    ),
    toolCalls: Type.Array(ToolCallSchema),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    startedAt: Type.Optional(Type.String()),
    completedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);

const ErrorSchema = Type.Object({ error: ProblemSchema }, { additionalProperties: false });
const CommandSchema = Type.Object(
  {
    id: Type.String(),
    taskId: Type.String(),
    type: Type.Union([
      Type.Literal('pause'),
      Type.Literal('resume'),
      Type.Literal('interrupt'),
      Type.Literal('cancel'),
    ]),
    expectedStateVersion: Type.Integer({ minimum: 1 }),
    requestHash: Type.String(),
    status: Type.Union([
      Type.Literal('accepted'),
      Type.Literal('completed'),
      Type.Literal('rejected'),
    ]),
    result: Type.Optional(Type.Unknown()),
    error: Type.Optional(ProblemSchema),
    createdBy: Type.String(),
    createdAt: Type.String(),
    completedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);
const EventSchema = Type.Object(
  {
    id: Type.String(),
    taskId: Type.String(),
    seq: Type.Integer({ minimum: 1 }),
    type: Type.String(),
    entityType: Type.Union([
      Type.Literal('task'),
      Type.Literal('command'),
      Type.Literal('checkpoint'),
      Type.Literal('skill'),
    ]),
    entityId: Type.String(),
    stateVersion: Type.Integer({ minimum: 1 }),
    correlationId: Type.Optional(Type.String()),
    causationId: Type.Optional(Type.String()),
    payload: Type.Record(Type.String(), Type.Unknown()),
    occurredAt: Type.String(),
    createdAt: Type.String(),
  },
  { additionalProperties: false }
);
const CommandResultSchema = Type.Object(
  { command: CommandSchema, task: TaskSchema },
  { additionalProperties: false }
);
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
    async () => options.skillCatalog ?? []
  );

  fastify.post<{ Body: unknown; Headers: { 'idempotency-key'?: string } }>(
    '/agent-tasks',
    {
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
        body: Type.Object(
          {
            schema: Type.Literal('nebula.ai.agent-task/1.0'),
            clientTaskId: Type.String({ minLength: 1, maxLength: 128 }),
            modelRole: Type.Literal('decision'),
            input: Type.Record(Type.String(), Type.Unknown()),
            responseSchema: Type.Record(Type.String(), Type.Unknown()),
            toolPolicy: Type.Unknown(),
            skillPolicy: Type.Unknown(),
            budgets: Type.Unknown(),
            browserBinding: Type.Optional(Type.Unknown()),
            sideEffectAuthorization: Type.Optional(Type.Unknown()),
            correlation: Type.Optional(Type.Record(Type.String(), Type.String())),
          },
          { additionalProperties: false }
        ),
        response: {
          200: TaskSchema,
          202: TaskSchema,
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
          200: TaskSchema,
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
    Body: {
      commandId: string;
      type: 'pause' | 'resume' | 'interrupt' | 'cancel';
      expectedStateVersion: number;
      reason?: string;
      createdBy?: string;
    };
  }>(
    '/agent-tasks/:taskId/commands',
    {
      preHandler: requireLocalControlPlane,
      schema: {
        description: 'Apply an idempotent optimistic command to an Agent task',
        tags: ['Agent Tasks'],
        params: TaskIdParamsSchema,
        body: Type.Object(
          {
            commandId: Type.String({ minLength: 1, maxLength: 128 }),
            type: Type.Union([
              Type.Literal('pause'),
              Type.Literal('resume'),
              Type.Literal('interrupt'),
              Type.Literal('cancel'),
            ]),
            expectedStateVersion: Type.Integer({ minimum: 1 }),
            reason: Type.Optional(Type.String({ maxLength: 1000 })),
            createdBy: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          },
          { additionalProperties: false }
        ),
        response: {
          200: CommandResultSchema,
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
          200: Type.Array(EventSchema),
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
