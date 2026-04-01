import { test as base, expect, Page } from '@playwright/test';

/**
 * Test options interface for Debug UI tests
 */
export interface TestOptions {
  debugURL: string;
  apiURL: string;
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
  waitForWebSocketStatus(status: 'connected' | 'disconnected' | 'connecting'): Promise<void>;
  sendTestTask(task: object): Promise<void>;
  getWebSocketMessages(): Promise<string[]>;
}

/**
 * Service manager for controlling playwright-server
 */
export interface ServiceManager {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isRunning: boolean;
}

/**
 * Extended test fixture with custom fixtures for Debug UI testing
 */
export const test = base.extend<{
  testOptions: TestOptions;
  debugPage: DebugPage;
  wsMonitor: WebSocketMonitor;
  serviceManager: ServiceManager;
}>({
  // Provide test configuration options
  testOptions: async ({}, use) => {
    const options: TestOptions = {
      debugURL: process.env.DEBUG_UI_URL || 'http://localhost:3000/debug',
      apiURL: process.env.PROXY_API_URL || 'http://localhost:3000/api',
    };
    await use(options);
  },

  // Provide authenticated page fixture
  debugPage: async ({ page, testOptions }, use) => {
    // Navigate to Debug UI
    await page.goto(testOptions.debugURL);
    await page.waitForLoadState('networkidle');

    // Track WebSocket messages
    const messages: string[] = [];

    // Enhance page with debug-specific methods
    const debugPage = page as DebugPage;
    debugPage.waitForWebSocketStatus = async (status) => {
      const indicator = page.locator('[data-testid="connection-status"]');
      await indicator.waitFor({ state: 'visible' });

      const text = await indicator.textContent();
      if (status === 'connected') {
        await expect(text).toContain('connected');
      } else if (status === 'disconnected') {
        await expect(text).toContain('disconnected');
      } else if (status === 'connecting') {
        await expect(text).toContain('connecting');
      }
    };

    debugPage.sendTestTask = async (task) => {
      await page.evaluate((taskObj) => {
        const input = document.querySelector('[data-testid="composer-input"]');
        if (input) {
          (input as HTMLTextAreaElement).value = JSON.stringify(taskObj);
        }
      }, task);
    };

    debugPage.getWebSocketMessages = async () => {
      return page.evaluate(() => {
        const wsElement = document.querySelector('[data-testid="message-list"]');
        const text = wsElement ? (wsElement as HTMLElement).textContent || '' : '';
        try {
          return text ? JSON.parse(text) : [];
        } catch {
          return text ? text.split('\n').filter((line: string) => line.trim()) : [];
        }
      });
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

    page.on('websocket', (ws) => {
      monitor.connectionCount++;
      monitor.isConnected = true;

      ws.on('framereceived', (frame) => {
        monitor.lastMessage = frame.payload.toString();
        monitor.messages.push(monitor.lastMessage);
      });

      ws.on('close', () => {
        monitor.isConnected = false;
      });
    });

    page.on('close', () => {
      monitor.isConnected = false;
    });

    await use(monitor);
  },

  // Provide service manager fixture for playwright-server
  serviceManager: async ({}, use) => {
    const manager: ServiceManager = {
      isRunning: false,
      start: async () => {
        try {
          const response = await fetch('http://localhost:3001/api/health');
          manager.isRunning = response.ok;
        } catch {
          manager.isRunning = false;
        }
      },
      stop: async () => {},
    };

    await use(manager);
  },
});

export { expect };
