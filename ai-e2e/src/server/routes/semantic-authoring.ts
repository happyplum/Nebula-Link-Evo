import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';
import type { SemanticAuthoringService } from '../../services/semantic-authoring-service.js';
import { ServiceError } from '../../services/service-error.js';
import type { ApiSuccess } from '../../types/semantic-control.js';
import {
  ApiProblemSchema,
  SemanticAssetTypeSchema,
  apiSuccessSchema,
} from '../../types/semantic-api.js';
import fp from '../plugins/fastify-plugin.js';

const IdSchema = Type.String({ minLength: 1, maxLength: 200 });
const HashSchema = Type.String({ pattern: '^[a-fA-F0-9]{64}$' });
const IdempotencyHeaderSchema = Type.Object(
  { 'idempotency-key': Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: true }
);
const VersionParamsSchema = Type.Object({ versionId: IdSchema }, { additionalProperties: false });
const JobParamsSchema = Type.Object({ jobId: IdSchema }, { additionalProperties: false });
const ThreadParamsSchema = Type.Object({ threadId: IdSchema }, { additionalProperties: false });
const AmendmentParamsSchema = Type.Object(
  { amendmentId: IdSchema },
  { additionalProperties: false }
);
const DecisionParamsSchema = Type.Object(
  { amendmentId: IdSchema, decisionId: IdSchema },
  { additionalProperties: false }
);

const CreateJobBodySchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai-e2e.create-authoring-job/1.0'),
    mode: Type.Union([
      Type.Literal('bootstrap'),
      Type.Literal('recheck'),
      Type.Literal('repair'),
      Type.Literal('import_conversion'),
    ]),
    intent: Type.Optional(
      Type.Union([Type.Literal('author_assets'), Type.Literal('locate_in_browser')])
    ),
    targetType: Type.Optional(Type.String({ maxLength: 100 })),
    targetId: Type.Optional(IdSchema),
    currentUrl: Type.Optional(Type.String({ maxLength: 2_000 })),
    parentRunId: Type.Optional(IdSchema),
    reason: Type.Optional(Type.String({ maxLength: 2_000 })),
    createdBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);

const CreateThreadBodySchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai-e2e.authoring-context/1.0'),
    businessVersionId: IdSchema,
    currentUrl: Type.String({ minLength: 1, maxLength: 2_000 }),
    currentPageDefinitionId: IdSchema,
    currentFunctionalModuleId: IdSchema,
    baseRevisionSha256: HashSchema,
    visibleScenarioIds: Type.Array(IdSchema, { maxItems: 1_000 }),
    context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    createdBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);

const DependencySchema = Type.Object(
  {
    toAssetType: Type.String({ minLength: 1, maxLength: 100 }),
    toAssetId: IdSchema,
    toRevisionId: Type.Optional(IdSchema),
    relation: Type.Union([
      Type.Literal('page_scope'),
      Type.Literal('requirement_source'),
      Type.Literal('scenario_call'),
      Type.Literal('output_binding'),
      Type.Literal('assertion_input'),
      Type.Literal('baseline_target'),
      Type.Literal('decision_source'),
    ]),
    sourcePointer: Type.String({ minLength: 1, maxLength: 1_000 }),
  },
  { additionalProperties: false }
);

const AmendmentChangeSchema = Type.Object(
  {
    assetType: SemanticAssetTypeSchema,
    assetId: IdSchema,
    baseRevisionId: IdSchema,
    baseRevisionSha256: HashSchema,
    candidateRevisionId: IdSchema,
    targetPageDefinitionId: IdSchema,
    targetFunctionalModuleId: Type.Optional(IdSchema),
    targetUrl: Type.String({ minLength: 1, maxLength: 2_000 }),
    category: Type.String({ minLength: 1, maxLength: 100 }),
    diff: Type.Record(Type.String(), Type.Unknown()),
    dependencies: Type.Optional(Type.Array(DependencySchema, { maxItems: 2_000 })),
    verificationScopeSha256: Type.Optional(HashSchema),
    dependencyClosureSha256: Type.Optional(HashSchema),
  },
  { additionalProperties: false }
);

const AmendmentCategorySchema = Type.Union([
  Type.Literal('requirement'),
  Type.Literal('script'),
  Type.Literal('acceptance'),
  Type.Literal('scenario_add'),
  Type.Literal('scenario_remove'),
  Type.Literal('scenario_reorder'),
  Type.Literal('module_call'),
  Type.Literal('repair'),
]);

const CreateAmendmentBodySchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai-e2e.authoring-amendment/1.0'),
    threadId: IdSchema,
    reason: Type.String({ minLength: 1, maxLength: 2_000 }),
    category: AmendmentCategorySchema,
    changes: Type.Array(AmendmentChangeSchema, { minItems: 1, maxItems: 100 }),
    validationPlan: Type.Record(Type.String(), Type.Unknown()),
    potentialSideEffects: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    createdBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);

const ChatMessageBodySchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai-e2e.authoring-chat-message/1.0'),
    role: Type.Union([Type.Literal('user'), Type.Literal('assistant'), Type.Literal('system')]),
    content: Type.String({ minLength: 1, maxLength: 20_000 }),
    amendmentId: Type.Optional(IdSchema),
    createdBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);

const DecisionAnswerBodySchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai-e2e.impact-decision-answer/1.0'),
    answer: Type.Union([Type.Literal('approve'), Type.Literal('reject')]),
    reason: Type.String({ minLength: 1, maxLength: 2_000 }),
    answeredBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);

const AmendmentCommandBodySchema = Type.Union([
  Type.Object({ action: Type.Literal('queue_at_safe_boundary') }, { additionalProperties: false }),
  Type.Object(
    { action: Type.Literal('reject'), reason: Type.String({ minLength: 1, maxLength: 2_000 }) },
    { additionalProperties: false }
  ),
]);

const UnknownSuccessSchema = apiSuccessSchema(Type.Unknown());
const ErrorResponses = {
  400: ApiProblemSchema,
  404: ApiProblemSchema,
  409: ApiProblemSchema,
  503: ApiProblemSchema,
};

export interface SemanticAuthoringRoutesOptions {
  service?: SemanticAuthoringService;
}

