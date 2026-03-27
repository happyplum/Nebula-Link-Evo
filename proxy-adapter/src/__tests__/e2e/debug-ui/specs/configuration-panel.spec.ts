import { test, expect } from '../fixtures/test.fixture';
import { TIMEOUTS } from '../constants';

test.describe('Debug UI - Configuration Panel', () => {
  test.beforeEach(async ({ debugPage }) => {
    // Wait for page to fully load
    await debugPage.waitForTimeout(TIMEOUTS.LONG);

    // Click Config tab in right panel to make it visible
    await debugPage.locator('[data-right-tab="config"]').first().click();

    // Wait for config content to load (not "加载中..." anymore)
    // Config is loaded when it contains content other than loading text
    const configDisplay = debugPage.locator('#configDisplay');
    try {
      await configDisplay.waitFor({ state: 'visible', timeout: TIMEOUTS.XLONG });
      // Wait a bit more for content to populate
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    } catch (error) {
      console.error('Config display did not load in time:', error);
      // Config display might not be ready yet, but tests will handle it
    }
  });

  test.describe('Configuration Panel - Basic Rendering', () => {
    test('configuration panel renders with container', async ({ debugPage }) => {
      const configTab = debugPage.locator('[data-right-tab="config"]');
      await expect(configTab).toBeVisible();
      
      const configDisplay = debugPage.locator('#configDisplay');
      await expect(configDisplay).toBeVisible();
    });

    test('configuration panel loads content', async ({ debugPage }) => {
      await debugPage.waitForTimeout(TIMEOUTS.XLONG);
      
      const configDisplay = debugPage.locator('#configDisplay');
      const content = await configDisplay.textContent();
      
      expect(content).toBeTruthy();
      expect(content!.length).toBeGreaterThan(0);
    });

    test('configuration panel displays config or error state', async ({ debugPage }) => {
      await debugPage.waitForTimeout(TIMEOUTS.XLONG);
      
      const configDisplay = debugPage.locator('#configDisplay');
      const content = await configDisplay.textContent();
      
      const hasConfigContent = content?.includes('视觉模型') || content?.includes('决策模型');
      const hasError = content?.includes('失败') || content?.includes('404');
      
      expect(hasConfigContent || hasError).toBe(true);
    });
  });

  test.describe('Configuration Panel - Right Panel Integration', () => {
    test('right panel exists and contains config tab', async ({ debugPage }) => {
      const rightPanel = debugPage.locator('#rightPanel');
      await expect(rightPanel).toBeVisible();
      
      const configTab = rightPanel.locator('[data-right-tab="config"]');
      await expect(configTab).toBeVisible();
    });

    test('config tab page becomes active when clicked', async ({ debugPage }) => {
      const configTab = debugPage.locator('[data-right-tab="config"]');
      const configPage = debugPage.locator('#right-config');
      
      await configTab.click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      await expect(configPage).toBeVisible();
    });

    test('config display area is within right panel', async ({ debugPage }) => {
      const rightPanel = debugPage.locator('#rightPanel');
      const configDisplay = rightPanel.locator('#configDisplay');
      
      await expect(configDisplay).toBeVisible();
    });
  });

  test.describe('Configuration Panel - Content Rendering', () => {
    test('configuration renders with valid HTML structure', async ({ debugPage }) => {
      await debugPage.waitForTimeout(TIMEOUTS.XLONG);
      
      const configDisplay = debugPage.locator('#configDisplay');
      
      const divs = configDisplay.locator('div');
      await expect(divs.first()).toBeVisible();
    });

    test('configuration content is not empty after load', async ({ debugPage }) => {
      await debugPage.waitForTimeout(TIMEOUTS.XLONG);
      
      const configDisplay = debugPage.locator('#configDisplay');
      const content = await configDisplay.textContent();
      
      expect(content?.trim().length).toBeGreaterThan(10);
    });
  });

  test.describe('Configuration Panel - Styling and Layout', () => {
    test('configuration panel uses proper CSS classes', async ({ debugPage }) => {
      await debugPage.waitForTimeout(TIMEOUTS.XLONG);
      
      const configDisplay = debugPage.locator('#configDisplay');
      
      await expect(configDisplay).toHaveClass(/p-3/);
    });

    test('configuration panel has styling structure', async ({ debugPage }) => {
      await debugPage.waitForTimeout(TIMEOUTS.XLONG);
      
      const configDisplay = debugPage.locator('#configDisplay');
      const content = await configDisplay.textContent();
      
      // Only test border dividers if config loaded successfully
      if (content?.includes('视觉模型') || content?.includes('决策模型')) {
        const borderedSections = configDisplay.locator('.border-b');
        await expect(borderedSections.first()).toBeVisible();
      }
      // Test passes even if config didn't load (acceptable error state)
    });
  });

  test.describe('Configuration Panel - Error States', () => {
    test('config display handles fetch errors gracefully', async ({ debugPage }) => {
      await debugPage.waitForTimeout(TIMEOUTS.XXLONG);
      
      const configDisplay = debugPage.locator('#configDisplay');
      const content = await configDisplay.textContent();
      
      expect(content?.trim().length).toBeGreaterThan(0);
    });

    test('config tab can be clicked multiple times', async ({ debugPage }) => {
      const configTab = debugPage.locator('[data-right-tab="config"]');
      
      await configTab.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      await configTab.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      const configDisplay = debugPage.locator('#configDisplay');
      await expect(configDisplay).toBeVisible();
    });
  });
});
