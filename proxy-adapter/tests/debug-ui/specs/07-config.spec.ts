// Config panel tests for Debug UI
import { test, expect } from '@playwright/test';
import { ConfigPage } from '../page-objects/config-page.js';

test.describe('Config Panel', () => {
  let configPage: ConfigPage;

  test.beforeEach(async ({ page }) => {
    configPage = new ConfigPage(page);
    await configPage.goto('/');
  });

  test('should display config panel', async ({ page }) => {
    const configPanel = page.locator('[data-testid="config-panel"], #config-panel');
    await expect(configPanel).toBeVisible();
  });

  test('should display AI provider settings', async ({ page }) => {
    const providerSelect = page.locator('select, [data-testid="provider-select"]');
    await expect(providerSelect).toBeVisible();
  });

  test('should allow configuration changes', async ({ page }) => {
    const saveButton = page.locator('button:has-text("Save"), [data-action="save"]');
    await expect(saveButton).toBeVisible();
  });
});
