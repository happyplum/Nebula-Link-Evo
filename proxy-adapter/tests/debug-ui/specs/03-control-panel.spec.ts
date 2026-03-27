// Control panel tests for Debug UI
import { test, expect } from '@playwright/test';
import { ControlPage } from '../page-objects/control-page.js';

test.describe('Control Panel', () => {
  let controlPage: ControlPage;

  test.beforeEach(async ({ page }) => {
    controlPage = new ControlPage(page);
    await controlPage.goto('/');
  });

  test('should display control panel', async ({ page }) => {
    const controlPanel = page.locator('[data-testid="control-panel"], #control-panel');
    await expect(controlPanel).toBeVisible();
  });

  test('should have start/stop buttons', async ({ page }) => {
    const startButton = page.locator('button:has-text("Start"), [data-action="start"]');
    const stopButton = page.locator('button:has-text("Stop"), [data-action="stop"]');
    await expect(startButton).toBeVisible();
    await expect(stopButton).toBeVisible();
  });
});
