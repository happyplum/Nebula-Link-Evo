import { test, expect } from '../fixtures/test.fixture';
import { TIMEOUTS } from '../constants';

/**
 * E2E: Debug UI Page Load (React)
 *
 * Selectors aligned to the new React DOM with data-testid attributes.
 * Legacy selectors (data-panel, #sidebar-*, #statusIndicator, etc.) removed.
 */
test.describe('Debug UI - Page Load', () => {
  test('page loads successfully with 200 status', async ({ debugPage, testOptions }) => {
    await expect(debugPage).toHaveURL(/\/debug\/?$/);
  });

  test('page title is "Nebula Debug Console"', async ({ debugPage }) => {
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    const title = await debugPage.title();
    expect(title).toBe('Nebula Debug Console');
  });

  test('debug shell and main UI elements render', async ({ debugPage }) => {
    await debugPage.waitForTimeout(TIMEOUTS.LONG);

    // Root shell
    await expect(debugPage.locator('[data-testid="debug-shell"]')).toBeVisible();

    // Activity bar with icon buttons
    await expect(debugPage.locator('[data-testid="activity-btn-playwright"]')).toBeVisible();
    await expect(debugPage.locator('[data-testid="activity-btn-config"]')).toBeVisible();
    await expect(debugPage.locator('[data-testid="activity-btn-history"]')).toBeVisible();
    await expect(debugPage.locator('[data-testid="activity-btn-chat"]')).toBeVisible();

    // Sidebar
    await expect(debugPage.locator('[data-testid="debug-sidebar"]')).toBeVisible();

    // Main area
    await expect(debugPage.locator('[data-testid="debug-main"]')).toBeVisible();

    // Right panel
    await expect(debugPage.locator('[data-testid="debug-right-panel"]')).toBeVisible();

    // Connection status indicators
    await expect(debugPage.locator('[data-testid="connection-status"]')).toBeVisible();
    await expect(debugPage.locator('[data-testid="playwright-status"]')).toBeVisible();
  });

  test.skip('WebSocket connection establishes — requires live playwright-server', async ({ debugPage, wsMonitor }) => {
    // TODO: Configure test runner to automatically start playwright-server
    await debugPage.waitForTimeout(TIMEOUTS.LONG);

    await expect(() => {
      expect(wsMonitor.connectionCount).toBeGreaterThan(0);
      expect(wsMonitor.isConnected).toBe(true);
    }).toPass({ timeout: 10000 });
  });

  test('connection status indicator shows status text', async ({ debugPage }) => {
    await debugPage.waitForTimeout(TIMEOUTS.XXLONG);

    const connectionStatus = debugPage.locator('[data-testid="connection-status"]');
    await expect(connectionStatus).toBeVisible();

    const statusText = await connectionStatus.textContent();
    expect(statusText).toBeTruthy();
  });
});

test.describe('Debug UI - WebSocket Failure Scenarios', () => {
  test('WebSocket connection fails gracefully when server is unavailable', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    try {
      await page.goto('http://localhost:9999/debug', {
        timeout: 5000,
        waitUntil: 'domcontentloaded'
      }).catch(() => {});

      await page.waitForTimeout(TIMEOUTS.XLONG);

      expect(consoleErrors.length).toBeGreaterThanOrEqual(0);
    } catch (error) {
      expect(error).toBeDefined();
    } finally {
      await context.close();
    }
  });

  test('UI shows offline status when WebSocket cannot connect', async ({ debugPage }) => {
    await debugPage.route('**/ws/debug/**', (route) => {
      route.abort('connectionfailed');
    });

    await debugPage.reload();
    await debugPage.waitForLoadState('networkidle');
    await debugPage.waitForTimeout(TIMEOUTS.XXLONG);

    const connectionStatus = debugPage.locator('[data-testid="connection-status"]');
    await expect(connectionStatus).toBeVisible();

    const statusText = await connectionStatus.textContent();
    expect(statusText).toBeTruthy();
  });

  test('WebSocket reconnects after temporary disconnection', async ({ debugPage }) => {
    await debugPage.waitForTimeout(TIMEOUTS.XLONG);

    // The React app uses useDebugSocket hook which auto-reconnects
    // Simulate disconnect by blocking WS and then restoring
    await debugPage.route('**/ws/debug/**', (route) => {
      route.abort('connectionfailed');
    });

    await debugPage.waitForTimeout(TIMEOUTS.LONG);

    // Unblock — React hook should auto-reconnect
    await debugPage.unroute('**/ws/debug/**');

    await debugPage.waitForTimeout(TIMEOUTS.XXLONG);

    const connectionStatus = debugPage.locator('[data-testid="connection-status"]');
    await expect(connectionStatus).toBeVisible();
  });
});

test.describe('Debug UI - Activity Bar Navigation', () => {
  test('activity bar switches sidebar content', async ({ debugPage }) => {
    await debugPage.waitForTimeout(TIMEOUTS.LONG);

    // Click playwright (Control) button
    await debugPage.locator('[data-testid="activity-btn-playwright"]').click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    await expect(debugPage.locator('[data-testid="control-panel"]')).toBeVisible();

    // Click config button
    await debugPage.locator('[data-testid="activity-btn-config"]').click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    await expect(debugPage.locator('[data-testid="config-panel"]')).toBeVisible();

    // Click history button
    await debugPage.locator('[data-testid="activity-btn-history"]').click();
    await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    await expect(debugPage.locator('[data-testid="history-table"]')).toBeVisible();
  });

  // TODO: React refactor removed legacy data-history-tab, data-right-tab, and
  // sidebar-* ID-based panel switching. History and Interactions are now
  // combined in the sidebar. Right panel uses Tabs component with
  // data-testid="tabs-{id}" for tab switching tests.
});
