import { Type } from '@sinclair/typebox';

export const SessionStatusSchema = Type.Union([
  Type.Literal('idle'),
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('blocked'),
  Type.Literal('interrupted'),
  Type.Literal('cancelled'),
  Type.Literal('completed'),
]);

export const AgentStateSchema = Type.Object({
  schema_version: Type.Literal(1),
  currentTask: Type.Optional(
    Type.Object({
      description: Type.String(),
      startedAt: Type.String(),
      estimatedSteps: Type.Optional(Type.Number()),
      completedSteps: Type.Number(),
    })
  ),
  blockReason: Type.Optional(
    Type.Union([
      Type.Literal('waiting_for_user_input'),
      Type.Literal('api_error'),
      Type.Literal('rate_limit'),
      Type.Literal('validation_failed'),
      Type.Literal('timeout'),
      Type.Literal('job_error'),
    ])
  ),
  waitingFor: Type.Optional(
    Type.Union([
      Type.Literal('user_message'),
      Type.Literal('api_retry'),
      Type.Literal('external_confirmation'),
    ])
  ),
  retryCount: Type.Optional(Type.Number()),
  lastError: Type.Optional(Type.String()),
  retryAfterMs: Type.Optional(Type.Number({ minimum: 0 })),
});
