import { Type, type Static } from '@sinclair/typebox';
import { ACT_OPERATIONS, OBSERVE_OPERATIONS } from './browser-execution.js';
import { BrowserLocatorCandidateSchema } from './browser-target.js';

const closed = { additionalProperties: false } as const;

export const BROWSER_OPERATION_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'outcome_unknown',
] as const;

export const BrowserOperationStatusSchema = Type.Union(
  BROWSER_OPERATION_STATUSES.map((status) => Type.Literal(status))
);

export const BrowserExecutionProblemSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    retryable: Type.Boolean(),
    correlationId: Type.String(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  closed
);

export const ResolvedBrowserTargetSchema = Type.Object(
  {
    semantic: Type.String(),
    strategy: Type.Index(BrowserLocatorCandidateSchema, ['strategy']),
    candidateIndex: Type.Integer({ minimum: 0 }),
    matchedCount: Type.Integer({ minimum: 0 }),
  },
  closed
);

export const BrowserArtifactRefV1Schema = Type.Object(
  {
    id: Type.String(),
    kind: Type.String(),
    sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    mimeType: Type.String(),
    sizeBytes: Type.Integer({ minimum: 1 }),
    snapshotId: Type.Optional(Type.String({ minLength: 1 })),
  },
  closed
);

export const BrowserOperationRecordSchema = Type.Object(
  {
    schema: Type.Literal('nebula.browser.operation-result/1.0'),
    operationId: Type.String(),
    requestHash: Type.String(),
    sessionId: Type.String(),
    leaseId: Type.String(),
    leaseSequence: Type.Integer(),
    tabId: Type.Optional(Type.String()),
    kind: Type.Union([Type.Literal('observe'), Type.Literal('act')]),
    operation: Type.Union(
      [...OBSERVE_OPERATIONS, ...ACT_OPERATIONS].map((operation) => Type.Literal(operation))
    ),
    status: BrowserOperationStatusSchema,
    queueSequence: Type.Integer(),
    acceptedAt: Type.String(),
    startedAt: Type.Optional(Type.String()),
    completedAt: Type.Optional(Type.String()),
    resolvedTarget: Type.Optional(ResolvedBrowserTargetSchema),
    actual: Type.Optional(Type.Unknown()),
    artifacts: Type.Array(BrowserArtifactRefV1Schema),
    error: Type.Optional(BrowserExecutionProblemSchema),
  },
  closed
);

export type BrowserOperationStatus = Static<typeof BrowserOperationStatusSchema>;
export type BrowserExecutionProblem = Static<typeof BrowserExecutionProblemSchema>;
export type ResolvedBrowserTarget = Static<typeof ResolvedBrowserTargetSchema>;
export type BrowserArtifactRefV1 = Static<typeof BrowserArtifactRefV1Schema>;
export type BrowserOperationRecord = Static<typeof BrowserOperationRecordSchema>;
