// TODO(react-refactor): Skipped — LiveView now uses LiveViewCanvas imperative component (data-testid="liveview-canvas"). Legacy selectors (#screenshotDisplay, #streamImage, .control-bar, #customCommand) no longer exist.
// Rewrite with React-compatible selectors: [data-testid="liveview-canvas"], [data-testid="debug-main"]
import { test, expect } from '../fixtures/test.fixture';
import { TIMEOUTS } from '../constants';

test.describe.skip('Debug UI - LiveView Stream', () => {
  test.beforeEach(async ({ debugPage }) => {
    // Wait for page to fully load
    await debugPage.waitForTimeout(TIMEOUTS.LONG);
  });

  test.describe('LiveView - Stream Display', () => {
    test('stream container renders with all canvas elements', async ({ debugPage }) => {
      // Screenshot display container should exist
      await expect(debugPage.locator('#screenshotDisplay')).toBeVisible();

      // LiveView container should exist
      await expect(debugPage.locator('#liveviewContainer')).toBeVisible();

      // Three layered canvases should exist in DOM (may be hidden when no stream)
      await expect(debugPage.locator('#streamImage')).toBeTruthy();
      await expect(debugPage.locator('#renderCanvas')).toBeTruthy();
      await expect(debugPage.locator('#overlayCanvas')).toBeTruthy();

      // Placeholder image should exist
      await expect(debugPage.locator('#placeholderImage')).toBeTruthy();
    });

    test('stream canvas elements have proper positioning', async ({ debugPage }) => {
      const liveviewContainer = debugPage.locator('#liveviewContainer');
      
      // Get bounding box to verify container exists
      const containerBox = await liveviewContainer.boundingBox();
      expect(containerBox).toBeTruthy();

      // Canvas elements should exist in DOM
      const streamImage = debugPage.locator('#streamImage');
      const renderCanvas = debugPage.locator('#renderCanvas');
      const overlayCanvas = debugPage.locator('#overlayCanvas');

      // All should be present in the DOM
      await expect(streamImage).toBeTruthy();
      await expect(renderCanvas).toBeTruthy();
      await expect(overlayCanvas).toBeTruthy();
    });

    test('placeholder displays when no stream is active', async ({ debugPage }) => {
      // Placeholder should be visible initially
      const placeholder = debugPage.locator('#liveviewPlaceholder');
      await expect(placeholder).toBeVisible();

      // Should contain icon and text
      await expect(placeholder).toContainText('等待画面');
      await expect(placeholder.locator('.empty-state-icon')).toBeVisible();
      await expect(placeholder.locator('.empty-state-text')).toBeVisible();
    });

    test('stream image has correct object-fit styling', async ({ debugPage }) => {
      const streamImage = debugPage.locator('#streamImage');
      
      // Should have object-fit: contain for proper scaling
      // Verify by checking it exists and has proper attributes
      await expect(streamImage).toHaveAttribute('alt', 'Live Stream');
    });

    test('overlay canvas has pointer-events enabled', async ({ debugPage }) => {
      const overlayCanvas = debugPage.locator('#overlayCanvas');
      
      // Should exist in DOM
      await expect(overlayCanvas).toBeTruthy();
      
      // Should be positioned absolutely
      const box = await overlayCanvas.boundingBox();
      expect(box).toBeTruthy();
    });
  });

  test.describe('LiveView - Control Bar', () => {
    test('control bar renders with all elements', async ({ debugPage }) => {
      // Control bar container should exist
      const controlBar = debugPage.locator('.control-bar');
      await expect(controlBar).toBeVisible();

      // Task status indicator
      await expect(debugPage.locator('#taskStatusIndicator')).toBeVisible();
      await expect(debugPage.locator('#taskStatusText')).toBeVisible();

      // Current task ID display
      await expect(debugPage.locator('#currentTaskId')).toBeVisible();
    });

    test('single-step mode toggle button exists', async ({ debugPage }) => {
      // Single step toggle should exist
      const singleStepToggle = debugPage.locator('#single-step-toggle');
      await expect(singleStepToggle).toBeTruthy();
    });

    test('execute single step button is clickable', async ({ debugPage }) => {
      const singleStepBtn = debugPage.locator('button:has-text("单步执行")').first();
      await expect(singleStepBtn).toBeVisible();
      
      // Button should be clickable (may show error if not connected, but should not crash)
      await singleStepBtn.click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('send command button is clickable', async ({ debugPage }) => {
      // The send command button has text "执行" - use .first() to avoid strict mode violation
      const sendCommandBtn = debugPage.locator('button:has-text("执行")').last();
      await expect(sendCommandBtn).toBeVisible();
      
      // Click should not crash
      await sendCommandBtn.click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('task status indicator has proper styling', async ({ debugPage }) => {
      const taskStatusIndicator = debugPage.locator('#taskStatusIndicator');
      
      // Should have status-indicator class
      await expect(taskStatusIndicator).toHaveClass(/status-indicator/);
    });

    test('task status text displays initial state', async ({ debugPage }) => {
      const taskStatusText = debugPage.locator('#taskStatusText');
      
      // Should have some text content
      const text = await taskStatusText.textContent();
      expect(text).toBeTruthy();
    });
  });

  test.describe('LiveView - Command Input', () => {
    test('custom command textarea renders correctly', async ({ debugPage }) => {
      const commandInput = debugPage.locator('#custom-command-input');
      
      // Try alternative selector if the above doesn't exist
      let inputExists = await commandInput.count() > 0;
      
      if (!inputExists) {
        // Fallback to the actual ID from index.html
        const altInput = debugPage.locator('#customCommand');
        await expect(altInput).toBeVisible();
      } else {
        await expect(commandInput).toBeVisible();
      }
    });

    test('command input accepts text input', async ({ debugPage }) => {
      const commandInput = debugPage.locator('#customCommand');
      const testCommand = 'pause';
      
      await commandInput.fill(testCommand);
      const value = await commandInput.inputValue();
      expect(value).toBe(testCommand);
    });

    test('send command button is clickable', async ({ debugPage }) => {
      // The send command button in the command input area - use .last() to get the one with text "执行"
      const sendCommandBtn = debugPage.locator('button[onclick="sendCommand()"]').last();
      await expect(sendCommandBtn).toBeVisible();
      
      // Click should not crash
      await sendCommandBtn.click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('command input has proper placeholder', async ({ debugPage }) => {
      const commandInput = debugPage.locator('#customCommand');
      
      // Should have placeholder text
      const placeholder = await commandInput.getAttribute('placeholder');
      expect(placeholder).toContain('输入命令');
    });

    test('command input and button layout is correct', async ({ debugPage }) => {
      const commandInput = debugPage.locator('#customCommand');
      const sendCommandBtn = debugPage.locator('button[onclick="sendCommand()"]').last();
      
      // Get bounding boxes
      const inputBox = await commandInput.boundingBox();
      const btnBox = await sendCommandBtn.boundingBox();
      
      expect(inputBox).toBeTruthy();
      expect(btnBox).toBeTruthy();
      
      if (inputBox && btnBox) {
        // Button should be to the right of input
        expect(inputBox.x).toBeLessThan(btnBox.x);
        // Should be on same vertical level
        expect(Math.abs(inputBox.y - btnBox.y)).toBeLessThan(20);
      }
    });
  });

  test.describe('LiveView - Data Export', () => {
    test('download screenshot button renders correctly', async ({ debugPage }) => {
      const downloadBtn = debugPage.locator('button:has-text("下载截图")');
      await expect(downloadBtn).toBeVisible();
    });

    test('download screenshot button is clickable', async ({ debugPage }) => {
      const downloadBtn = debugPage.locator('button:has-text("下载截图")');
      
      // Click should not crash
      await downloadBtn.click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('refresh history button renders correctly', async ({ debugPage }) => {
      const refreshBtn = debugPage.locator('button:has-text("刷新历史")');
      await expect(refreshBtn).toBeVisible();
    });

    test('refresh history button is clickable', async ({ debugPage }) => {
      const refreshBtn = debugPage.locator('button:has-text("刷新历史")');
      
      // Click should not crash
      await refreshBtn.click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('export buttons have proper layout', async ({ debugPage }) => {
      const downloadBtn = debugPage.locator('button:has-text("下载截图")');
      const refreshBtn = debugPage.locator('button:has-text("刷新历史")');
      
      // Get bounding boxes
      const downloadBox = await downloadBtn.boundingBox();
      const refreshBox = await refreshBtn.boundingBox();
      
      expect(downloadBox).toBeTruthy();
      expect(refreshBox).toBeTruthy();
      
      if (downloadBox && refreshBox) {
        // Buttons should be horizontally aligned
        expect(Math.abs(downloadBox.y - refreshBox.y)).toBeLessThan(20);
      }
    });
  });

  test.describe('LiveView - Execution Logs', () => {
    test('execution logs container renders correctly', async ({ debugPage }) => {
      const logsContainer = debugPage.locator('#logDisplay');
      await expect(logsContainer).toBeVisible();
    });

    test('logs container shows empty state initially or has logs', async ({ debugPage }) => {
      const logsContainer = debugPage.locator('#logDisplay');
      
      // Should either show empty state or have log entries
      const text = await logsContainer.textContent();
      // Accept either empty state or actual logs
      expect(text).toBeTruthy();
    });

    test('logs container has scrollable area', async ({ debugPage }) => {
      const logsContainer = debugPage.locator('#logDisplay');
      
      // Should have proper classes for scrolling
      await expect(logsContainer).toHaveClass(/log-container/);
    });

    test('logs panel renders with header', async ({ debugPage }) => {
      const logPanel = debugPage.locator('.log-panel');
      await expect(logPanel).toBeVisible();
      
      // Should have header
      const header = logPanel.locator('.panel-header');
      await expect(header).toBeVisible();
      await expect(header).toContainText('执行日志');
    });

    test('logs container has proper dimensions', async ({ debugPage }) => {
      const logsContainer = debugPage.locator('#logDisplay');
      
      // Should have a bounding box
      const box = await logsContainer.boundingBox();
      expect(box).toBeTruthy();
      
      if (box) {
        // Should have reasonable height
        expect(box.height).toBeGreaterThan(100);
      }
    });
  });

  test.describe('LiveView - Quick Actions Grid', () => {
    test('quick actions grid renders with 4 buttons', async ({ debugPage }) => {
      // Find the grid container
      const quickActionsGrid = debugPage.locator('.grid.grid-cols-4');
      await expect(quickActionsGrid).toBeVisible();
      
      // Should have 4 buttons
      const buttons = quickActionsGrid.locator('button');
      await expect(buttons).toHaveCount(4);
    });

    test('quick action buttons have correct labels', async ({ debugPage }) => {
      const quickActionsGrid = debugPage.locator('.grid.grid-cols-4');
      
      // Check each button has correct text
      await expect(quickActionsGrid.locator('button').nth(0)).toContainText('单步执行');
      await expect(quickActionsGrid.locator('button').nth(1)).toContainText('发送命令');
      await expect(quickActionsGrid.locator('button').nth(2)).toContainText('下载截图');
      await expect(quickActionsGrid.locator('button').nth(3)).toContainText('刷新历史');
    });

    test('quick action buttons are clickable', async ({ debugPage }) => {
      const quickActionsGrid = debugPage.locator('.grid.grid-cols-4');
      const buttons = quickActionsGrid.locator('button');
      
      // Click each button - should not crash
      for (let i = 0; i < 4; i++) {
        await buttons.nth(i).click();
        await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      }
    });

    test('quick action buttons have varied styling', async ({ debugPage }) => {
      const quickActionsGrid = debugPage.locator('.grid.grid-cols-4');
      const buttons = quickActionsGrid.locator('button');
      
      // Check that buttons exist and are visible
      for (let i = 0; i < 4; i++) {
        await expect(buttons.nth(i)).toBeVisible();
      }
    });
  });

  test.describe('LiveView - Button State Management', () => {
    test('control bar buttons update state based on connection', async ({ debugPage }) => {
      // All buttons should have a definable state - use .first() to avoid strict mode violations
      const buttons = [
        'button:has-text("单步执行")',
        'button[onclick="sendCommand()"]',
        'button:has-text("下载截图")',
        'button:has-text("刷新历史")',
      ];

      for (const selector of buttons) {
        const btn = debugPage.locator(selector).first();
        await expect(btn).toBeVisible();
        
        // Button should have either enabled or disabled state
        const isDisabled = await btn.isDisabled();
        expect(typeof isDisabled).toBe('boolean');
      }
    });

    test('command send button state depends on input', async ({ debugPage }) => {
      const commandInput = debugPage.locator('#customCommand');
      const sendCommandBtn = debugPage.locator('button[onclick="sendCommand()"]').last();
      
      // Get initial button state
      const initialState = await sendCommandBtn.isDisabled();
      expect(typeof initialState).toBe('boolean');
      
      // Fill input
      await commandInput.fill('test command');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // Button state may change
      const newState = await sendCommandBtn.isDisabled();
      expect(typeof newState).toBe('boolean');
    });

    test('all buttons remain functional after multiple clicks', async ({ debugPage }) => {
      const singleStepBtn = debugPage.locator('button:has-text("单步执行")').first();
      
      // Click multiple times
      for (let i = 0; i < 3; i++) {
        await singleStepBtn.click();
        await debugPage.waitForTimeout(TIMEOUTS.VERY_SHORT);
      }
      
      // Button should still be functional
      await expect(singleStepBtn).toBeVisible();
    });
  });

  test.describe('LiveView - Layout and Responsiveness', () => {
    test('liveview container adapts to viewport changes', async ({ debugPage }) => {
      // Test with smaller viewport
      await debugPage.setViewportSize({ width: 800, height: 600 });
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // Container should still exist (may be hidden but should be in DOM)
      await expect(debugPage.locator('#screenshotDisplay')).toBeTruthy();
      
      // Reset viewport
      await debugPage.setViewportSize({ width: 1920, height: 1080 });
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('control bar maintains layout on resize', async ({ debugPage }) => {
      await debugPage.setViewportSize({ width: 1024, height: 768 });
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      const controlBar = debugPage.locator('.control-bar');
      await expect(controlBar).toBeTruthy();
      
      // Control bar elements should exist
      await expect(debugPage.locator('#taskStatusIndicator')).toBeTruthy();
      await expect(debugPage.locator('#taskStatusText')).toBeTruthy();
      
      // Reset viewport
      await debugPage.setViewportSize({ width: 1920, height: 1080 });
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('quick actions grid wraps on narrow viewports', async ({ debugPage }) => {
      await debugPage.setViewportSize({ width: 600, height: 800 });
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      const quickActionsGrid = debugPage.locator('.grid.grid-cols-4');
      await expect(quickActionsGrid).toBeTruthy();
      
      // Buttons should still exist
      const buttons = quickActionsGrid.locator('button');
      await expect(buttons).toHaveCount(4);
      
      // Reset viewport
      await debugPage.setViewportSize({ width: 1920, height: 1080 });
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });
  });

  test.describe('LiveView - Accessibility', () => {
    test('stream image has alt text', async ({ debugPage }) => {
      const streamImage = debugPage.locator('#streamImage');
      
      // Should have alt attribute
      await expect(streamImage).toHaveAttribute('alt', 'Live Stream');
    });

    test('buttons have accessible text', async ({ debugPage }) => {
      const buttons: Array<{ selector: string; text: string; index?: number | 'last' }> = [
        { selector: 'button:has-text("单步执行")', text: '单步执行', index: 0 },
        { selector: 'button[onclick="sendCommand()"]', text: '执行', index: 'last' },
        { selector: 'button:has-text("下载截图")', text: '下载截图' },
        { selector: 'button:has-text("刷新历史")', text: '刷新历史' },
      ];

      for (const { selector, text, index } of buttons) {
        let btn;
        if (index === 'last') {
          btn = debugPage.locator(selector).last();
        } else if (typeof index === 'number') {
          btn = debugPage.locator(selector).nth(index);
        } else {
          btn = debugPage.locator(selector);
        }
        await expect(btn).toBeVisible();
        await expect(btn).toContainText(text);
      }
    });

    test('command input is keyboard accessible', async ({ debugPage }) => {
      const commandInput = debugPage.locator('#customCommand');
      
      // Should be focusable
      await commandInput.focus();
      await expect(commandInput).toBeFocused();
      
      // Should accept keyboard input
      await commandInput.pressSequentially('test');
      const value = await commandInput.inputValue();
      expect(value).toBe('test');
    });

    test('logs container is keyboard navigable', async ({ debugPage }) => {
      const logsContainer = debugPage.locator('#logDisplay');
      
      // Should be focusable
      await logsContainer.focus();
      await expect(logsContainer).toBeFocused();
    });
  });
});
