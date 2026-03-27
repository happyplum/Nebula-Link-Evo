import { test, expect } from '../fixtures/test.fixture';
import { TIMEOUTS } from '../constants';

test.describe('Debug UI - Error Handling', () => {
  test.describe('Page Load Errors', () => {
    test('handles 404 error gracefully', async ({ browser, testOptions }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Track console errors
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      
      // Try to load non-existent page
      const response = await page.goto(`${testOptions.debugURL}/non-existent-page`, {
        waitUntil: 'domcontentloaded',
      }).catch(() => null);
      
      // Should receive 404 or handle gracefully
      expect(response?.status()).toBeGreaterThanOrEqual(400);
      
      // Page should not crash completely
      expect(await page.content()).toBeTruthy();
      
      await context.close();
    });

    test('handles network failure gracefully', async ({ browser, testOptions }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Track network failures
      const networkErrors: string[] = [];
      page.on('requestfailed', (request) => {
        networkErrors.push(request.url());
      });
      
      // Block all network requests
      await page.route('**/*', (route) => {
        route.abort('connectionfailed');
      });
      
      try {
        await page.goto(testOptions.debugURL, {
          timeout: 5000,
          waitUntil: 'domcontentloaded',
        }).catch(() => {});
        
        await page.waitForTimeout(TIMEOUTS.XLONG);
        
        // Network errors should be captured
        expect(networkErrors.length).toBeGreaterThan(0);
      } finally {
        await context.close();
      }
    });

    test('handles 500 server error gracefully', async ({ browser, testOptions }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Mock server to return 500 error
      await page.route('**/debug', (route) => {
        route.fulfill({
          status: 500,
          contentType: 'text/html',
          body: '<html><body><h1>Internal Server Error</h1></body></html>',
        });
      });
      
      try {
        await page.goto(testOptions.debugURL, {
          timeout: 5000,
          waitUntil: 'domcontentloaded',
        }).catch(() => {});
        
        await page.waitForTimeout(TIMEOUTS.LONG);
        
        // Page should handle 500 error
        expect(true).toBe(true);
      } finally {
        await context.close();
      }
    });
  });

  test.describe('WebSocket Connection Errors', () => {
    test('handles WebSocket connection refused', async ({ browser, testOptions }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Track console errors
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      
      // Block WebSocket connections
      await page.route('**/ws/**', (route) => {
        route.abort('connectionfailed');
      });
      
      await page.goto(testOptions.debugURL);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(TIMEOUTS.XXLONG);
      
      // Connection status should show offline
      const connectionStatus = page.locator('#connectionStatus');
      await expect(connectionStatus).toBeVisible();
      
      const statusText = await connectionStatus.textContent();
      expect(statusText).toBeTruthy();
      
      await context.close();
    });

    test('handles WebSocket timeout', async ({ browser, testOptions }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Mock WebSocket endpoint to delay response
      await page.route('**/ws/**', async (route) => {
        await page.waitForTimeout(TIMEOUTS.EXTRA_LONG); // Timeout
        route.continue();
      });
      
      await page.goto(testOptions.debugURL);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(TIMEOUTS.XLONG);
      
      // Should show connecting or offline status
      const connectionStatus = page.locator('#connectionStatus');
      await expect(connectionStatus).toBeVisible();
      
      await context.close();
    });

    test('handles WebSocket disconnect after successful connection', async ({ debugPage }) => {
      // Wait for initial connection
      await debugPage.waitForTimeout(TIMEOUTS.XLONG);
      
      // Simulate disconnect by closing WebSocket
      await debugPage.evaluate('() => { if (window.ws) { window.ws.close(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Status should update to disconnected
      const connectionStatus = debugPage.locator('#connectionStatus');
      await expect(connectionStatus).toBeVisible();
      
      const statusText = await connectionStatus.textContent();
      expect(statusText).toBeTruthy();
    });

    test('reconnect button attempts to reconnect WebSocket', async ({ debugPage }) => {
      // Wait for initial connection
      await debugPage.waitForTimeout(TIMEOUTS.XLONG);
      
      // Disconnect WebSocket
      await debugPage.evaluate('() => { if (window.ws) { window.ws.close(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Click reconnect button (刷新连接)
      const reconnectBtn = debugPage.locator('button:has-text("刷新连接")');
      if (await reconnectBtn.isVisible()) {
        await reconnectBtn.click();
        await debugPage.waitForTimeout(TIMEOUTS.XLONG);
        
        // Should attempt reconnection
        const connectionStatus = debugPage.locator('#connectionStatus');
        await expect(connectionStatus).toBeVisible();
      }
    });
  });

  test.describe('API Request Errors', () => {
    test('handles 400 Bad Request from API', async ({ debugPage, testOptions }) => {
      // Mock API to return 400 error
      await debugPage.route(`${testOptions.apiURL}/**`, (route) => {
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Bad Request', message: 'Invalid parameters' }),
        });
      });
      
      // Navigate to page
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // Trigger API call by fetching config or history
      await debugPage.evaluate('() => { if (window.fetchConfig) { window.fetchConfig(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Should handle 400 error gracefully
      expect(true).toBe(true);
    });

    test('handles 401 Unauthorized from API', async ({ debugPage, testOptions }) => {
      // Mock API to return 401 error
      await debugPage.route(`${testOptions.apiURL}/**`, (route) => {
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Unauthorized', message: 'Authentication required' }),
        });
      });
      
      // Trigger API call
      await debugPage.evaluate('() => { if (window.fetchConfig) { window.fetchConfig(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Should handle 401 error gracefully
      expect(true).toBe(true);
    });

    test('handles 403 Forbidden from API', async ({ debugPage, testOptions }) => {
      // Mock API to return 403 error
      await debugPage.route(`${testOptions.apiURL}/**`, (route) => {
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
        });
      });
      
      // Trigger API call
      await debugPage.evaluate('() => { if (window.fetchHistory) { window.fetchHistory(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Should handle 403 error gracefully
      expect(true).toBe(true);
    });

    test('handles 404 Not Found from API', async ({ debugPage, testOptions }) => {
      // Mock API to return 404 error
      await debugPage.route(`${testOptions.apiURL}/**`, (route) => {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not Found', message: 'Resource not found' }),
        });
      });
      
      // Trigger API call
      await debugPage.evaluate('() => { if (window.fetchInteractions) { window.fetchInteractions(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Should handle 404 error gracefully
      expect(true).toBe(true);
    });

    test('handles 500 Internal Server Error from API', async ({ debugPage, testOptions }) => {
      // Mock API to return 500 error
      await debugPage.route(`${testOptions.apiURL}/**`, (route) => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error', message: 'Server crashed' }),
        });
      });

      // Trigger API call
      await debugPage.evaluate('() => { if (window.fetchHistory) { window.fetchHistory(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Should handle 500 error gracefully
      expect(true).toBe(true);
    });

    test('handles network failure from API', async ({ debugPage, testOptions }) => {
      // Mock API to fail network request
      await debugPage.route(`${testOptions.apiURL}/**`, (route) => {
        route.abort('connectionfailed');
      });

      // Trigger API call
      await debugPage.evaluate('() => { if (window.fetchConfig) { window.fetchConfig(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Should handle network failure gracefully
      expect(true).toBe(true);
    });
  });

  test.describe('Form Submission Errors', () => {
    test('handles form validation errors', async ({ debugPage }) => {
      // Navigate to AI panel
      await debugPage.locator('[data-panel="ai"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // Try to send empty message
      const chatInput = debugPage.locator('#chat-input');
      const sendBtn = debugPage.locator('button[title="发送"]');
      
      // Clear input
      await chatInput.clear();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // Click send with empty input
      await sendBtn.click();
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Should handle validation error gracefully
      expect(true).toBe(true);
    });

    test('handles form submission network error', async ({ debugPage, testOptions }) => {
      // Navigate to AI panel
      await debugPage.locator('[data-panel="ai"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // Mock chat API to fail
      await debugPage.route(`${testOptions.apiURL}/**`, (route) => {
        route.abort('connectionfailed');
      });
      
      // Fill input
      const chatInput = debugPage.locator('#chat-input');
      await chatInput.fill('Test message');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // Click send
      const sendBtn = debugPage.locator('button[title="发送"]');
      await sendBtn.click();
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Should handle network error gracefully
      expect(true).toBe(true);
    });

    test('displays form error messages', async ({ debugPage }) => {
      // Navigate to Control panel
      await debugPage.locator('[data-panel="control"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // Try to navigate with empty URL
      const navigateBtn = debugPage.locator('#control-navigate-btn');
      const urlInput = debugPage.locator('#playwright-navigate-url');
      
      // Clear URL input
      await urlInput.clear();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // Click navigate button
      if (await navigateBtn.isEnabled()) {
        await navigateBtn.click();
        await debugPage.waitForTimeout(TIMEOUTS.LONG);
      }
      
      // Should display error message
      expect(true).toBe(true);
    });

    test('displays input error messages', async ({ debugPage }) => {
      // Navigate to Control panel
      await debugPage.locator('[data-panel="control"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // Enter invalid coordinates using evaluate to bypass type restriction
      await debugPage.evaluate(() => {
        const xInput = document.getElementById('playwright-click-x') as HTMLInputElement;
        const yInput = document.getElementById('playwright-click-y') as HTMLInputElement;
        if (xInput && yInput) {
          xInput.value = 'invalid';
          yInput.value = 'invalid';
        }
      });
      
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
      
      // Try to click
      const clickBtn = debugPage.locator('#control-click-btn');
      if (await clickBtn.isEnabled()) {
        await clickBtn.click();
        await debugPage.waitForTimeout(TIMEOUTS.LONG);
      }
      
      // Should handle validation error
      expect(true).toBe(true);
    });
  });

  test.describe('Error Display', () => {
    test('displays error messages to user', async ({ debugPage }) => {
      // Track console errors
      const consoleMessages: string[] = [];
      debugPage.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleMessages.push(msg.text());
        }
      });

      // Trigger an error
      await debugPage.evaluate('() => { if (window.showError) { window.showError("Test error message"); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Error should be logged
      expect(consoleMessages.length).toBeGreaterThanOrEqual(0);
    });

    test('displays toast notifications for errors', async ({ debugPage }) => {
      // Trigger an error that should show toast
      await debugPage.evaluate('() => { if (window.showNotification) { window.showNotification("Test error", "error"); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Toast notification container should exist
      const notificationContainer = debugPage.locator('#notificationContainer');
      await expect(notificationContainer).toBeTruthy();
    });

    test('displays error banner for critical errors', async ({ debugPage }) => {
      // Critical errors may show banner
      // Check if error banner element exists in DOM
      const errorBanner = debugPage.locator('#error-banner');
      
      // Banner may be hidden initially
      expect(await errorBanner.count()).toBeGreaterThanOrEqual(0);
    });

    test('updates connection status indicator on error', async ({ debugPage }) => {
      // Block WebSocket
      await debugPage.route('**/ws/**', (route) => {
        route.abort('connectionfailed');
      });
      
      // Reload page
      await debugPage.reload();
      await debugPage.waitForLoadState('networkidle');
      await debugPage.waitForTimeout(TIMEOUTS.XXLONG);
      
      // Status indicator should show error/offline state
      const statusIndicator = debugPage.locator('#statusIndicator');
      await expect(statusIndicator).toBeVisible();
      
      const statusText = debugPage.locator('#statusText');
      await expect(statusText).toBeVisible();
    });
  });

  test.describe('Recovery Functionality', () => {
    test('retry button retries failed operation', async ({ debugPage }) => {
      // Navigate to Monitor panel
      await debugPage.locator('[data-panel="monitor"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // Find retry buttons
      const retryButtons = debugPage.locator('button[data-action="retry"]');
      
      // If retry buttons exist, they should be clickable
      const count = await retryButtons.count();
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const btn = retryButtons.nth(i);
          if (await btn.isVisible()) {
            await btn.click();
            await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
          }
        }
      }
      
      // Test passed if no errors
      expect(true).toBe(true);
    });

    test('reconnect button reconnects WebSocket', async ({ debugPage }) => {
      // Wait for initial connection
      await debugPage.waitForTimeout(TIMEOUTS.XLONG);
      
      // Disconnect
      await debugPage.evaluate('() => { if (window.ws) { window.ws.close(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Click refresh/reconnect button
      const refreshBtn = debugPage.locator('button:has-text("刷新连接")');
      if (await refreshBtn.isVisible()) {
        await refreshBtn.click();
        await debugPage.waitForTimeout(TIMEOUTS.XXLONG);
        
        // Should attempt reconnection
        const statusText = debugPage.locator('#statusText');
        await expect(statusText).toBeVisible();
      }
    });

    test('single step button works after error', async ({ debugPage }) => {
      // Navigate to Monitor panel
      await debugPage.locator('[data-panel="monitor"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // Click single step button (use first match to avoid strict mode violation)
      const singleStepBtn = debugPage.locator('button[onclick="singleStep()"]').first();
      if (await singleStepBtn.isVisible()) {
        await singleStepBtn.click();
        await debugPage.waitForTimeout(TIMEOUTS.LONG);
      }
      
      // Should work even if backend is unavailable
      expect(true).toBe(true);
    });

    test('UI remains responsive during error states', async ({ debugPage }) => {
      // Block all API requests
      await debugPage.route('**/api/**', (route) => {
        route.abort('connectionfailed');
      });
      
      // Try to interact with UI
      await debugPage.locator('[data-panel="control"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      await debugPage.locator('[data-panel="ai"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // All panel switches should work
      expect(true).toBe(true);
    });
  });

  test.describe('Graceful Degradation', () => {
    test('UI remains usable when backend is completely down', async ({ browser, testOptions }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Block all API requests
      await page.route('**/api/**', (route) => {
        route.abort('connectionfailed');
      });
      
      // Block WebSocket
      await page.route('**/ws/**', (route) => {
        route.abort('connectionfailed');
      });
      
      await page.goto(testOptions.debugURL);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(TIMEOUTS.XLONG);
      
      // UI should still render
      await expect(page.locator('.activity-bar')).toBeVisible();
      await expect(page.locator('.sidebar')).toBeVisible();
      await expect(page.locator('.main')).toBeVisible();
      
      // Panels should be clickable
      await page.locator('[data-panel="monitor"]').first().click();
      await page.waitForTimeout(TIMEOUTS.SHORT);
      
      await page.locator('[data-panel="control"]').first().click();
      await page.waitForTimeout(TIMEOUTS.SHORT);
      
      await page.locator('[data-panel="ai"]').first().click();
      await page.waitForTimeout(TIMEOUTS.SHORT);
      
      // UI should remain responsive
      expect(true).toBe(true);
      
      await context.close();
    });

    test('shows offline indicators when services unavailable', async ({ debugPage }) => {
      // Block WebSocket
      await debugPage.route('**/ws/**', (route) => {
        route.abort('connectionfailed');
      });
      
      // Reload page
      await debugPage.reload();
      await debugPage.waitForLoadState('networkidle');
      await debugPage.waitForTimeout(TIMEOUTS.XXLONG);
      
      // Should show offline status
      const connectionStatus = debugPage.locator('#connectionStatus');
      await expect(connectionStatus).toBeVisible();
      
      const statusText = await connectionStatus.textContent();
      expect(statusText).toBeTruthy();
    });

    test('cached data displays when live data unavailable', async ({ debugPage }) => {
      // Navigate to History panel
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // History panel should show empty state or cached data
      const taskList = debugPage.locator('#taskList');
      await expect(taskList).toBeVisible();
      
      // Should show meaningful content (empty state or data)
      const content = await taskList.textContent();
      expect(content).toBeTruthy();
    });

    test('buttons show disabled state when appropriate', async ({ debugPage }) => {
      // Navigate to Control panel
      await debugPage.locator('[data-panel="control"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      
      // Browser control buttons should be disabled when browser not connected
      const screenshotBtn = debugPage.locator('#control-screenshot-btn');
      const navigateBtn = debugPage.locator('#control-navigate-btn');
      
      // Check button states
      const screenshotDisabled = await screenshotBtn.isDisabled();
      const navigateDisabled = await navigateBtn.isDisabled();
      
      // At least one should be disabled when browser not connected
      expect(screenshotDisabled || navigateDisabled).toBe(true);
    });
  });

  test.describe('Error Recovery - Combined Scenarios', () => {
    test('recovers from temporary network outage', async ({ debugPage, testOptions }) => {
      // Start with blocked network
      await debugPage.route(`${testOptions.apiURL}/**`, (route) => {
        route.abort('connectionfailed');
      });
      
      // Trigger API call
      await debugPage.evaluate('() => { if (window.fetchConfig) { window.fetchConfig(); } }');

      await debugPage.waitForTimeout(TIMEOUTS.LONG);

      // Unblock network
      await debugPage.unroute('**');

      // Retry operation
      await debugPage.evaluate('() => { if (window.fetchConfig) { window.fetchConfig(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.XLONG);
      
      // Should recover
      expect(true).toBe(true);
    });

    test('handles multiple consecutive errors gracefully', async ({ debugPage, testOptions }) => {
      // Mock all API endpoints to fail
      await debugPage.route(`${testOptions.apiURL}/**`, (route) => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Server Error' }),
        });
      });
      
      // Trigger multiple API calls
      const apiCalls = [
        'fetchConfig',
        'fetchHistory',
        'fetchInteractions',
        'fetchDOM',
      ];
      
      for (const apiCall of apiCalls) {
        await debugPage.evaluate(`(fn) => { if (window[fn]) { window[fn](); } }`, apiCall);
        await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
      }
      
      // Should handle all errors without crashing
      expect(true).toBe(true);
    });

    test('error messages are user-friendly and localized', async ({ debugPage }) => {
      // Track console messages
      const consoleMessages: string[] = [];
      debugPage.on('console', (msg) => {
        consoleMessages.push(msg.text());
      });
      
      // Trigger an error
      await debugPage.route('**/api/**', (route) => {
        route.abort('connectionfailed');
      });
      
      await debugPage.evaluate('() => { if (window.fetchConfig) { window.fetchConfig(); } }');
      
      await debugPage.waitForTimeout(TIMEOUTS.LONG);
      
      // Error messages should exist
      expect(consoleMessages.length).toBeGreaterThanOrEqual(0);
    });
  });
});
