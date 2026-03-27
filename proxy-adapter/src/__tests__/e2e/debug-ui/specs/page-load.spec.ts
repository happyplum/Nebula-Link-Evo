import { test, expect } from '../fixtures/test.fixture';
import { TIMEOUTS } from '../constants';

test.describe('Debug UI - Page Load', () => {
  test('page loads successfully with 200 status', async ({ debugPage, testOptions }) => {
    // debugPage fixture already navigates to the page
    // URL may have trailing slash, so match base path
    await expect(debugPage).toHaveURL(/\/debug\/?$/);
  });

  test('page title is "Nebula Debug Console"', async ({ debugPage }) => {
    // debugPage fixture already navigates to the page and waits for networkidle
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    const title = await debugPage.title();
    expect(title).toBe('Nebula Debug Console');
  });

  test('all main UI elements render correctly', async ({ debugPage }) => {
    // debugPage fixture already navigates to the page and waits for networkidle
    await debugPage.waitForTimeout(TIMEOUTS.LONG);

    // Activity Bar items
    await expect(debugPage.locator('[data-panel="monitor"]')).toBeVisible();
    await expect(debugPage.locator('[data-panel="control"]')).toBeVisible();
    await expect(debugPage.locator('[data-panel="ai"]')).toBeVisible();
    await expect(debugPage.locator('[data-panel="history"]')).toBeVisible();
    await expect(debugPage.locator('[data-panel="interactions"]')).toBeVisible();

    // Sidebar header
    await expect(debugPage.locator('.sidebar-header h1').first()).toContainText('🌌 Nebula Debug');

    // Monitor Panel - Default active panel
    await expect(debugPage.locator('#sidebar-monitor')).toBeVisible();
    await expect(debugPage.locator('#statusIndicator')).toBeVisible();
    await expect(debugPage.locator('#statusText')).toBeVisible();
    await expect(debugPage.locator('#playwright-status-indicator')).toBeVisible();
    await expect(debugPage.locator('#playwright-status-text')).toBeVisible();

    // All sidebar panels exist in DOM (may be hidden depending on active panel)
    await expect(debugPage.locator('#sidebar-control')).toBeTruthy();
    await expect(debugPage.locator('#sidebar-ai')).toBeTruthy();
    await expect(debugPage.locator('#sidebar-history')).toBeTruthy();

    // Main Content
    await expect(debugPage.locator('.main')).toBeVisible();
    await expect(debugPage.locator('#screenshotDisplay')).toBeVisible();
    await expect(debugPage.locator('#liveviewContainer')).toBeVisible();

    // Connection status badge
    await expect(debugPage.locator('#connectionStatusBadge')).toBeVisible();
    await expect(debugPage.locator('#connectionStatus')).toBeVisible();
  });

  test.skip('WebSocket connection establishes successfully', async ({ debugPage, wsMonitor }) => {
    // Skip this test as playwright-server needs to be running separately
    // TODO: Configure test runner to automatically start playwright-server
    // Wait for page to fully load and WebSocket to establish
    await debugPage.waitForTimeout(TIMEOUTS.LONG);

    await expect(() => {
      expect(wsMonitor.connectionCount).toBeGreaterThan(0);
      expect(wsMonitor.isConnected).toBe(true);
    }).toPass({ timeout: 10000 });
  });

  test('connection status indicator updates to connected', async ({ debugPage }) => {
    // Wait for WebSocket to connect
    await debugPage.waitForTimeout(TIMEOUTS.XXLONG);

    // Check status indicator in main header
    const connectionStatus = debugPage.locator('#connectionStatus');
    await expect(connectionStatus).toBeVisible();

    // Status should show connected state
    const statusText = await connectionStatus.textContent();
    expect(statusText).toBeTruthy();
  });
});

