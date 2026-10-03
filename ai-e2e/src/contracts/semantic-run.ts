import { Type, type Static } from '@sinclair/typebox';

const IdSchema = Type.String({ minLength: 1, maxLength: 200 });
const JsonObjectSchema = Type.Record(Type.String(), Type.Unknown());

export const CreateRunBodySchema = Type.Object(
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

export const RunCommandBodySchema = Type.Union([
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

export const DecisionAnswerBodySchema = Type.Object(
  {
    answerKey: Type.String({ minLength: 1, maxLength: 100 }),
    reason: Type.String({ minLength: 1, maxLength: 2_000 }),
    answeredBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);

export type CreateRunRequest = Static<typeof CreateRunBodySchema>;
export type RunCommandRequest = Static<typeof RunCommandBodySchema>;
export type RunDecisionAnswerRequest = Static<typeof DecisionAnswerBodySchema>;

export type RunLifecycle =
  | 'created'
  | 'planning'
  | 'ready'
  | 'running'
  | 'paused'
  | 'completing'
  | 'completed'
  | 'cancelling'
  | 'cancelled';

export interface SemanticRunResult {
  id: string;
  browserJobId: string;
  lifecycle: RunLifecycle;
  stateVersion: number;
  created: boolean;
}

export interface FormalRunCreationResult extends SemanticRunResult {
  admission: 'ready' | 'approval_required' | 'denied';
  decisionId?: string;
}

export interface RunCommandResult {
  lifecycle: string;
  stateVersion: number;
  replayed: boolean;
  conflict?: {
    expectedStateVersion: number;
    actualStateVersion: number;
  };
}
