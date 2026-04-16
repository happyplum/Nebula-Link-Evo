import { Type, Static } from '@sinclair/typebox';
import { ViewportSchema } from './common.js';

export const BrowserOpenRequestSchema = Type.Object({
  headless: Type.Optional(Type.Boolean({ default: false })),
  viewport: Type.Optional(ViewportSchema),
  cdpPort: Type.Optional(Type.Number({ description: 'CDP debugging port for remote connection' })),
});

export const BrowserNavigateRequestSchema = Type.Object({
  url: Type.String({ format: 'uri' }),
  waitUntil: Type.Optional(Type.String({ default: 'networkidle' })),
  timeout: Type.Optional(Type.Number({ default: 30000 })),
});

export const BrowserStatusResponseSchema = Type.Object({
  isOpen: Type.Boolean(),
  currentUrl: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  viewport: Type.Optional(ViewportSchema),
});

export const ScreenshotResponseSchema = Type.Object({
  success: Type.Boolean(),
  screenshot: Type.String(),
  viewport: ViewportSchema,
});

export const BrowserTabSchema = Type.Object({
  id: Type.String(),
  url: Type.String(),
  title: Type.String(),
  isActive: Type.Boolean(),
});

export const BrowserTabsResponseSchema = Type.Object({
  tabs: Type.Array(BrowserTabSchema),
});

export const BrowserSwitchTabRequestSchema = Type.Object({
  id: Type.String(),
});


export type BrowserOpenRequest = Static<typeof BrowserOpenRequestSchema>;
export type BrowserNavigateRequest = Static<typeof BrowserNavigateRequestSchema>;
export type BrowserStatusResponse = Static<typeof BrowserStatusResponseSchema>;
export type ScreenshotResponse = Static<typeof ScreenshotResponseSchema>;
export type BrowserTab = Static<typeof BrowserTabSchema>;
export type BrowserTabsResponse = Static<typeof BrowserTabsResponseSchema>;
export type BrowserSwitchTabRequest = Static<typeof BrowserSwitchTabRequestSchema>;
