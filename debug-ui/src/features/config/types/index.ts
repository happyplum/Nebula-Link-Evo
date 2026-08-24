/**
 * Typed interfaces for the config/health/MCP domain.
 * These match proxy-adapter response shapes — local to debug-ui.
 */

// --- Config ---

export interface ConfigResponse {
  mode?: string;
  decision?: { provider: string; model: string };
  vision?: { provider: string; model: string };
  providers?: string[];
  error?: string;
}

// --- Health ---

export type McpServerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'reconnecting'
  | 'failed'
  | 'shutting_down';

export interface McpServerStatus {
  name: string;
  running: boolean;
  state: McpServerState;
  toolsCount: number;
  source?: 'built-in' | 'external';
}

export interface HealthResponse {
  status: string;
  mcp: {
    enabled: boolean;
    servers: McpServerStatus[];
  };
  services: {
    playwright: string;
  };
}

// --- MCP ---

export interface McpStatusResponse {
  enabled: boolean;
  servers: McpServerStatus[];
}

/** Recursive JSON Schema property – captures everything the MCP SDK can return. */
export interface McpToolInputProperty {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: McpToolInputProperty;
  properties?: Record<string, McpToolInputProperty>;
  required?: string[];
  anyOf?: McpToolInputProperty[];
  oneOf?: McpToolInputProperty[];
  allOf?: McpToolInputProperty[];
  [key: string]: unknown; // catch-all for $ref, additionalProperties, etc.
}

export interface McpTool {
  name: string;
  description: string;
  source?: 'built-in' | 'external';
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema?: {
    type?: string;
    properties?: Record<string, McpToolInputProperty>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface McpToolsResponse {
  tools: McpTool[];
}

export interface McpCallRequest {
  server: string;
  tool: string;
  args?: Record<string, unknown>;
}

export interface McpCallResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

// --- Test AI ---

export interface AiTestResult {
  status: string;
  provider?: string;
  model?: string;
  responseTime?: number;
  error?: string;
  intro?: string;
}

export interface TestAiResponse {
  decision?: AiTestResult;
  visionAgent?: {
    status: string;
    tools?: string[];
    responseTime?: number;
    error?: string;
  };
  totalResponseTime?: number;
}
