/** Public Agent Task wire schemas. Runtime/Harness state remains in ai-chat-service. */
import { Type, type Static } from '@sinclair/typebox';
import { BrowserTargetRefV1Schema } from './browser-target.js';

export const AGENT_TASK_SCHEMA = 'nebula.ai.agent-task/1.0' as const;
const closed = { additionalProperties: false } as const;
const id = Type.String({ minLength: 1, maxLength: 128 });
const jsonObject = Type.Record(Type.String(), Type.Unknown());
const hash = Type.String({ pattern: '^[a-fA-F0-9]{64}$' });

export const AgentTaskStatusSchema = Type.Union([
  Type.Literal('created'),
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('interrupted'),
  Type.Literal('cancelled'),
  Type.Literal('blocked'),
]);
export const AGENT_TASK_STATUSES = Object.freeze(
  AgentTaskStatusSchema.anyOf.map((status) => status.const)
);
export type AgentTaskStatus = Static<typeof AgentTaskStatusSchema>;

export const AgentTaskBrowserStepSchema = Type.Object(
  {
    stepId: id,
    kind: Type.Union([Type.Literal('observe'), Type.Literal('act')]),
    operation: Type.String(),
    target: Type.Optional(BrowserTargetRefV1Schema),
    args: Type.Optional(jsonObject),
    effectId: Type.Optional(id),
    maxAffectedItems: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
    capture: Type.Optional(
      Type.Object(
        {
          beforeScreenshot: Type.Optional(Type.Boolean()),
          afterScreenshot: Type.Optional(Type.Boolean()),
          domSnapshot: Type.Optional(Type.Boolean()),
          videoSegment: Type.Optional(Type.Boolean()),
        },
        closed
      )
    ),
  },
  closed
);
export type AgentTaskBrowserStep = Static<typeof AgentTaskBrowserStepSchema>;

export const PersistedAgentTaskBrowserBindingSchema = Type.Object(
  {
    browserSessionId: id,
    tabId: id,
    browserLeaseId: id,
    browserLeaseSequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    access: Type.Union([Type.Literal('observe'), Type.Literal('control')]),
  },
  closed
);
export const AgentTaskBrowserBindingSchema = Type.Object(
  {
    ...PersistedAgentTaskBrowserBindingSchema.properties,
    browserLeaseToken: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  closed
);
export type AgentTaskBrowserBinding = Static<typeof AgentTaskBrowserBindingSchema>;

export const AgentTaskSideEffectAuthorizationSchema = Type.Object(
  {
    contextType: Type.Union([Type.Literal('run'), Type.Literal('authoring')]),
    contextId: id,
    environment: Type.Union([
      Type.Literal('local'),
      Type.Literal('test'),
      Type.Literal('staging'),
      Type.Literal('production'),
    ]),
    policyVersion: id,
    policyEvaluationId: id,
    policyResult: Type.Union([Type.Literal('auto_allowed'), Type.Literal('approval_required')]),
    projectionSha256: hash,
    effects: Type.Array(
      Type.Object(
        {
          stepId: id,
          effectId: id,
          kind: Type.Union([
            Type.Literal('create'),
            Type.Literal('update'),
            Type.Literal('delete'),
            Type.Literal('auth_change'),
          ]),
          maxAffectedItems: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
          reversibility: Type.Union([
            Type.Literal('reversible'),
            Type.Literal('compensatable'),
            Type.Literal('irreversible'),
          ]),
          usesFileUpload: Type.Optional(Type.Boolean()),
        },
        closed
      )
    ),
    grant: Type.Optional(
      Type.Object(
        { grantId: Type.String(), status: Type.Literal('active'), approvedProjectionSha256: hash },
        closed
      )
    ),
  },
  closed
);
export type AgentTaskSideEffectAuthorization = Static<
  typeof AgentTaskSideEffectAuthorizationSchema
>;

export const AgentTaskToolPolicySchema = Type.Object(
  {
    allow: Type.Array(Type.String({ minLength: 1, maxLength: 200 })),
    constraints: Type.Optional(
      Type.Object(
        {
          'browser-control.operation_execute': Type.Optional(
            Type.Object({ steps: Type.Array(AgentTaskBrowserStepSchema) }, closed)
          ),
        },
        closed
      )
    ),
  },
  closed
);
export const AgentTaskSkillPolicySchema = Type.Object(
  {
    allow: Type.Array(
      Type.Object(
        {
          skillId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9][a-z0-9._-]*$' }),
          version: Type.String({
            minLength: 1,
            maxLength: 100,
            pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$',
          }),
          contentHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        },
        closed
      )
    ),
  },
  closed
);
export const AgentTaskBudgetsSchema = Type.Object(
  {
    maxDurationMs: Type.Integer({ maximum: Number.MAX_SAFE_INTEGER }),
    maxModelTurns: Type.Integer({ maximum: Number.MAX_SAFE_INTEGER }),
    maxToolCalls: Type.Integer({ maximum: Number.MAX_SAFE_INTEGER }),
    maxTokens: Type.Optional(Type.Integer({ maximum: Number.MAX_SAFE_INTEGER })),
  },
  closed
);
const requestProperties = {
  schema: Type.Literal(AGENT_TASK_SCHEMA),
  clientTaskId: id,
  modelRole: Type.Literal('decision'),
  input: jsonObject,
  responseSchema: jsonObject,
  toolPolicy: AgentTaskToolPolicySchema,
  skillPolicy: AgentTaskSkillPolicySchema,
  budgets: AgentTaskBudgetsSchema,
  sideEffectAuthorization: Type.Optional(AgentTaskSideEffectAuthorizationSchema),
  correlation: Type.Optional(
    Type.Record(
      Type.String({ pattern: '^[\\s\\S]{1,64}$' }),
      Type.String({ minLength: 1, maxLength: 256 }),
      closed
    )
  ),
};
export const CreateAgentTaskRequestSchema = Type.Object(
  { ...requestProperties, browserBinding: Type.Optional(AgentTaskBrowserBindingSchema) },
  closed
);
export const PersistedAgentTaskRequestSchema = Type.Object(
  { ...requestProperties, browserBinding: Type.Optional(PersistedAgentTaskBrowserBindingSchema) },
  closed
);
export type CreateAgentTaskRequest = Static<typeof CreateAgentTaskRequestSchema>;
export type PersistedAgentTaskRequest = Static<typeof PersistedAgentTaskRequestSchema>;

