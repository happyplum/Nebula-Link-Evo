import { describe, expect, it } from 'vitest';
import * as endpoints from '../endpoints.js';

describe('REST endpoint constants', () => {
  it('should define config & health endpoints', () => {
    expect(endpoints.API_CONFIG).toBe('/api/v1/config');
    expect(endpoints.API_HEALTH).toBe('/api/v1/health');
  });

  it('should define debug AI endpoints', () => {
    expect(endpoints.DEBUG_TEST_AI).toBe('/api/v1/test-ai');
  });

  it('should define all playwright endpoints', () => {
    expect(endpoints.DEBUG_PLAYWRIGHT_STATUS).toBe('/debug/api/playwright/status');
    expect(endpoints.DEBUG_PLAYWRIGHT_OPEN).toBe('/debug/api/playwright/open');
    expect(endpoints.DEBUG_PLAYWRIGHT_CLOSE).toBe('/debug/api/playwright/close');
    expect(endpoints.DEBUG_PLAYWRIGHT_NAVIGATE).toBe('/debug/api/playwright/navigate');
    expect(endpoints.DEBUG_PLAYWRIGHT_SCREENSHOT).toBe('/debug/api/playwright/screenshot');
    expect(endpoints.DEBUG_PLAYWRIGHT_CLICK).toBe('/debug/api/playwright/click');
    expect(endpoints.DEBUG_PLAYWRIGHT_SCROLL).toBe('/debug/api/playwright/scroll');
    expect(endpoints.DEBUG_PLAYWRIGHT_ACTION).toBe('/debug/api/playwright/action');
  });

  it('should define DOM & interaction endpoints', () => {
    expect(endpoints.DEBUG_DOM).toBe('/debug/api/dom');
    expect(endpoints.DEBUG_INTERACTIONS).toBe('/debug/api/interactions');
    expect(endpoints.DEBUG_INTERACTION_STATS).toBe('/debug/api/interactions/stats');
  });

  it('should define MCP endpoints', () => {
    expect(endpoints.DEBUG_MCP_STATUS).toBe('/debug/api/mcp/status');
    expect(endpoints.DEBUG_MCP_TOOLS).toBe('/debug/api/mcp/tools');
    expect(endpoints.DEBUG_MCP_CALL).toBe('/debug/api/mcp/call');
  });

  it('should define chat session endpoints with dynamic IDs', () => {
    expect(endpoints.API_CHAT_SESSIONS).toBe('/api/v1/chat/sessions');
    expect(endpoints.apiChatSession('s1')).toBe('/api/v1/chat/sessions/s1');
    expect(endpoints.apiChatSessionMessages('s1')).toBe('/api/v1/chat/sessions/s1/messages');
    expect(endpoints.apiChatSessionInterrupt('s1')).toBe('/api/v1/chat/sessions/s1/interrupt');
    expect(endpoints.apiChatSessionCancel('s1')).toBe('/api/v1/chat/sessions/s1/cancel');
    expect(endpoints.apiChatSessionPause('s1')).toBe('/api/v1/chat/sessions/s1/pause');
    expect(endpoints.apiChatSessionResume('s1')).toBe('/api/v1/chat/sessions/s1/resume');
    expect(endpoints.API_CHAT_CONNECTIVITY_TEST).toBe('/api/v1/chat/connectivity-test');
  });

  it('should have all endpoints as const strings', () => {
    const values = Object.values(endpoints).filter((v) => typeof v === 'string');
    values.forEach((v) => {
      expect(typeof v).toBe('string');
      expect(v).toMatch(/^\//);
    });
  });

  it('should have all factory functions return strings starting with /', () => {
    const factories = [
      endpoints.apiChatSession,
      endpoints.apiChatSessionMessages,
      endpoints.apiChatSessionInterrupt,
      endpoints.apiChatSessionCancel,
      endpoints.apiChatSessionPause,
      endpoints.apiChatSessionResume,
    ];
    factories.forEach((fn) => {
      const result = fn('test-id');
      expect(result).toMatch(/^\//);
    });
  });
});