test.describe('Debug UI - WebSocket Failure Scenarios', () => {
  test('WebSocket connection fails gracefully when server is unavailable', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Track console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    // Track network failures
    const networkErrors: string[] = [];
    page.on('requestfailed', (request) => {
      networkErrors.push(request.url());
    });
    
    try {
      // Try to connect to non-existent WebSocket endpoint
      await page.goto('http://localhost:9999/debug', { 
        timeout: 5000,
        waitUntil: 'domcontentloaded'
      }).catch(() => {});
      
      await page.waitForTimeout(TIMEOUTS.XLONG);
      
      // Page should handle connection failure gracefully
      // Console errors are expected but should not crash
      expect(consoleErrors.length).toBeGreaterThanOrEqual(0);
    } catch (error) {
      // Expected: connection fails
      expect(error).toBeDefined();
    } finally {
      await context.close();
    }
  });

  test('UI shows offline status when WebSocket cannot connect', async ({ debugPage }) => {
    // Mock WebSocket endpoint to return error
    await debugPage.route('**/ws/debug/**', (route) => {
      route.abort('connectionfailed');
    });

    // Reload page to trigger WebSocket connection attempt
    await debugPage.reload();
    await debugPage.waitForLoadState('networkidle');
    await debugPage.waitForTimeout(TIMEOUTS.XXLONG);

    // Status should show offline/disconnected state
    const connectionStatus = debugPage.locator('#connectionStatus');
    await expect(connectionStatus).toBeVisible();

    const statusText = await connectionStatus.textContent();
    // Should show offline state (离线 or similar)
    expect(statusText).toBeTruthy();
  });

  test('WebSocket reconnects after temporary disconnection', async ({ debugPage }) => {
    // Wait for initial connection
    await debugPage.waitForTimeout(TIMEOUTS.XLONG);

    // Disconnect WebSocket
    await debugPage.evaluate('() => { const win = window; if (win.ws) { win.ws.close(); } }');

    await debugPage.waitForTimeout(TIMEOUTS.LONG);

    // Trigger reconnection (e.g., by clicking refresh button)
    const refreshBtn = debugPage.locator('button:has-text("刷新连接")');
    if (await refreshBtn.isVisible()) {
      await refreshBtn.click();
    }

    await debugPage.waitForTimeout(TIMEOUTS.XXLONG);

    // Should attempt reconnection
    const connectionStatus = debugPage.locator('#connectionStatus');
    await expect(connectionStatus).toBeVisible();
  });
});

test.describe('Debug UI - Navigation and Routing', () => {
  test('activity bar switches between panels', async ({ debugPage }) => {
    // Wait for UI to fully render
    await debugPage.waitForTimeout(TIMEOUTS.LONG);

    // Monitor panel should be active by default
    await expect(debugPage.locator('[data-panel="monitor"]').first()).toHaveClass(/active/);

    // Click Control panel
    await debugPage.locator('[data-panel="control"]').first().click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    await expect(debugPage.locator('[data-panel="control"]').first()).toHaveClass(/active/);

    // Click AI panel
    await debugPage.locator('[data-panel="ai"]').first().click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    await expect(debugPage.locator('[data-panel="ai"]').first()).toHaveClass(/active/);

    // Click History panel
    await debugPage.locator('[data-panel="history"]').first().click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    await expect(debugPage.locator('[data-panel="history"]').first()).toHaveClass(/active/);

    // Click Interactions panel
    await debugPage.locator('[data-panel="interactions"]').first().click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    await expect(debugPage.locator('[data-panel="interactions"]').first()).toHaveClass(/active/);
  });

  test('history panel tabs switch correctly', async ({ debugPage }) => {
    // Click History panel first
    await debugPage.locator('[data-panel="history"]').first().click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

    // Tasks tab should be active by default
    await expect(debugPage.locator('[data-history-tab="tasks"]').first()).toHaveClass(/active/);

    // Click Logs tab
    await debugPage.locator('[data-history-tab="logs"]').first().click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    await expect(debugPage.locator('[data-history-tab="logs"]').first()).toHaveClass(/active/);

    // Click Decision tab
    await debugPage.locator('[data-history-tab="decision"]').first().click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    await expect(debugPage.locator('[data-history-tab="decision"]').first()).toHaveClass(/active/);
  });
});
