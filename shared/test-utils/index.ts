/**
 * Shared test utilities and mocks
 *
 * This module provides mock implementations for external dependencies
 * used in both proxy-adapter and playwright-server tests.
 */

// Service lifecycle utilities
export * from './service-lifecycle.js';

// KimiClient mocks
export {
  createKimiClientMock,
  createMockUIElement,
  createMockActionResult,
} from './mocks/KimiClient.mock.js';

// BrowserContext mocks
export {
  createBrowserContextMock,
  createMockPage,
  createBrowserLifecycleMock,
  createMockElementHandle,
} from './mocks/BrowserContext.mock.js';

// WebSocket mocks
export {
  createWebSocketMock,
  createFastifyWebSocketMock,
  simulateWebSocketMessage,
  simulateWebSocketError,
  simulateWebSocketClose,
} from './mocks/WebSocket.mock.js';