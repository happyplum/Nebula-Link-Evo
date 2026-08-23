import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';
import type { SemanticRunService } from '../../services/semantic-run-service.js';
import { ServiceError } from '../../services/service-error.js';
import type { ApiSuccess } from '../../types/semantic-control.js';
import { ApiProblemSchema, apiSuccessSchema } from '../../types/semantic-api.js';
import fp from '../plugins/fastify-plugin.js';

const IdSchema = Type.String({ minLength: 1, maxLength: 200 });
const HashSchema = Type.String({ pattern: '^[a-fA-F0-9]{64}$' });
const JsonObjectSchema = Type.Record(Type.String(), Type.Unknown());
const IdempotencyHeaderSchema = Type.Object(
  { 'idempotency-key': Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: true }
);
const CommandHeaderSchema = Type.Object(
  {
    'idempotency-key': Type.String({ minLength: 1, maxLength: 200 }),
    'if-match': Type.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: true }
);
const ProjectParamsSchema = Type.Object({ projectId: IdSchema }, { additionalProperties: false });
const RunParamsSchema = Type.Object({ runId: IdSchema }, { additionalProperties: false });
const TodoParamsSchema = Type.Object(
  { runId: IdSchema, todoId: IdSchema },
  { additionalProperties: false }
);
const DecisionParamsSchema = Type.Object(
  { runId: IdSchema, decisionId: IdSchema },
  { additionalProperties: false }
);

const CreateRunBodySchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai-e2e.create-run/1.0'),
    businessVersionId: IdSchema,
    scenarioRevisionId: IdSchema,
    deploymentRevisionId: IdSchema,
    inputs: JsonObjectSchema,
    secretRefs: Type.Optional(Type.Record(Type.String(), Type.String({ minLength: 1 }))),
    evidencePolicy: Type.Optional(
      Type.Union([Type.Literal('default'), Type.Literal('extended'), Type.Literal('minimal')])
    ),
  },
  { additionalProperties: false }
);

const RunCommandBodySchema = Type.Union([
  Type.Object(
    {
      schema: Type.Literal('nebula.ai-e2e.run-command/1.0'),
      action: Type.Union([
        Type.Literal('start'),
        Type.Literal('pause'),
        Type.Literal('resume'),
        Type.Literal('cancel'),
      ]),
      reason: Type.Optional(Type.String({ maxLength: 2_000 })),
      createdBy: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      schema: Type.Literal('nebula.ai-e2e.run-command/1.0'),
      action: Type.Literal('close_browser'),
      createdBy: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false }
  ),
]);

const StartTodoBodySchema = Type.Object(
  {
    browserSessionId: IdSchema,
    tabId: IdSchema,
    browserLeaseRefHash: HashSchema,
    toolPolicyHash: HashSchema,
    taskPayloadSha256: HashSchema,
    requiredAuthContext: JsonObjectSchema,
    sideEffectAuthorization: JsonObjectSchema,
    budget: JsonObjectSchema,
    aiTaskId: Type.Optional(IdSchema),
    aiSessionId: Type.Optional(IdSchema),
  },
  { additionalProperties: false }
);

const AttemptResultSchema = Type.Union([
  Type.Literal('succeeded'),
  Type.Literal('assertion_failed'),
  Type.Literal('execution_failed'),
  Type.Literal('precondition_blocked'),
  Type.Literal('recoverable_interruption'),
  Type.Literal('decision_required'),
  Type.Literal('outcome_unknown'),
  Type.Literal('cancelled'),
]);
const DecisionProposalSchema = Type.Object(
  {
    category: Type.String({ minLength: 1, maxLength: 100 }),
    question: Type.String({ minLength: 1, maxLength: 2_000 }),
    facts: JsonObjectSchema,
    evidenceRefs: Type.Optional(Type.Array(IdSchema, { maxItems: 1_000 })),
    options: Type.Array(JsonObjectSchema, { minItems: 1, maxItems: 20 }),
    recommendationKey: Type.Optional(Type.String({ maxLength: 100 })),
    impact: JsonObjectSchema,
  },
  { additionalProperties: false }
);
const CompleteAttemptBodySchema = Type.Object(
  {
    pageTaskId: IdSchema,
    result: AttemptResultSchema,
    reasonClass: Type.String({ minLength: 1, maxLength: 200 }),
    agentTaskId: IdSchema,
    startedAt: Type.String({ format: 'date-time' }),
    checkpoint: Type.Optional(JsonObjectSchema),
    actualPage: Type.Optional(JsonObjectSchema),
    confirmedOutputs: Type.Optional(JsonObjectSchema),
    partialOutputs: Type.Optional(JsonObjectSchema),
    sideEffects: Type.Optional(JsonObjectSchema),
    downstreamImpact: Type.Optional(JsonObjectSchema),
    policyEvaluationId: Type.Optional(IdSchema),
    approvalGrantId: Type.Optional(IdSchema),
    evidenceManifestId: Type.Optional(IdSchema),
    decision: Type.Optional(DecisionProposalSchema),
  },
  { additionalProperties: false }
);

