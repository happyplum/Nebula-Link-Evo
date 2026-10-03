import { Type, type Static } from '@sinclair/typebox';
export type AmendmentState =
  | 'draft'
  | 'candidate_ready'
  | 'waiting_decision'
  | 'queued_at_safe_boundary'
  | 'verifying'
  | 'activated'
  | 'rejected'
  | 'failed'
  | 'stale';

export type AmendmentCategory =
  | 'requirement'
  | 'script'
  | 'acceptance'
  | 'scenario_add'
  | 'scenario_remove'
  | 'scenario_reorder'
  | 'module_call'
  | 'repair';

export interface AmendmentRecord {
  id: string;
  jobId: string;
  threadId: string;
  state: AmendmentState;
  reason: string;
  category: AmendmentCategory;
  impact: Record<string, unknown>;
  validationPlan: Record<string, unknown>;
  decisionIds: string[];
  changes: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  failure?: Record<string, unknown>;
  staleReason?: Record<string, unknown>;
}

const IdSchema = Type.String({ minLength: 1, maxLength: 200 });

export const CreateJobBodySchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai-e2e.create-authoring-job/1.0'),
    mode: Type.Union([Type.Literal('bootstrap'), Type.Literal('recheck'), Type.Literal('repair')]),
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

export const DecisionAnswerBodySchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai-e2e.impact-decision-answer/1.0'),
    answer: Type.Union([Type.Literal('approve'), Type.Literal('reject')]),
    reason: Type.String({ minLength: 1, maxLength: 2_000 }),
    answeredBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);

export const AmendmentCommandBodySchema = Type.Union([
  Type.Object({ action: Type.Literal('queue_at_safe_boundary') }, { additionalProperties: false }),
  Type.Object(
    { action: Type.Literal('reject'), reason: Type.String({ minLength: 1, maxLength: 2_000 }) },
    { additionalProperties: false }
  ),
]);

export const AuthoringCommandBodySchema = Type.Object(
  {
    schema: Type.Literal('nebula.ai-e2e.authoring-command/1.0'),
    action: Type.Union([Type.Literal('pause'), Type.Literal('resume'), Type.Literal('cancel')]),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    createdBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);

export type CreateAuthoringJobRequest = Static<typeof CreateJobBodySchema>;
export type AuthoringCommandRequest = Static<typeof AuthoringCommandBodySchema>;
export type AmendmentCommandRequest = Static<typeof AmendmentCommandBodySchema>;
export type AmendmentDecisionAnswerRequest = Static<typeof DecisionAnswerBodySchema>;

export type AuthoringLifecycle =
  | 'created'
  | 'planning'
  | 'running'
  | 'paused'
  | 'waiting_decision'
  | 'completing'
  | 'completed'
  | 'cancelling'
  | 'cancelled'
  | 'failed';

export interface AuthoringJobResult {
  id: string;
  browserJobId: string;
  lifecycle: AuthoringLifecycle;
  stateVersion: number;
  created: boolean;
}

export interface CreateAuthoringJobResult extends AuthoringJobResult {
  taskId: string;
}

export interface AuthoringCommandResult {
  lifecycle: AuthoringLifecycle;
  stateVersion: number;
}