const semanticAuthoringRoutes: FastifyPluginAsyncTypebox<SemanticAuthoringRoutesOptions> = async (
  fastify,
  options
) => {
  const requireService = (): SemanticAuthoringService => {
    if (!options.service) {
      throw ServiceError.unavailable('Semantic authoring service is not configured');
    }
    return options.service;
  };

  fastify.post<{
    Params: Static<typeof VersionParamsSchema>;
    Headers: Static<typeof IdempotencyHeaderSchema>;
    Body: Static<typeof CreateJobBodySchema>;
  }>(
    '/business-versions/:versionId/authoring-jobs',
    {
      schema: {
        params: VersionParamsSchema,
        headers: IdempotencyHeaderSchema,
        body: CreateJobBodySchema,
        response: { 200: UnknownSuccessSchema, 201: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      const result = requireService().createJob({
        businessVersionId: request.params.versionId,
        mode: request.body.mode,
        ...(request.body.intent ? { intent: request.body.intent } : {}),
        idempotencyKey: request.headers['idempotency-key'],
        ...(request.body.targetType ? { targetType: request.body.targetType } : {}),
        ...(request.body.targetId ? { targetId: request.body.targetId } : {}),
        ...(request.body.currentUrl ? { currentUrl: request.body.currentUrl } : {}),
        ...(request.body.parentRunId ? { parentRunId: request.body.parentRunId } : {}),
        ...(request.body.reason ? { reason: request.body.reason } : {}),
        createdBy: request.body.createdBy,
      });
      return reply.status(result.created ? 201 : 200).send(success(request, result));
    }
  );

  fastify.post<{
    Params: Static<typeof JobParamsSchema>;
    Body: Static<typeof CreateThreadBodySchema>;
  }>(
    '/authoring-jobs/:jobId/context-threads',
    {
      schema: {
        params: JobParamsSchema,
        body: CreateThreadBodySchema,
        response: { 200: UnknownSuccessSchema, 201: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      const result = requireService().createThread({
        jobId: request.params.jobId,
        businessVersionId: request.body.businessVersionId,
        scope: {
          currentUrl: request.body.currentUrl,
          currentPageDefinitionId: request.body.currentPageDefinitionId,
          currentFunctionalModuleId: request.body.currentFunctionalModuleId,
          baseRevisionSha256: request.body.baseRevisionSha256,
          visibleScenarioIds: request.body.visibleScenarioIds,
          ...(request.body.context ? { context: request.body.context } : {}),
        },
        createdBy: request.body.createdBy,
      });
      return reply.status(result.created ? 201 : 200).send(success(request, result));
    }
  );

  fastify.post<{
    Params: Static<typeof JobParamsSchema>;
    Headers: Static<typeof IdempotencyHeaderSchema>;
    Body: Static<typeof CreateAmendmentBodySchema>;
  }>(
    '/authoring-jobs/:jobId/amendments',
    {
      schema: {
        params: JobParamsSchema,
        headers: IdempotencyHeaderSchema,
        body: CreateAmendmentBodySchema,
        response: { 200: UnknownSuccessSchema, 201: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      const result = requireService().createAmendment({
        jobId: request.params.jobId,
        threadId: request.body.threadId,
        idempotencyKey: request.headers['idempotency-key'],
        reason: request.body.reason,
        category: request.body.category,
        changes: request.body.changes,
        validationPlan: request.body.validationPlan,
        ...(request.body.potentialSideEffects
          ? { potentialSideEffects: request.body.potentialSideEffects }
          : {}),
        createdBy: request.body.createdBy,
      });
      return reply.status(result.created ? 201 : 200).send(success(request, result.amendment));
    }
  );

  fastify.get<{ Params: Static<typeof JobParamsSchema> }>(
    '/authoring-jobs/:jobId/amendments',
    {
      schema: {
        params: JobParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) =>
      success(request, { amendments: requireService().listAmendments(request.params.jobId) })
  );

  fastify.get<{ Params: Static<typeof AmendmentParamsSchema> }>(
    '/authoring-amendments/:amendmentId',
    {
      schema: {
        params: AmendmentParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) => success(request, requireService().getAmendment(request.params.amendmentId))
  );

  fastify.post<{
    Params: Static<typeof ThreadParamsSchema>;
    Body: Static<typeof ChatMessageBodySchema>;
  }>(
    '/authoring-context-threads/:threadId/messages',
    {
      schema: {
        params: ThreadParamsSchema,
        body: ChatMessageBodySchema,
        response: { 201: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request, reply) =>
      reply.status(201).send(
        success(
          request,
          requireService().addChatMessage({
            threadId: request.params.threadId,
            role: request.body.role,
            content: request.body.content,
            ...(request.body.amendmentId ? { amendmentId: request.body.amendmentId } : {}),
            createdBy: request.body.createdBy,
          })
        )
      )
  );

  fastify.get<{ Params: Static<typeof ThreadParamsSchema> }>(
    '/authoring-context-threads/:threadId/messages',
    {
      schema: {
        params: ThreadParamsSchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) =>
      success(request, { messages: requireService().listChatMessages(request.params.threadId) })
  );

  fastify.post<{
    Params: Static<typeof DecisionParamsSchema>;
    Body: Static<typeof DecisionAnswerBodySchema>;
  }>(
    '/authoring-amendments/:amendmentId/decisions/:decisionId/answer',
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
          amendmentId: request.params.amendmentId,
          decisionId: request.params.decisionId,
          answer: request.body.answer,
          reason: request.body.reason,
          answeredBy: request.body.answeredBy,
        })
      )
  );

  fastify.post<{
    Params: Static<typeof AmendmentParamsSchema>;
    Body: Static<typeof AmendmentCommandBodySchema>;
  }>(
    '/authoring-amendments/:amendmentId/commands',
    {
      schema: {
        params: AmendmentParamsSchema,
        body: AmendmentCommandBodySchema,
        response: { 200: UnknownSuccessSchema, ...ErrorResponses },
      },
    },
    async (request) =>
      success(request, requireService().command(request.params.amendmentId, request.body))
  );
};

function success<T>(
  request: FastifyRequest,
  data: T,
  meta: { correlationId?: string } = {}
): ApiSuccess<T> {
  const correlationHeader = request.headers['x-correlation-id'];
  const correlationId =
    meta.correlationId ??
    (Array.isArray(correlationHeader) ? correlationHeader[0] : correlationHeader);
  return {
    data,
    meta: {
      requestId: request.id,
      ...(correlationId ? { correlationId } : {}),
    },
  };
}

export default fp(semanticAuthoringRoutes, {
  fastify: '5.x',
  name: 'semantic-authoring-routes',
  encapsulate: true,
});
