import { Type, Static } from '@sinclair/typebox';

export const SuccessResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.Optional(Type.String()),
});

export const ErrorResponseSchema = Type.Object({
  success: Type.Literal(false),
  error: Type.String(),
  details: Type.Optional(Type.String()),
});

export const PaginationQuerySchema = Type.Object({
  limit: Type.Optional(Type.Number({ default: 10 })),
  offset: Type.Optional(Type.Number({ default: 0 })),
});

export const ContextSchema = Type.Object({
  maxSteps: Type.Optional(Type.Number({ default: 10 })),
  previousActions: Type.Optional(Type.Array(Type.Any())),
});

export type SuccessResponse = Static<typeof SuccessResponseSchema>;
export type ErrorResponse = Static<typeof ErrorResponseSchema>;
export type PaginationQuery = Static<typeof PaginationQuerySchema>;
export type Context = Static<typeof ContextSchema>;
