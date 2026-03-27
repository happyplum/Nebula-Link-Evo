import { test as base, expect, Page } from '@playwright/test';

/**
 * Test options interface for Debug UI tests
 */
export interface TestOptions {
  baseURL: string;
  apiEndpoint: string;
}

/**
 * WebSocket monitor fixture for tracking WS connections
 */
export interface WebSocketMonitor {
  connectionCount: number;
  lastMessage: string | null;
  messages: string[];
  isConnected: boolean;
}

/**
 * Debug Page fixture extending Page with debug-specific helpers
 */
export interface DebugPage extends Page {
  waitForStatusIndicator(status: 'connected' | 'disconnected' | 'connecting'): Promise<void>;
}

/**
 * Extended test fixture with custom fixtures for Debug UI testing
 */
export const test = base.extend<{
  testOptions: TestOptions;
  debugPage: DebugPage;
  wsMonitor: WebSocketMonitor;
}>({
  // Provide test configuration options
  testOptions: async ({ playwright }, use) => {
    const options: TestOptions = {
      baseURL: process.env.DEBUG_UI_URL || 'http://localhost:3000',
      apiEndpoint: process.env.PROXY_API_URL || 'http://localhost:3000/api',
    };
    await use(options);
  },

  // Provide authenticated page fixture
  debugPage: async ({ page, testOptions }, use) => {
    // Navigate to Debug UI
    await page.goto(testOptions.baseURL);
    await page.waitForLoadState('networkidle');

    // Enhance page with debug-specific methods
    const debugPage = page as DebugPage;
    debugPage.waitForStatusIndicator = async (status) => {
      const indicator = page.locator('[data-testid="websocket-status"]');
      await indicator.waitFor({ state: 'visible' });
      
      // Check status based on class or data attribute
      if (status === 'connected') {
        await expect(indicator).toHaveAttribute('data-status', 'connected');
      } else if (status === 'disconnected') {
        await expect(indicator).toHaveAttribute('data-status', 'disconnected');
      } else if (status === 'connecting') {
        await expect(indicator).toHaveAttribute('data-status', 'connecting');
      }
    };

    await use(debugPage);
  },

  // Provide WebSocket monitoring fixture
  wsMonitor: async ({ page }, use) => {
    const monitor: WebSocketMonitor = {
      connectionCount: 0,
      lastMessage: null,
      messages: [],
      isConnected: false,
    };

    // Track WebSocket connections
    page.on('websocket', () => {
      monitor.connectionCount++;
      monitor.isConnected = true;
    });

    page.on('close', () => {
      monitor.isConnected = false;
    });

    await use(monitor);
  },
});

export { expect };
