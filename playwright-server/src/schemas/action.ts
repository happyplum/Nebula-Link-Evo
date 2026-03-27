import { Type, Static } from '@sinclair/typebox';

export const ClickRequestSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
});

export const ClickBySelectorRequestSchema = Type.Object({
  selector: Type.String(),
  options: Type.Optional(
    Type.Object({
      button: Type.Optional(Type.String({ default: 'left' })),
      clickCount: Type.Optional(Type.Number({ default: 1 })),
      delay: Type.Optional(Type.Number({ default: 0 })),
    })
  ),
});

export const TypeRequestSchema = Type.Object({
  selector: Type.String(),
  text: Type.String(),
  options: Type.Optional(
    Type.Object({
      delay: Type.Optional(Type.Number({ default: 0 })),
      clear: Type.Optional(Type.Boolean({ default: false })),
    })
  ),
});

export const ScrollRequestSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
});

export const ClickByMarkerRequestSchema = Type.Object({
  snapshot_id: Type.String(),
  nebula_id: Type.Number(),
});

export const ClickByMarkerResponseSchema = Type.Object({
  success: Type.Boolean(),
  strategy_used: Type.String(),
  attempts: Type.Number(),
  latency_ms: Type.Number(),
});

export const ClickByMarkerErrorResponseSchema = Type.Object({
  success: Type.Boolean(),
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
  }),
});

// Action enum for marker-based operations
export const ActionEnum = Type.Union([
  Type.Literal('click'),
  Type.Literal('type'),
  Type.Literal('focus'),
  Type.Literal('blur'),
  Type.Literal('hover'),
  Type.Literal('value'),
  Type.Literal('dispatch'),
]);

// Unified request schema for marker-based actions
export const ExecuteByMarkerRequestSchema = Type.Object({
  snapshot_id: Type.String(),
  nebula_id: Type.Number(),
  action: ActionEnum,
  param: Type.Optional(Type.Unknown()),
});

export type ClickRequest = Static<typeof ClickRequestSchema>;
export type ClickBySelectorRequest = Static<typeof ClickBySelectorRequestSchema>;
export type TypeRequest = Static<typeof TypeRequestSchema>;
export type ScrollRequest = Static<typeof ScrollRequestSchema>;
export type ClickByMarkerRequest = Static<typeof ClickByMarkerRequestSchema>;
export type ExecuteByMarkerRequest = Static<typeof ExecuteByMarkerRequestSchema>;
