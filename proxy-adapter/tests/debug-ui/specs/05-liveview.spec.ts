// LiveView panel tests for Debug UI
import { test, expect } from '@playwright/test';
import { LiveViewPage } from '../page-objects/liveview-page.js';

test.describe('LiveView Panel', () => {
  let liveViewPage: LiveViewPage;

  test.beforeEach(async ({ page }) => {
    liveViewPage = new LiveViewPage(page);
    await liveViewPage.goto('/');
  });

  test('should display LiveView panel', async ({ page }) => {
    const liveViewPanel = page.locator('[data-testid="liveview-panel"], #liveview-panel');
    await expect(liveViewPanel).toBeVisible();
  });

  test('should display browser preview', async ({ page }) => {
    const browserPreview = page.locator('[data-testid="browser-preview"], iframe, .preview-frame');
    await expect(browserPreview).toBeVisible();
  });
});
