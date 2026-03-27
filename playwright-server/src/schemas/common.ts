import { Type, Static } from '@sinclair/typebox';

export const SuccessResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.Optional(Type.String()),
});

export const ErrorResponseSchema = Type.Object({
  success: Type.Literal(false),
  error: Type.String(),
});

export const ViewportSchema = Type.Object({
  width: Type.Number(),
  height: Type.Number(),
});

export const BoundingBoxSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number(),
  height: Type.Number(),
});

export type SuccessResponse = Static<typeof SuccessResponseSchema>;
export type ErrorResponse = Static<typeof ErrorResponseSchema>;
export type Viewport = Static<typeof ViewportSchema>;
export type BoundingBox = Static<typeof BoundingBoxSchema>;
