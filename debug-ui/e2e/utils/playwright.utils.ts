import { Page, expect } from '@playwright/test';
import { TIMEOUTS } from '../constants';

/**
 * Debug UI test utility functions (React selectors)
 */

export const DEBUG_UI_URL = process.env.DEBUG_UI_URL || 'http://localhost:5173/debug';
export const API_URL = process.env.API_URL || 'http://localhost:3000/api';
export const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws/debug';

/**
 * Navigate to Debug UI and wait for page load
 */
export async function navigateToDebugUI(page: Page): Promise<void> {
  await page.goto(DEBUG_UI_URL);
  await page.waitForLoadState('networkidle');
}

/**
 * Navigate to specific debug page section
 */
export async function navigateToDebugSection(page: Page, section: string): Promise<void> {
  await page.goto(`${DEBUG_UI_URL}#${section}`);
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for WebSocket connection indicator to be visible
 */
export async function waitForWebSocket(page: Page, timeout = 5000): Promise<void> {
  const statusIndicator = page.locator('[data-testid="connection-status"]');
  await expect(statusIndicator).toBeVisible({ timeout });
}

/**
 * Wait for WebSocket status indicator to show specific status
 */
export async function waitForWebSocketStatus(
  page: Page,
  status: 'connected' | 'disconnected' | 'connecting',
  timeout = 5000
): Promise<void> {
  const indicator = page.locator('[data-testid="connection-status"]');
  await indicator.waitFor({ state: 'visible', timeout });
  await expect(indicator).toContainText(status, { timeout });
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
 * Wait for element to be hidden or removed
 */
export async function waitForElementToBeHidden(
  page: Page,
  selector: string,
  timeout = 5000
): Promise<void> {
  await page.waitForSelector(selector, { state: 'hidden', timeout });
}

/**
 * Click an element and wait for navigation if needed
 */
export async function clickAndWait(
  page: Page,
  selector: string,
  waitOptions?: {
    waitForNavigation?: boolean;
    timeout?: number;
  }
): Promise<void> {
  await page.click(selector);

  if (waitOptions?.waitForNavigation) {
    await page.waitForLoadState('networkidle', { timeout: waitOptions.timeout || 5000 });
  }
}

/**
 * Fill an input field with typing delay
 */
export async function fillInput(
  page: Page,
  selector: string,
  value: string,
  delay = 50
): Promise<void> {
  await page.fill(selector, value);
}

/**
 * Type into an input field character by character
 */
export async function typeInput(
  page: Page,
  selector: string,
  value: string,
  delay = 50
): Promise<void> {
  await page.type(selector, value, { delay });
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
 * Check if an element exists in the DOM
 */
export async function elementExists(page: Page, selector: string): Promise<boolean> {
  const element = page.locator(selector).first();
  const count = await element.count();
  return count > 0;
}

/**
 * Get all WebSocket messages from page context
 */
export async function getWebSocketMessages(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const wsMessages = (globalThis as unknown as { wsMessages?: unknown[] }).wsMessages;
    return wsMessages || [];
  });
}

/**
 * Clear all WebSocket messages from page context
 */
export async function clearWebSocketMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    (globalThis as unknown as { wsMessages: unknown[] }).wsMessages = [];
  });
}

/**
 * Wait for specific WebSocket message
 */
export async function waitForWebSocketMessage(
  page: Page,
  messagePredicate: (message: unknown) => boolean,
  timeout = 5000
): Promise<unknown> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const messages = await getWebSocketMessages(page);
    const foundMessage = messages.find(messagePredicate);

    if (foundMessage) {
      return foundMessage;
    }

    await page.waitForTimeout(TIMEOUTS.INSTANT);
  }

  throw new Error(`WebSocket message not found within ${timeout}ms`);
}

/**
 * Mock API endpoint to return specific data
 */
export async function mockAPIEndpoint(
  page: Page,
  urlPattern: string | RegExp,
  response: {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  }
): Promise<void> {
  await page.route(urlPattern, (route) => {
    route.fulfill({
      status: response.status,
      contentType: response.headers?.['Content-Type'] || 'application/json',
      body: JSON.stringify(response.body),
      headers: response.headers,
    });
  });
}

/**
 * Restore all mocked API endpoints
 */
export async function restoreAPIEndpoints(page: Page): Promise<void> {
  page.unrouteAll({ behavior: 'ignoreErrors' });
}

/**
 * Check if browser is connected to playwright-server
 */
export async function isBrowserConnected(page: Page): Promise<boolean> {
  try {
    const response = await page.evaluate(async () => {
      const res = await fetch('http://localhost:3001/api/health');
      return res.ok;
    });
    return response;
  } catch {
    return false;
  }
}

/**
 * Reload page and wait for network idle
 */
export async function reloadPage(page: Page): Promise<void> {
  await page.reload();
  await page.waitForLoadState('networkidle');
}

// ============================================================
// Legacy helpers — kept for backward compatibility but updated to data-testid
// ============================================================

/**
 * Submit a task via the Control Panel
 * TODO: React refactor — new ControlPanel uses action-button-navigate
 */
export async function submitTask(
  page: Page,
  task: { url: string; instruction: string }
): Promise<void> {
  const navigateBtn = page.locator('[data-testid="action-button-navigate"]');
  const input = page
    .locator('[data-testid="action-button-navigate"]')
    .locator('..')
    .locator('input[type="text"]');

  if ((await input.count()) > 0) {
    await input.fill(task.url);
  }
  if ((await navigateBtn.count()) > 0) {
    await navigateBtn.click();
  }
}

/**
 * Get current task status
 * TODO: React refactor — task status display changed
 */
export async function getTaskStatus(page: Page): Promise<string> {
  const statusElement = page.locator('[data-testid="connection-status"]');
  const status = await statusElement.textContent();
  return status || '';
}

/**
 * Wait for task to complete (success or failure)
 */
export async function waitForTaskComplete(page: Page, timeout = 30000): Promise<void> {
  const statusIndicator = page.locator('[data-testid="connection-status"]');

  await statusIndicator.waitFor({ state: 'visible', timeout });
  // Poll for completion
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const status = await getTaskStatus(page);
    if (status === 'completed' || status === 'failed' || status === 'error') {
      return;
    }
    await page.waitForTimeout(TIMEOUTS.MEDIUM);
  }

  throw new Error(`Task did not complete within ${timeout}ms`);
}

/**
 * Switch to a specific tab in right panel via Tabs component
 */
export async function switchTab(page: Page, tabName: string): Promise<void> {
  const tab = page.locator(`[data-testid="tabs-${tabName}"]`);
  await tab.click();
}

/**
 * Get active tab name
 */
export async function getActiveTab(page: Page): Promise<string> {
  const activeTab = page.locator('[role="tab"][aria-selected="true"]');
  const tabName = await activeTab.getAttribute('data-testid');
  return tabName?.replace('tabs-', '') || '';
}
