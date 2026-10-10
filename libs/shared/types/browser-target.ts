import { Type, type Static } from '@sinclair/typebox';
const closed = { additionalProperties: false } as const;
const LocatorValueSchema = {
  value: Type.String({ minLength: 1, maxLength: 2000 }),
  exact: Type.Optional(Type.Boolean()),
};
export const BrowserLocatorCandidateSchema = Type.Union([
  Type.Object(
    {
      strategy: Type.Literal('role'),
      role: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String()),
      exact: Type.Optional(Type.Boolean()),
    },
    closed
  ),
  Type.Object(
    { strategy: Type.Literal('test_id'), value: Type.String({ minLength: 1, maxLength: 2000 }) },
    closed
  ),
  Type.Object({ strategy: Type.Literal('label'), ...LocatorValueSchema }, closed),
  Type.Object({ strategy: Type.Literal('placeholder'), ...LocatorValueSchema }, closed),
  Type.Object({ strategy: Type.Literal('text'), ...LocatorValueSchema }, closed),
  Type.Object(
    { strategy: Type.Literal('css'), value: Type.String({ minLength: 1, maxLength: 2000 }) },
    closed
  ),
  Type.Object(
    { strategy: Type.Literal('xpath'), value: Type.String({ minLength: 1, maxLength: 2000 }) },
    closed
  ),
]);
export const BrowserTargetRefV1Schema = Type.Object(
  {
    semantic: Type.String({ minLength: 1, maxLength: 500 }),
    candidates: Type.Array(BrowserLocatorCandidateSchema),
    expected: Type.Object(
      {
        cardinality: Type.Union([
          Type.Literal('exactly_one'),
          Type.Literal('at_least_one'),
          Type.Literal('zero_or_one'),
        ]),
        visible: Type.Optional(Type.Boolean()),
        enabled: Type.Optional(Type.Boolean()),
        editable: Type.Optional(Type.Boolean()),
      },
      closed
    ),
  },
  closed
);

export type BrowserLocatorCandidate = Static<typeof BrowserLocatorCandidateSchema>;
export type BrowserTargetRefV1 = Static<typeof BrowserTargetRefV1Schema>;
