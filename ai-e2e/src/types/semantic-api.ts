import { Type, type TSchema } from '@sinclair/typebox';

export const ApiProblemSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    retryable: Type.Boolean(),
    correlationId: Type.String(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false }
);

export const ApiMetaSchema = Type.Object(
  {
    requestId: Type.String(),
    correlationId: Type.Optional(Type.String()),
    stateVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false }
);

export function apiSuccessSchema<T extends TSchema>(data: T) {
  return Type.Object({ data, meta: ApiMetaSchema }, { additionalProperties: false });
}

export const ServiceCapabilitiesSchema = Type.Object(
  {
    schema: Type.Literal('nebula.service-capabilities/1.0'),
    service: Type.Literal('ai-e2e'),
    serviceVersion: Type.String(),
    protocols: Type.Record(
      Type.String(),
      Type.Object(
        { major: Type.Integer({ minimum: 1 }), minor: Type.Integer({ minimum: 0 }) },
        { additionalProperties: false }
      )
    ),
    features: Type.Record(
      Type.String(),
      Type.Union([Type.Boolean(), Type.String(), Type.Number()])
    ),
    limits: Type.Record(Type.String(), Type.Number()),
    generatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false }
);

export const SemanticAssetTypeSchema = Type.Union([
  Type.Literal('page_definition'),
  Type.Literal('business_module'),
  Type.Literal('functional_module'),
  Type.Literal('functional_script'),
  Type.Literal('test_scenario'),
  Type.Literal('module_requirement'),
  Type.Literal('page_baseline'),
]);

export const SemanticEventSchema = Type.Object(
  {
    id: Type.String(),
    seq: Type.Integer({ minimum: 1 }),
    schemaVersion: Type.Literal(1),
    type: Type.String(),
    entityType: Type.String(),
    entityId: Type.String(),
    stateVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    correlationId: Type.Optional(Type.String()),
    causationId: Type.Optional(Type.String()),
    payload: Type.Record(Type.String(), Type.Unknown()),
    occurredAt: Type.String(),
  },
  { additionalProperties: false }
);
