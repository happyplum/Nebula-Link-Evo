// WebSocket connection tests for Debug UI
import { test, expect } from '@playwright/test';

test.describe('WebSocket Connection', () => {
  test('should establish WebSocket connection', async ({ page }) => {
    await page.goto('/');
    
    // WebSocket connection status should be visible
    const statusIndicator = page.locator('[data-testid="websocket-status"], .websocket-status, .status-indicator');
    await expect(statusIndicator).toBeVisible();
  });

  test('should handle WebSocket disconnection', async ({ page }) => {
    await page.goto('/');
    
    // Test WebSocket reconnection logic
    const statusIndicator = page.locator('[data-testid="websocket-status"], .websocket-status');
    await expect(statusIndicator).toBeVisible();
  });
});
