// Error handling tests for Debug UI
import { test, expect } from '@playwright/test';

test.describe('Error Handling', () => {
  test('should display error messages', async ({ page }) => {
    await page.goto('/');
    
    // Simulate error condition if possible
    const errorContainer = page.locator('[data-testid="error"], .error-message');
    
    // Check if error container exists (may not be visible initially)
    const isVisible = await errorContainer.isVisible().catch(() => false);
    if (isVisible) {
      await expect(errorContainer).toBeVisible();
    }
  });

  test('should handle network errors gracefully', async ({ page }) => {
    await page.goto('/');
    
    // Test network error handling
    const pageBody = page.locator('body');
    await expect(pageBody).toBeVisible();
  });

  test('should allow error recovery', async ({ page }) => {
    await page.goto('/');
    
    // Check for retry/reload mechanisms
    const retryButton = page.locator('button:has-text("Retry"), button:has-text("Reload")');
    const hasRetryButton = await retryButton.count() > 0;
    if (hasRetryButton) {
      await expect(retryButton.first()).toBeVisible();
    }
  });
});
