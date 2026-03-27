// History panel tests for Debug UI
import { test, expect } from '@playwright/test';

test.describe('History Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display history panel', async ({ page }) => {
    const historyPanel = page.locator('[data-testid="history-panel"], #history-panel');
    await expect(historyPanel).toBeVisible();
  });

  test('should display conversation list', async ({ page }) => {
    const conversationList = page.locator('[data-testid="conversation-list"], .conversations, .history-list');
    await expect(conversationList).toBeVisible();
  });

  test('should allow loading previous conversations', async ({ page }) => {
    const loadButton = page.locator('button:has-text("Load"), [data-action="load"]');
    await expect(loadButton.first()).toBeVisible();
  });
});