export const AgentTaskUsageSchema = Type.Object(
  {
    inputTokens: Type.Number(),
    outputTokens: Type.Number(),
    totalTokens: Type.Number(),
    modelTurns: Type.Number(),
    toolCalls: Type.Number(),
  },
  { additionalProperties: false }
);
export const AgentTaskProblemSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    retryable: Type.Boolean(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false }
);
export const AgentTaskToolCallSummarySchema = Type.Object(
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
export const AgentTaskViewSchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai.agent-task/1.0'),
    taskId: Type.String(),
    clientTaskId: Type.String(),
    status: AgentTaskStatusSchema,
    stateVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    eventSeq: Type.Integer({ minimum: 0 }),
    lastCheckpointId: Type.Optional(Type.String()),
    modelRole: Type.Literal('decision'),
    request: PersistedAgentTaskRequestSchema,
    output: Type.Optional(Type.Unknown()),
    error: Type.Optional(AgentTaskProblemSchema),
    terminationReason: Type.Optional(Type.String()),
    usage: Type.Optional(AgentTaskUsageSchema),
    toolCalls: Type.Array(AgentTaskToolCallSummarySchema),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    startedAt: Type.Optional(Type.String()),
    completedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);
export const AgentTaskCommandTypeSchema = Type.Union([
  Type.Literal('pause'),
  Type.Literal('resume'),
  Type.Literal('interrupt'),
  Type.Literal('cancel'),
]);
export type AgentTaskCommandType = Static<typeof AgentTaskCommandTypeSchema>;
export const AgentTaskCommandRecordSchema = Type.Object(
  {
    id: Type.String(),
    taskId: Type.String(),
    type: AgentTaskCommandTypeSchema,
    expectedStateVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    requestHash: Type.String(),
    status: Type.Union([
      Type.Literal('accepted'),
      Type.Literal('completed'),
      Type.Literal('rejected'),
    ]),
    result: Type.Optional(Type.Unknown()),
    error: Type.Optional(AgentTaskProblemSchema),
    createdBy: Type.String(),
    createdAt: Type.String(),
    completedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);
export const AgentTaskEventRecordSchema = Type.Object(
  {
    id: Type.String(),
    taskId: Type.String(),
    seq: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    type: Type.String(),
    entityType: Type.Union([
      Type.Literal('task'),
      Type.Literal('command'),
      Type.Literal('checkpoint'),
      Type.Literal('skill'),
    ]),
    entityId: Type.String(),
    stateVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    correlationId: Type.Optional(Type.String()),
    causationId: Type.Optional(Type.String()),
    payload: Type.Record(Type.String(), Type.Unknown()),
    occurredAt: Type.String(),
    createdAt: Type.String(),
  },
  { additionalProperties: false }
);
export const AgentTaskCommandResultSchema = Type.Object(
  { command: AgentTaskCommandRecordSchema, task: AgentTaskViewSchema },
  { additionalProperties: false }
);
export const AgentTaskCommandRequestSchema = Type.Object(
  {
    commandId: id,
    type: AgentTaskCommandTypeSchema,
    expectedStateVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    reason: Type.Optional(Type.String({ maxLength: 1000 })),
    createdBy: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  closed
);
export type AgentTaskUsage = Static<typeof AgentTaskUsageSchema>;
export type AgentTaskProblem = Static<typeof AgentTaskProblemSchema>;
export type AgentTaskToolCallSummary = Static<typeof AgentTaskToolCallSummarySchema>;
export type AgentTaskView = Static<typeof AgentTaskViewSchema>;
export type AgentTaskCommandRecord = Static<typeof AgentTaskCommandRecordSchema>;
export type AgentTaskEventRecord = Static<typeof AgentTaskEventRecordSchema>;
export type AgentTaskCommandResult = Static<typeof AgentTaskCommandResultSchema>;
export type AgentTaskCommandRequest = Static<typeof AgentTaskCommandRequestSchema>;
