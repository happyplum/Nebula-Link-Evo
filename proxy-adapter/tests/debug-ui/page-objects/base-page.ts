// Base page object for Debug UI E2E tests
import { Page, expect } from '@playwright/test';

/**
 * Base page object providing common Page Object Model methods
 * All Debug UI page objects should extend this class
 */
export class BasePage {
  constructor(readonly page: Page) {}

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<void> {
    await this.page.goto(url);
    await this.waitForLoad();
  }

  /**
   * Wait for page to finish loading
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Click an element
   */
  async click(selector: string, options?: { timeout?: number }): Promise<void> {
    await this.page.click(selector, { timeout: options?.timeout || 5000 });
  }

  /**
   * Fill an input field with text
   */
  async fill(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
  }

  /**
   * Get text content from an element
   */
  async getText(selector: string): Promise<string> {
    const element = this.page.locator(selector);
    await element.waitFor({ state: 'visible' });
    const text = await element.textContent();
    return text || '';
  }

  /**
   * Check if an element is visible
   */
  async isVisible(selector: string): Promise<boolean> {
    try {
      const element = this.page.locator(selector);
      await element.waitFor({ state: 'visible', timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for an element to be visible
   */
  async waitForElement(selector: string, timeout = 5000): Promise<void> {
    await this.page.waitForSelector(selector, { state: 'visible', timeout });
  }

  /**
   * Wait for an element to be hidden
   */
  async waitForHidden(selector: string, timeout = 5000): Promise<void> {
    await this.page.waitForSelector(selector, { state: 'hidden', timeout });
  }

  /**
   * Wait for WebSocket connection
   */
  async waitForWebSocket(timeout = 5000): Promise<void> {
    const indicator = this.page.locator('[data-testid="websocket-status"]');
    await indicator.waitFor({ state: 'visible', timeout });
    await expect(indicator).toHaveAttribute('data-status', 'connected', { timeout });
  }

  /**
   * Take a screenshot
   */
  async screenshot(name: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await this.page.screenshot({
      path: `test-results/${name}-${timestamp}.png`,
      fullPage: false,
    });
  }

  /**
   * Get a locator for an element
   */
  locator(selector: string) {
    return this.page.locator(selector);
  }

  /**
   * Assert that the page title contains text
   */
  async assertTitleContains(text: string): Promise<void> {
    await expect(this.page).toHaveTitle(new RegExp(text));
  }

  /**
   * Assert that the URL contains a path
   */
  async assertURLContains(path: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(path));
  }

  /**
   * Assert that an element is visible
   */
  async assertVisible(selector: string): Promise<void> {
    const element = this.page.locator(selector);
    await expect(element).toBeVisible();
  }

  /**
   * Assert that an element is hidden
   */
  async assertHidden(selector: string): Promise<void> {
    const element = this.page.locator(selector);
    await expect(element).toBeHidden();
  }

  /**
   * Assert that an element contains text
   */
  async assertText(selector: string, expectedText: string): Promise<void> {
    const element = this.page.locator(selector);
    await expect(element).toContainText(expectedText);
  }

  /**
   * Press a key on an element
   */
  async pressKey(selector: string, key: string): Promise<void> {
    await this.page.press(selector, key);
  }

  /**
   * Select an option from a dropdown
   */
  async selectOption(selector: string, value: string): Promise<void> {
    await this.page.selectOption(selector, value);
  }

  /**
   * Check a checkbox
   */
  async check(selector: string): Promise<void> {
    await this.page.check(selector);
  }

  /**
   * Uncheck a checkbox
   */
  async uncheck(selector: string): Promise<void> {
    await this.page.uncheck(selector);
  }

  /**
   * Wait for a specific timeout (use sparingly)
   */
  async wait(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
}
