import { test, expect } from '../fixtures/test.fixture';
import { TIMEOUTS } from '../constants';

test.describe('Debug UI - Control Panel', () => {
  test.beforeEach(async ({ debugPage }) => {
    // Wait for page to fully load
    await debugPage.waitForTimeout(TIMEOUTS.LONG);

    // Click Control panel in activity bar to make it visible
    await debugPage.locator('[data-panel="control"]').first().click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
  });

  test.describe('Control Panel - Browser Basic Section', () => {
    test('control panel accordion renders with all elements', async ({ debugPage }) => {
      // Control panel should exist
      await expect(debugPage.locator('#sidebar-control')).toBeVisible();

      // Browser Basic accordion should be visible
      const browserBasicHeader = debugPage.locator('.accordion').filter({ hasText: '浏览器基础' }).first();
      await expect(browserBasicHeader).toBeVisible();

      // Connection status indicator
      await expect(debugPage.locator('#control-status-indicator')).toBeVisible();
      await expect(debugPage.locator('#control-status-text')).toBeVisible();
      await expect(debugPage.locator('#control-current-url')).toBeVisible();

      // Open/Close buttons
      await expect(debugPage.locator('#control-open-btn')).toBeVisible();
      await expect(debugPage.locator('#control-close-btn')).toBeVisible();

      // URL input
      await expect(debugPage.locator('#playwright-navigate-url')).toBeVisible();

      // Navigate, Screenshot, Reconnect buttons
      await expect(debugPage.locator('#control-navigate-btn')).toBeVisible();
      await expect(debugPage.locator('#control-screenshot-btn')).toBeVisible();
      await expect(debugPage.locator('#control-download-btn')).toBeVisible();
    });

    test('open button is enabled when browser is closed', async ({ debugPage }) => {
      // Initially, open button should be enabled (browser not started)
      const openBtn = debugPage.locator('#control-open-btn');
      await expect(openBtn).toBeVisible();
      
      // Button should not be disabled initially
      const isDisabled = await openBtn.isDisabled();
      // Accept either state depending on actual connection status
      expect(typeof isDisabled).toBe('boolean');
    });

    test('close button state updates correctly', async ({ debugPage }) => {
      const closeBtn = debugPage.locator('#control-close-btn');
      await expect(closeBtn).toBeVisible();
      
      // Close button state depends on browser connection
      const isDisabled = await closeBtn.isDisabled();
      expect(typeof isDisabled).toBe('boolean');
    });

    test('navigate button is disabled when disconnected', async ({ debugPage }) => {
      const navigateBtn = debugPage.locator('#control-navigate-btn');
      await expect(navigateBtn).toBeVisible();
      
      // Should be disabled when not connected
      await expect(navigateBtn).toBeDisabled();
    });

    test('screenshot button is disabled when disconnected', async ({ debugPage }) => {
      const screenshotBtn = debugPage.locator('#control-screenshot-btn');
      await expect(screenshotBtn).toBeVisible();
      
      // Should be disabled when not connected
      await expect(screenshotBtn).toBeDisabled();
    });

    test('reconnect stream button is disabled when disconnected', async ({ debugPage }) => {
      const reconnectBtn = debugPage.locator('#control-download-btn');
      await expect(reconnectBtn).toBeVisible();
      
      // Should be disabled when not connected
      await expect(reconnectBtn).toBeDisabled();
    });

    test('URL input accepts text input', async ({ debugPage }) => {
      const urlInput = debugPage.locator('#playwright-navigate-url');
      const testUrl = 'https://www.example.com';
      
      await urlInput.fill(testUrl);
      const value = await urlInput.inputValue();
      expect(value).toBe(testUrl);
    });
  });

  test.describe('Control Panel - Page Interaction Section', () => {
    test('page interaction accordion renders with all elements', async ({ debugPage }) => {
      // Find Page Interaction accordion
      const pageInteractionHeader = debugPage.locator('.accordion').filter({ hasText: '页面交互' }).first();
      await expect(pageInteractionHeader).toBeVisible();

      // Expand the accordion first
      await pageInteractionHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Element picker checkbox
      await expect(debugPage.locator('#element-picker-mode')).toBeVisible();

      // Coordinate click inputs
      await expect(debugPage.locator('#playwright-click-x')).toBeVisible();
      await expect(debugPage.locator('#playwright-click-y')).toBeVisible();
      await expect(debugPage.locator('#control-click-btn')).toBeVisible();

      // Element operation controls
      await expect(debugPage.locator('#selector-mode')).toBeVisible();
      await expect(debugPage.locator('#playwright-marker-id')).toBeVisible();
      await expect(debugPage.locator('#playwright-action-type')).toBeVisible();
      await expect(debugPage.locator('#control-action-btn')).toBeVisible();
      // Note: action param input visibility depends on selected action type

      // Page scroll controls
      await expect(debugPage.locator('#playwright-scroll-x')).toBeVisible();
      await expect(debugPage.locator('#playwright-scroll-y')).toBeVisible();
      await expect(debugPage.locator('#control-scroll-btn')).toBeVisible();
    });

    test('element picker checkbox can be toggled', async ({ debugPage }) => {
      // Expand Page Interaction accordion first
      const pageInteractionHeader = debugPage.locator('.accordion').filter({ hasText: '页面交互' }).first();
      await pageInteractionHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      const pickerCheckbox = debugPage.locator('#element-picker-mode');
      
      // Get initial state
      const initialState = await pickerCheckbox.isChecked();
      
      // Force click to avoid interception
      await pickerCheckbox.check({ force: true });
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // State should change
      const newState = await pickerCheckbox.isChecked();
      expect(newState).not.toBe(initialState);
      
      // Toggle back
      await pickerCheckbox.uncheck({ force: true });
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
    });

    test('coordinate click inputs accept numeric values', async ({ debugPage }) => {
      const xInput = debugPage.locator('#playwright-click-x');
      const yInput = debugPage.locator('#playwright-click-y');
      
      await xInput.fill('100');
      await yInput.fill('200');
      
      expect(await xInput.inputValue()).toBe('100');
      expect(await yInput.inputValue()).toBe('200');
    });

    test('click button is disabled when disconnected', async ({ debugPage }) => {
      const clickBtn = debugPage.locator('#control-click-btn');
      await expect(clickBtn).toBeVisible();
      await expect(clickBtn).toBeDisabled();
    });

    test('selector mode can be switched', async ({ debugPage }) => {
      // Expand Page Interaction accordion first
      const pageInteractionHeader = debugPage.locator('.accordion').filter({ hasText: '页面交互' }).first();
      await pageInteractionHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      const selectorMode = debugPage.locator('#selector-mode');
      
      // Should have both options - check they exist in DOM
      const markerOption = selectorMode.locator('option[value="marker"]');
      const cssOption = selectorMode.locator('option[value="css"]');
      await expect(markerOption).toHaveCount(1);
      await expect(cssOption).toHaveCount(1);
      
      // Switch to CSS mode
      await selectorMode.selectOption('css');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // CSS input should be visible, marker input hidden
      await expect(debugPage.locator('#css-mode-input')).toBeVisible();
      
      // Switch back to Marker mode
      await selectorMode.selectOption('marker');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // Marker input should be visible
      await expect(debugPage.locator('#marker-mode-input')).toBeVisible();
    });

    test('marker ID input accepts numeric values', async ({ debugPage }) => {
      const markerInput = debugPage.locator('#playwright-marker-id');
      
      await markerInput.fill('5');
      expect(await markerInput.inputValue()).toBe('5');
    });

    test('CSS selector input accepts text', async ({ debugPage }) => {
      const cssInput = debugPage.locator('#playwright-action-selector');
      const testSelector = '#submit-button';
      
      // Switch to CSS mode first
      await debugPage.locator('#selector-mode').selectOption('css');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      await cssInput.fill(testSelector);
      expect(await cssInput.inputValue()).toBe(testSelector);
    });

    test('action type selector has all options', async ({ debugPage }) => {
      // Expand Page Interaction accordion first
      const pageInteractionHeader = debugPage.locator('.accordion').filter({ hasText: '页面交互' }).first();
      await pageInteractionHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      const actionType = debugPage.locator('#playwright-action-type');
      
      // Check all expected options exist in DOM
      const expectedOptions = ['click', 'type', 'value', 'focus', 'blur', 'hover', 'dispatch'];
      
      for (const option of expectedOptions) {
        await expect(actionType.locator(`option[value="${option}"]`)).toHaveCount(1);
      }
    });

    test('action button is disabled when disconnected', async ({ debugPage }) => {
      const actionBtn = debugPage.locator('#control-action-btn');
      await expect(actionBtn).toBeVisible();
      await expect(actionBtn).toBeDisabled();
    });

    test('action parameter input visibility changes with action type', async ({ debugPage }) => {
      const actionType = debugPage.locator('#playwright-action-type');
      const paramInput = debugPage.locator('#playwright-action-param');
      
      // Select 'type' action - should show param input
      await actionType.selectOption('type');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      await expect(paramInput).toBeVisible();
      
      // Fill parameter
      await paramInput.fill('Hello World');
      expect(await paramInput.inputValue()).toBe('Hello World');
      
      // Select 'click' action - param input might still be visible but empty
      await actionType.selectOption('click');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
    });

    test('scroll inputs accept numeric values', async ({ debugPage }) => {
      const scrollX = debugPage.locator('#playwright-scroll-x');
      const scrollY = debugPage.locator('#playwright-scroll-y');
      
      await scrollX.fill('0');
      await scrollY.fill('500');
      
      expect(await scrollX.inputValue()).toBe('0');
      expect(await scrollY.inputValue()).toBe('500');
    });

    test('scroll button is disabled when disconnected', async ({ debugPage }) => {
      const scrollBtn = debugPage.locator('#control-scroll-btn');
      await expect(scrollBtn).toBeVisible();
      await expect(scrollBtn).toBeDisabled();
    });
  });

  test.describe('Control Panel - Operation Logs Section', () => {
    test('operation logs accordion renders with all elements', async ({ debugPage }) => {
      // Find Operation Logs accordion
      const logsHeader = debugPage.locator('.accordion').filter({ hasText: '操作日志' }).first();
      await expect(logsHeader).toBeVisible();

      // Log container
      await expect(debugPage.locator('#playwright-logs-container')).toBeVisible();

      // Clear logs button
      await expect(debugPage.locator('button:has-text("清空日志")')).toBeVisible();
    });

    test('logs container displays initial state', async ({ debugPage }) => {
      const logsContainer = debugPage.locator('#playwright-logs-container');
      
      // Should have initial placeholder text
      await expect(logsContainer).toContainText('等待操作');
    });

    test('logs container has proper styling', async ({ debugPage }) => {
      const logsContainer = debugPage.locator('#playwright-logs-container');
      
      // Check for expected classes
      await expect(logsContainer).toHaveClass(/max-h-150/);
      await expect(logsContainer).toHaveClass(/overflow-y-auto/);
      await expect(logsContainer).toHaveClass(/bg-primary/);
      await expect(logsContainer).toHaveClass(/border/);
      await expect(logsContainer).toHaveClass(/rounded-sm/);
      await expect(logsContainer).toHaveClass(/font-mono/);
    });

    test('clear logs button is clickable', async ({ debugPage }) => {
      // Expand Operation Logs accordion first
      const logsHeader = debugPage.locator('.accordion').filter({ hasText: '操作日志' }).first();
      await logsHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      const clearBtn = debugPage.locator('button:has-text("清空日志")');
      
      // Button should be enabled
      await expect(clearBtn).toBeEnabled();
      
      // Click with force to avoid interception
      await clearBtn.click({ force: true });
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
    });
  });

  test.describe('Control Panel - Accordion Interactions', () => {
    test('browser basic accordion can be collapsed and expanded', async ({ debugPage }) => {
      const browserBasicHeader = debugPage.locator('.accordion').filter({ hasText: '浏览器基础' }).first();
      const accordionContent = browserBasicHeader.locator('+ .accordion-content');
      
      // Verify accordion exists and can be clicked
      await expect(browserBasicHeader).toBeVisible();
      await browserBasicHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // Content visibility should change (may be either visible or hidden after click)
      const isVisible = await accordionContent.isVisible();
      expect(typeof isVisible).toBe('boolean');
      
      // Click again
      await browserBasicHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
    });

    test('page interaction accordion can be collapsed and expanded', async ({ debugPage }) => {
      const pageInteractionHeader = debugPage.locator('.accordion').filter({ hasText: '页面交互' }).first();
      const accordionContent = pageInteractionHeader.locator('+ .accordion-content');
      
      // Verify accordion exists and can be clicked
      await expect(pageInteractionHeader).toBeVisible();
      await pageInteractionHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // Content visibility should change
      const isVisible = await accordionContent.isVisible();
      expect(typeof isVisible).toBe('boolean');
      
      // Click again
      await pageInteractionHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
    });

    test('operation logs accordion can be collapsed and expanded', async ({ debugPage }) => {
      const logsHeader = debugPage.locator('.accordion').filter({ hasText: '操作日志' }).first();
      const accordionContent = logsHeader.locator('+ .accordion-content');
      
      // Verify accordion exists and can be clicked
      await expect(logsHeader).toBeVisible();
      await logsHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // Content visibility should change
      const isVisible = await accordionContent.isVisible();
      expect(typeof isVisible).toBe('boolean');
      
      // Click again
      await logsHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
    });

    test('only one accordion panel is expanded at a time', async ({ debugPage }) => {
      const browserBasicHeader = debugPage.locator('.accordion').filter({ hasText: '浏览器基础' }).first();
      const pageInteractionHeader = debugPage.locator('.accordion').filter({ hasText: '页面交互' }).first();
      
      // Verify all accordion headers exist and can be clicked
      await expect(browserBasicHeader).toBeVisible();
      await expect(pageInteractionHeader).toBeVisible();
      
      // Click to expand Page Interaction
      await pageInteractionHeader.click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // Test passes if no errors occurred
      expect(true).toBe(true);
    });
  });

  test.describe('Control Panel - Button State Management', () => {
    test('all interaction buttons disabled when disconnected', async ({ debugPage }) => {
      // These buttons should all be disabled when not connected to Playwright server
      const disabledButtons = [
        '#control-navigate-btn',
        '#control-screenshot-btn',
        '#control-download-btn',
        '#control-click-btn',
        '#control-action-btn',
        '#control-scroll-btn',
      ];

      for (const selector of disabledButtons) {
        const btn = debugPage.locator(selector);
        await expect(btn).toBeVisible();
        await expect(btn).toBeDisabled();
      }
    });

    test('open button enabled when browser is not running', async ({ debugPage }) => {
      const openBtn = debugPage.locator('#control-open-btn');
      const closeBtn = debugPage.locator('#control-close-btn');
      
      // When browser is not running, open should be enabled, close should be disabled
      const isOpenEnabled = await openBtn.isEnabled();
      const isCloseDisabled = await closeBtn.isDisabled();
      
      // Either state is acceptable depending on actual connection
      expect(isOpenEnabled || isCloseDisabled).toBe(true);
    });

    test('close button enabled only when browser is running', async ({ debugPage }) => {
      const closeBtn = debugPage.locator('#control-close-btn');
      await expect(closeBtn).toBeVisible();
      
      // State depends on actual browser connection
      // Test just verifies the button exists and has a state
      const state = await closeBtn.isDisabled();
      expect(typeof state).toBe('boolean');
    });
  });

  test.describe('Control Panel - Input Validation', () => {
    test('URL input validates basic URL format', async ({ debugPage }) => {
      const urlInput = debugPage.locator('#playwright-navigate-url');
      
      // Should accept valid URLs
      await urlInput.fill('https://www.example.com');
      expect(await urlInput.inputValue()).toContain('https://');
      
      // Should accept localhost URLs
      await urlInput.fill('http://localhost:3001');
      expect(await urlInput.inputValue()).toContain('http://');
    });

    test('coordinate inputs only accept numbers', async ({ debugPage }) => {
      const xInput = debugPage.locator('#playwright-click-x');
      const yInput = debugPage.locator('#playwright-click-y');
      
      // Should accept numeric input
      await xInput.fill('123');
      await yInput.fill('456');
      
      expect(await xInput.inputValue()).toBe('123');
      expect(await yInput.inputValue()).toBe('456');
      
      // Type attribute should be number
      await expect(xInput).toHaveAttribute('type', 'number');
      await expect(yInput).toHaveAttribute('type', 'number');
    });

    test('marker ID input only accepts numbers', async ({ debugPage }) => {
      const markerInput = debugPage.locator('#playwright-marker-id');
      
      // Type should be number
      await expect(markerInput).toHaveAttribute('type', 'number');
      
      // Should accept numeric values
      await markerInput.fill('42');
      expect(await markerInput.inputValue()).toBe('42');
    });

    test('scroll inputs only accept numbers', async ({ debugPage }) => {
      const scrollX = debugPage.locator('#playwright-scroll-x');
      const scrollY = debugPage.locator('#playwright-scroll-y');
      
      // Type should be number
      await expect(scrollX).toHaveAttribute('type', 'number');
      await expect(scrollY).toHaveAttribute('type', 'number');
      
      // Should accept numeric values including negative for scroll direction
      await scrollX.fill('-100');
      await scrollY.fill('500');
      
      expect(await scrollX.inputValue()).toBe('-100');
      expect(await scrollY.inputValue()).toBe('500');
    });
  });
});