const DecisionAnswerBodySchema = Type.Object(
  {
    answerKey: Type.String({ minLength: 1, maxLength: 100 }),
    reason: Type.String({ minLength: 1, maxLength: 2_000 }),
    answeredBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);

const UnknownSuccessSchema = apiSuccessSchema(Type.Unknown());
const ErrorResponses = {
  400: ApiProblemSchema,
  404: ApiProblemSchema,
  409: ApiProblemSchema,
  503: ApiProblemSchema,
};

export interface SemanticRunRoutesOptions {
  service?: SemanticRunService;
}

const semanticRunRoutes: FastifyPluginAsyncTypebox<SemanticRunRoutesOptions> = async (
  fastify,
  options
) => {
  const requireService = (): SemanticRunService => {
    if (!options.service) throw ServiceError.unavailable('Semantic run service is not configured');
    return options.service;
  };

  fastify.post<{
    Params: Static<typeof ProjectParamsSchema>;
    Headers: Static<typeof IdempotencyHeaderSchema>;
    Body: Static<typeof CreateRunBodySchema>;
  }>(
    '/projects/:projectId/runs',
    {
      schema: {
        params: ProjectParamsSchema,
        headers: IdempotencyHeaderSchema,
        body: CreateRunBodySchema,
        response: { 200: UnknownSuccessSchema, 201: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      const result = requireService().create({
        projectId: request.params.projectId,
        businessVersionId: request.body.businessVersionId,
        clientRunId: request.headers['idempotency-key'],
        scenarioRevisionId: request.body.scenarioRevisionId,
        deploymentRevisionId: request.body.deploymentRevisionId,
        inputs: request.body.inputs,
        ...(request.body.secretRefs ? { secretRefs: request.body.secretRefs } : {}),
        ...(request.body.evidencePolicy ? { evidencePolicy: request.body.evidencePolicy } : {}),
      });
      return reply
        .status(result.created ? 201 : 200)
        .send(success(request, result, result.stateVersion));
    }
  );

  fastify.post<{
    Params: Static<typeof RunParamsSchema>;
    Headers: Static<typeof CommandHeaderSchema>;
    Body: Static<typeof RunCommandBodySchema>;
  }>(
    '/runs/:runId/commands',
    {
      schema: {
        params: RunParamsSchema,
        headers: CommandHeaderSchema,
        body: RunCommandBodySchema,
        response: { 200: UnknownSuccessSchema, 202: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      if (request.body.action === 'close_browser') {
        const result = requireService().closeBrowser(
          request.headers['idempotency-key'],
          request.params.runId,
          request.body.createdBy
        );
        return reply.status(202).send(success(request, result));
      }
      const result = requireService().command({
        commandId: request.headers['idempotency-key'],
        runId: request.params.runId,
        action: request.body.action,
        expectedStateVersion: parseStateVersion(request.headers['if-match']),
        ...(request.body.reason ? { reason: request.body.reason } : {}),
        createdBy: request.body.createdBy,
      });
      return success(request, result, result.stateVersion);
    }
  );

  fastify.post<{
    Params: Static<typeof TodoParamsSchema>;
    Body: Static<typeof StartTodoBodySchema>;
  }>(
    '/runs/:runId/todos/:todoId/start',
    {
      schema: {
        params: TodoParamsSchema,
        body: StartTodoBodySchema,
        response: { 201: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      const result = requireService().startTodo({
        runId: request.params.runId,
        todoId: request.params.todoId,
        ...request.body,
      });
      return reply.status(201).send(success(request, result));
    }
  );

  fastify.post<{
    Params: Static<typeof TodoParamsSchema>;
    Body: Static<typeof CompleteAttemptBodySchema>;
  }>(
    '/runs/:runId/todos/:todoId/attempts',
    {
      schema: {
        params: TodoParamsSchema,
        body: CompleteAttemptBodySchema,
        response: { 201: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      const result = requireService().completeTodoAttempt({
        runId: request.params.runId,
        todoId: request.params.todoId,
        ...request.body,
      });
      return reply.status(201).send(success(request, result));
    }
  );

  fastify.post<{ Params: Static<typeof TodoParamsSchema> }>(
    '/runs/:runId/todos/:todoId/resume',
    {
      schema: {
        params: TodoParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) =>
      success(request, requireService().resumeTodo(request.params.runId, request.params.todoId))
  );

  fastify.post<{
    Params: Static<typeof DecisionParamsSchema>;
    Body: Static<typeof DecisionAnswerBodySchema>;
  }>(
    '/runs/:runId/decisions/:decisionId/answer',
    {
      schema: {
        params: DecisionParamsSchema,
        body: DecisionAnswerBodySchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) =>
      success(
        request,
        requireService().answerDecision({
          runId: request.params.runId,
          decisionId: request.params.decisionId,
          ...request.body,
        })
      )
  );
};

function parseStateVersion(value: string): number {
  const normalized = value.replace(/^W\//, '').replace(/^"|"$/g, '');
  const stateVersion = Number.parseInt(normalized, 10);
  if (!Number.isInteger(stateVersion) || stateVersion < 1) {
    throw ServiceError.validation(
      "If-Match must contain a positive state version, for example '3'"
    );
  }
  return stateVersion;
}

function success<T>(request: FastifyRequest, data: T, stateVersion?: number): ApiSuccess<T> {
  const correlationHeader = request.headers['x-correlation-id'];
  const correlationId = Array.isArray(correlationHeader) ? correlationHeader[0] : correlationHeader;
  return {
    data,
    meta: {
      requestId: request.id,
      ...(correlationId ? { correlationId } : {}),
      ...(stateVersion ? { stateVersion } : {}),
    },
  };
}

export default fp(semanticRunRoutes, {
  fastify: '5.x',
  name: 'semantic-run-routes',
  encapsulate: true,
});
