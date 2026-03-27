// Test helpers for Debug UI E2E tests
import { Page, expect } from '@playwright/test';

export const DEBUG_UI_URL = process.env.DEBUG_UI_URL || 'http://localhost:3000';
export const WS_URL = process.env.WS_URL || 'ws://localhost:3000/debug/ws';

/**
 * Navigate to the Debug UI and wait for page load
 */
export async function navigateToDebugUI(page: Page): Promise<void> {
  await page.goto(DEBUG_UI_URL);
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for WebSocket connection to be established
 */
export async function waitForWebSocket(page: Page, timeout = 5000): Promise<void> {
  const statusIndicator = page.locator('[data-testid="websocket-status"], .websocket-status');
  await expect(statusIndicator).toBeVisible({ timeout });
}

/**
 * Wait for WebSocket status indicator to show specific status
 */
export async function waitForStatusIndicator(
  page: Page,
  status: 'connected' | 'disconnected' | 'connecting',
  timeout = 5000
): Promise<void> {
  const indicator = page.locator('[data-testid="websocket-status"]');
  await indicator.waitFor({ state: 'visible', timeout });
  await expect(indicator).toHaveAttribute('data-status', status, { timeout });
}

/**
 * Get text content from an element, with fallback
 */
export async function getTextContent(page: Page, selector: string): Promise<string> {
  const element = page.locator(selector);
  await expect(element).toBeVisible();
  const text = await element.textContent();
  return text || '';
}

/**
 * Take screenshot with timestamp and save to test-results directory
 */
export async function takeScreenshot(page: Page, name: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({ 
    path: `test-results/${name}-${timestamp}.png`,
    fullPage: false 
  });
}

/**
 * Mock browser status by intercepting API calls
 */
export async function mockBrowserStatus(
  page: Page,
  status: 'open' | 'closed' | 'error'
): Promise<void> {
  await page.route('**/api/browser/status', (route) => {
    if (status === 'open') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ isOpen: true, currentUrl: 'https://example.com' }),
      });
    } else if (status === 'closed') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ isOpen: false }),
      });
    } else {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Browser error' }),
      });
    }
  });
}

/**
 * Create a test task payload for API requests
 */
export function createTestTask(options?: {
  url?: string;
  instruction?: string;
  maxSteps?: number;
}): { url: string; instruction: string; context?: { maxSteps: number } } {
  return {
    url: options?.url || 'https://www.example.com',
    instruction: options?.instruction || 'Test instruction',
    ...(options?.maxSteps && {
      context: { maxSteps: options.maxSteps },
    }),
  };
}

/**
 * Wait for a specific element to appear and be visible
 */
export async function waitForElement(page: Page, selector: string, timeout = 5000): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

/**
 * Click an element and wait for navigation if needed
 */
export async function clickAndWait(page: Page, selector: string, waitOptions?: {
  waitForNavigation?: boolean;
  timeout?: number;
}): Promise<void> {
  await page.click(selector);
  
  if (waitOptions?.waitForNavigation) {
    await page.waitForLoadState('networkidle', { timeout: waitOptions.timeout || 5000 });
  }
}

/**
 * Fill an input field with typing delay
 */
export async function fillInput(page: Page, selector: string, value: string, delay = 50): Promise<void> {
  await page.fill(selector, value);
}

/**
 * Check if an element is visible
 */
export async function isElementVisible(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all WebSocket messages from the page
 */
export async function getWebSocketMessages(page: Page, timeout = 3000): Promise<string[]> {
  const messages: string[] = [];
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const message = await page.evaluate(() => {
      // This would need to be implemented in the page context
      return null;
    });
    
    if (message) {
      messages.push(message);
    }
    
    await page.waitForTimeout(100);
  }
  
  return messages;
}
