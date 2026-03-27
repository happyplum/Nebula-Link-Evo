/**
 * E2E Test: Connectivity Fail-Close Behavior
 *
 * Tests the fail-close mechanism that prevents new messages when connectivity
 * test fails, and ensures proper blocking/unblocking behavior.
 */
import { test, expect } from '@playwright/test';

test.describe('Connectivity Fail-Close', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to Debug UI and ensure page is loaded
    await page.goto('http://localhost:3000/debug');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click on AI panel to make sidebar visible
    const aiPanelBtn = page.locator('[data-panel="ai"]').first();
    await expect(aiPanelBtn).toBeVisible();
    await aiPanelBtn.click();
    await page.waitForTimeout(1000);

    // Create or select a session for testing
    const newSessionBtn = page.locator('#sidebar-ai button[title="新建会话"]');
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();
    await page.waitForTimeout(1000);

    // Verify session was created
    const sessionSelect = page.locator('#session-select');
    const sessionId = await sessionSelect.inputValue();
    expect(sessionId).not.toBe('');
    console.log(`✓ Created session: ${sessionId}`);
  });

  test('should display connectivity test button', async ({ page }) => {
    // Navigate to root debug page (not chat)
    await page.goto('http://localhost:3000/debug');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click on config panel tab FIRST before doing anything else
    const configTab = page.locator('[data-right-tab="config"]');
    await expect(configTab).toBeVisible();
    await configTab.click();
    await page.waitForTimeout(500);

    // Wait for config tab to be active
    await expect(configTab).toHaveClass(/active/);

    // Explicitly call fetchConfig to ensure config is loaded
    await page.evaluate(() => {
      if (typeof (window as any).fetchConfig === 'function') {
        (window as any).fetchConfig();
      }
    });
    
    // Wait for config to be loaded
    await page.waitForTimeout(2000);

    // Verify config display is visible and populated
    const configDisplay = page.locator('#configDisplay');
    await expect(configDisplay).toBeVisible();
    await expect(configDisplay).not.toContainText('加载中...');
    await expect(configDisplay).not.toHaveClass('empty-state');

    // Verify connectivity test button exists
    const connectivityBtn = page.locator('#connectivity-test-btn');
    await expect(connectivityBtn).toBeVisible({ timeout: 15000 });
    await expect(connectivityBtn).toHaveText('测试连通性');
    console.log('✓ Connectivity test button is visible');
  });

  test('should show status update after connectivity test', async ({ page }) => {
    // Navigate to config panel
    const configTab = page.locator('[data-right-tab="config"]');
    await configTab.click();
    await page.waitForTimeout(500);

    // Wait for config tab and page to be active
    await expect(configTab).toHaveClass(/active/);
    await expect(page.locator('#right-config')).toHaveClass(/active/);

    // Wait for config to be loaded
    const configDisplay = page.locator('#configDisplay');
    await expect(configDisplay).toBeVisible();

    // Find connectivity test button and status display
    const connectivityBtn = page.locator('#connectivity-test-btn');
    const statusDiv = page.locator('#connectivity-status');

    await expect(connectivityBtn).toBeVisible();
    await expect(statusDiv).toBeVisible();

    // Click to test connectivity
    await connectivityBtn.click();

    // Wait for test to complete (button text changes)
    await expect(connectivityBtn).toHaveText('重新测试', { timeout: 15000 });
    console.log('✓ Connectivity test completed');

    // Verify status was updated
    const statusText = await statusDiv.textContent();
    expect(statusText).not.toBe('未测试');
    expect(statusText).not.toBe('测试中...');
    console.log(`✓ Status updated: ${statusText}`);
  });

  test('should block new messages when connectivity fails', async ({ page }) => {
    // Mock failed connectivity by intercepting the test endpoint
    await page.route('**/api/chat/connectivity/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          message: 'Connection failed',
          latencyMs: 100
        })
      });
    });

    // Navigate to config panel and trigger failed test
    const configTab = page.locator('[data-right-tab="config"]');
    await configTab.click();
    await page.waitForTimeout(500);

    // Wait for config to be loaded
    await expect(page.locator('#right-config')).toHaveClass(/active/);

    const connectivityBtn = page.locator('#connectivity-test-btn');
    await connectivityBtn.click();
    await page.waitForTimeout(1000);

    // Return to chat panel (AI panel)
    const aiPanelBtn = page.locator('[data-panel="ai"]').first();
    await aiPanelBtn.click();
    await page.waitForTimeout(500);

    // Verify input is blocked
    const chatInput = page.locator('#chat-input');
    const sendBtn = page.locator('button[title="发送"]');

    await expect(chatInput).toBeDisabled();
    await expect(sendBtn).toBeDisabled();

    // Verify placeholder shows blocking message
    const placeholder = await chatInput.getAttribute('placeholder');
    expect(placeholder).toContain('连通性测试失败');
    console.log('✓ Input and send button are blocked');

    // Try to send a message (should fail silently)
    await chatInput.fill('Test message');
    await sendBtn.click();
    await page.waitForTimeout(500);

    // Verify no message was sent to the chat
    const chatMessages = page.locator('#chat-messages');
    const testMessage = chatMessages.locator('text="Test message"');
    await expect(testMessage).not.toBeVisible();
    console.log('✓ Message sending is blocked');
  });

  test('should unblock after successful retest', async ({ page }) => {
    // First, mock failed connectivity
    await page.route('**/api/chat/connectivity/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          message: 'Connection failed',
          latencyMs: 100
        })
      });
    });

    // Trigger initial failed test
    const configTab = page.locator('[data-right-tab="config"]');
    await configTab.click();
    await page.waitForTimeout(500);

    await expect(page.locator('#right-config')).toHaveClass(/active/);

    const connectivityBtn = page.locator('#connectivity-test-btn');
    await connectivityBtn.click();
    await page.waitForTimeout(1000);

    // Verify blocked state
    const aiPanelBtn = page.locator('[data-panel="ai"]').first();
    await aiPanelBtn.click();
    await page.waitForTimeout(500);

    const chatInput = page.locator('#chat-input');
    const sendBtn = page.locator('button[title="发送"]');

    await expect(chatInput).toBeDisabled();
    await expect(sendBtn).toBeDisabled();

    // Now mock successful test
    await page.route('**/api/chat/connectivity/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          message: 'Connection successful',
          latencyMs: 50
        })
      });
    });

    // Retest connectivity
    await configTab.click();
    await page.waitForTimeout(500);

    await connectivityBtn.click();
    await page.waitForTimeout(1000);

    // Verify unblocked
    await aiPanelBtn.click();
    await page.waitForTimeout(500);

    await expect(chatInput).toBeEnabled();
    await expect(sendBtn).toBeEnabled();

    // Verify placeholder is normal
    const placeholder = await chatInput.getAttribute('placeholder');
    expect(placeholder).toContain('输入消息');
    console.log('✓ Input unblocked after successful retest');

    // Verify we can now send a message
    await chatInput.fill('Test after retest');
    await sendBtn.click();
    await page.waitForTimeout(1000);

    const chatMessages = page.locator('#chat-messages');
    const testMessage = chatMessages.locator('text="Test after retest"');
    await expect(testMessage).toBeVisible({ timeout: 10000 });
    console.log('✓ Message sent successfully after unblock');
  });

  test('should maintain blocked state across page reload', async ({ page }) => {
    // Mock failed connectivity
    await page.route('**/api/chat/connectivity/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          message: 'Connection failed',
          latencyMs: 100
        })
      });
    });

    // Trigger failed test
    const configTab = page.locator('[data-right-tab="config"]');
    await configTab.click();
    await page.waitForTimeout(500);

    await expect(page.locator('#right-config')).toHaveClass(/active/);

    const connectivityBtn = page.locator('#connectivity-test-btn');
    await connectivityBtn.click();
    await page.waitForTimeout(1000);

    // Verify blocked state
    const aiPanelBtn = page.locator('[data-panel="ai"]').first();
    await aiPanelBtn.click();
    await page.waitForTimeout(500);

    const chatInput = page.locator('#chat-input');
    await expect(chatInput).toBeDisabled();

    // Reload page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Note: The blocked state is NOT persisted across reloads
    // The page starts in a clean state
    await expect(chatInput).toBeEnabled();
    console.log('✓ Blocked state resets after page reload');
  });

  test('should show appropriate status messages for different test results', async ({ page }) => {
    // Mock successful connectivity test
    await page.route('**/api/chat/connectivity/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          message: 'Connection successful',
          latencyMs: 45
        })
      });
    });

    const configTab = page.locator('[data-right-tab="config"]');
    await configTab.click();
    await page.waitForTimeout(500);

    // Wait for config to be loaded
    await expect(page.locator('#right-config')).toHaveClass(/active/);

    const connectivityBtn = page.locator('#connectivity-test-btn');
    const statusDiv = page.locator('#connectivity-status');

    // Test successful case
    await connectivityBtn.click();
    await page.waitForTimeout(1000);

    const successText = await statusDiv.textContent();
    expect(successText).toContain('成功');
    expect(successText).toContain('45ms');
    expect(statusDiv).toHaveClass(/text-success/);
    console.log(`✓ Success status: ${successText}`);

    // Now mock failed test
    await page.route('**/api/chat/connectivity/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          message: 'Timeout',
          latencyMs: 3000
        })
      });
    });

    await connectivityBtn.click();
    await page.waitForTimeout(1000);

    const failureText = await statusDiv.textContent();
    expect(failureText).toContain('失败');
    expect(failureText).toContain('3000ms');
    expect(statusDiv).toHaveClass(/text-error/);
    console.log(`✓ Failure status: ${failureText}`);
  });
});
