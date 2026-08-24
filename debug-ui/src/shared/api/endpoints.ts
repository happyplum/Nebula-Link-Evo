/**
 * REST endpoint constants. Only request-response endpoints are defined here.
 * Streaming endpoints are assembled by their dedicated clients and intentionally absent.
 */

// Config & Health
export const API_CONFIG = '/api/v1/config' as const;
export const API_HEALTH = '/api/v1/health' as const;

// Debug API — AI
export const DEBUG_TEST_AI = '/api/v1/test-ai' as const;

// Debug API — Playwright
export const DEBUG_PLAYWRIGHT_STATUS = '/debug/api/playwright/status' as const;
export const DEBUG_PLAYWRIGHT_OPEN = '/debug/api/playwright/open' as const;
export const DEBUG_PLAYWRIGHT_CLOSE = '/debug/api/playwright/close' as const;
export const DEBUG_PLAYWRIGHT_NAVIGATE = '/debug/api/playwright/navigate' as const;
export const DEBUG_PLAYWRIGHT_SCREENSHOT = '/debug/api/playwright/screenshot' as const;
export const DEBUG_PLAYWRIGHT_CLICK = '/debug/api/playwright/click' as const;
export const DEBUG_PLAYWRIGHT_SCROLL = '/debug/api/playwright/scroll' as const;
export const DEBUG_PLAYWRIGHT_ACTION = '/debug/api/playwright/action' as const;
export const DEBUG_PLAYWRIGHT_ELEMENT_AT = '/debug/api/playwright/element-at' as const;
export const DEBUG_PLAYWRIGHT_CLICK_BY_MARKER = '/debug/api/playwright/click-by-marker' as const;
export const DEBUG_PLAYWRIGHT_EXECUTE_BY_MARKER =
  '/debug/api/playwright/execute-by-marker' as const;
export const DEBUG_PLAYWRIGHT_TABS = '/debug/api/playwright/tabs' as const;
export const DEBUG_PLAYWRIGHT_SWITCH_TAB = '/debug/api/playwright/tabs/switch' as const;

// Debug API — DOM & Interactions
export const DEBUG_DOM = '/debug/api/dom' as const;
export const DEBUG_INTERACTIONS = '/debug/api/interactions' as const;
export const DEBUG_INTERACTION_STATS = '/debug/api/interactions/stats' as const;

// Debug API — MCP
export const DEBUG_MCP_STATUS = '/debug/api/mcp/status' as const;
export const DEBUG_MCP_TOOLS = '/debug/api/mcp/tools' as const;
export const DEBUG_MCP_CALL = '/debug/api/mcp/call' as const;

// Chat Sessions
export const API_CHAT_SESSIONS = '/api/v1/chat/sessions' as const;
export const apiChatSession = (id: string) => `/api/v1/chat/sessions/${id}` as const;
export const apiChatSessionMessages = (id: string) =>
  `/api/v1/chat/sessions/${id}/messages` as const;
export const apiChatSessionInterrupt = (id: string) =>
  `/api/v1/chat/sessions/${id}/interrupt` as const;
export const apiChatSessionCancel = (id: string) => `/api/v1/chat/sessions/${id}/cancel` as const;
export const apiChatSessionPause = (id: string) => `/api/v1/chat/sessions/${id}/pause` as const;
export const apiChatSessionResume = (id: string) => `/api/v1/chat/sessions/${id}/resume` as const;
export const apiChatSessionJob = (sessionId: string, jobId: string) =>
  `/api/v1/chat/sessions/${sessionId}/jobs/${jobId}` as const;
export const API_CHAT_CONNECTIVITY_TEST = '/api/v1/chat/connectivity-test' as const;
