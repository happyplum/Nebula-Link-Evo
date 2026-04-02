/**
 * Typed interfaces for the config/health/MCP domain.
 * These match proxy-adapter response shapes — local to debug-ui.
 */

// --- Config ---

export interface ConfigResponse {
  mode?: string;
  vision?: { provider: string; model: string };
  decision?: { provider: string; model: string };
  providers?: string[];
  error?: string;
}

// --- Health ---

export interface McpServerStatus {
  name: string;
  running: boolean;
  toolsCount: number;
}

export interface HealthResponse {
  status: string;
  config: string;
  mcp: {
    enabled: boolean;
    servers: McpServerStatus[];
  };
  services: {
    playwright: string;
  };
  websocketConnections: number;
}

// --- MCP ---

export interface McpStatusResponse {
  enabled: boolean;
  servers: McpServerStatus[];
}

export interface McpToolInputProperty {
  type?: string;
  description?: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema?: {
    properties?: Record<string, McpToolInputProperty>;
    required?: string[];
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

// --- Verify Keys ---

export interface KeyStatus {
  provider: string;
  displayName?: string;
  status: 'valid' | 'not_set';
  keyPreview: string;
}

export interface VerifyKeysResponse {
  keys: KeyStatus[];
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
  vision?: AiTestResult;
  decision?: AiTestResult;
  totalResponseTime?: number;
}
