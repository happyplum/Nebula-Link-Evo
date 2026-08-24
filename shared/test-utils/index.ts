/**
 * Shared test utilities and mocks
 *
 * This module provides mock implementations for external dependencies
 * used in proxy-adapter tests.
 */

// Service lifecycle utilities
export * from './service-lifecycle.js';

// BrowserContext mocks
export {
  createBrowserContextMock,
  createMockPage,
  createBrowserLifecycleMock,
  createMockElementHandle,
} from './mocks/BrowserContext.mock.js';
