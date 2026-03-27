// Page load tests for Debug UI
import { test, expect } from '@playwright/test';

test.describe('Page Load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the Debug UI page', async ({ page }) => {
    await expect(page).toHaveTitle(/Debug/);
  });

  test('should render main container', async ({ page }) => {
    const main = page.locator('main, #app, .container');
    await expect(main).toBeVisible();
  });
});
