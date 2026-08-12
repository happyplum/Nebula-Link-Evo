import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { AgentTaskError } from '../../../agent-tasks/errors.js';
import type { AgentTaskService } from '../../../agent-tasks/service.js';
import { buildAgentTaskCapabilities } from '../../../agent-tasks/capabilities.js';

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
    async () => buildAgentTaskCapabilities(options.serviceVersion, options.localControlPlane)
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
};

export default agentTaskRoutes;
