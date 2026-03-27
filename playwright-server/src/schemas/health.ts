import { Type, Static } from '@sinclair/typebox';

export const HealthResponseSchema = Type.Object({
  status: Type.String(),
  browserOpen: Type.Boolean(),
});

export type HealthResponse = Static<typeof HealthResponseSchema>;
