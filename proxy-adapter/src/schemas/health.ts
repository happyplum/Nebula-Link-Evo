import { Type, Static } from '@sinclair/typebox';

const MCPServerSchema = Type.Object({
  name: Type.String(),
  running: Type.Boolean(),
  toolsCount: Type.Number(),
});

export const HealthResponseSchema = Type.Object({
  status: Type.String(),
  config: Type.String(),
  mcp: Type.Object({
    enabled: Type.Boolean(),
    servers: Type.Array(MCPServerSchema),
  }),
  services: Type.Object({
    playwright: Type.String(),
  }),
});

export type HealthResponse = Static<typeof HealthResponseSchema>;
