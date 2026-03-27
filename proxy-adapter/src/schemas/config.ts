import { Type, Static } from '@sinclair/typebox';

const ModelSelectorSchema = Type.Object({
  provider: Type.String(),
  model: Type.String(),
});

export const ConfigResponseSchema = Type.Object({
  mode: Type.Optional(Type.String()),
  vision: Type.Optional(ModelSelectorSchema),
  decision: Type.Optional(ModelSelectorSchema),
  providers: Type.Optional(Type.Array(Type.String())),
  error: Type.Optional(Type.String()),
});

export type ConfigResponse = Static<typeof ConfigResponseSchema>;
