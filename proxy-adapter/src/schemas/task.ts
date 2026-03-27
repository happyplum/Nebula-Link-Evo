import { Type, Static } from '@sinclair/typebox';
import { ContextSchema } from './common.js';

export const TaskRequestSchema = Type.Object({
  url: Type.String({ format: 'uri' }),
  instruction: Type.String(),
  context: Type.Optional(ContextSchema),
});

export const ActionSchema = Type.Object({
  action: Type.Object({
    type: Type.String(),
    params: Type.Record(Type.String(), Type.Any()),
    reasoning: Type.Optional(Type.String()),
  }),
  success: Type.Boolean(),
  message: Type.Optional(Type.String()),
});

export const TaskResponseSchema = Type.Object({
  success: Type.Boolean(),
  url: Type.String(),
  actions: Type.Array(ActionSchema),
  result: Type.Optional(Type.String()),
});

export type TaskRequest = Static<typeof TaskRequestSchema>;
export type Action = Static<typeof ActionSchema>;
export type TaskResponse = Static<typeof TaskResponseSchema>;
