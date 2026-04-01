/**
 * E2E Test: Message Recovery on Page Refresh
 *
 * Tests the complete flow of sending a message and verifying it persists after page refresh.
 * This validates that session events are properly persisted and recovered using
 * sessionEventsDAO and sessionEventHub injection in ChatHandler.
 *
 * TODO(react-refactor): Skipped — Chat UI restructured as separate route (/#/chat). Legacy selectors (#session-select, #chat-input, button[title="发送"]) no longer exist.
 * Rewrite with React-compatible selectors: [data-testid="session-selector"], [data-testid="composer-input"], [data-testid="send-button"]
 */
import { test, expect } from '@playwright/test';

test.describe.skip('Message Recovery on Page Refresh', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to Debug UI and ensure page is loaded
    await page.goto('http://localhost:3000/debug/#/chat');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('should recover messages after page refresh', async ({ page }) => {
    // Step 1: Create a new session
    const newSessionBtn = page.locator('button[title="新建会话"]');
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();
    await page.waitForTimeout(500);

    // Verify session was created
    const sessionSelect = page.locator('#session-select');
    const sessionId = await sessionSelect.inputValue();
    expect(sessionId).not.toBe('');
    console.log(`✓ Created session: ${sessionId}`);

    // Step 2: Send a unique test message
    const testMessage = `E2E test message ${Date.now()}`;
    const chatInput = page.locator('#chat-input');
    const sendBtn = page.locator('button[title="发送"]');

    await chatInput.fill(testMessage);
    const inputValue = await chatInput.inputValue();
    expect(inputValue).toBe(testMessage);
    console.log(`✓ Typed message: "${testMessage}"`);

    // Send the message
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();
    await page.waitForTimeout(500);

    // Step 3: Verify message appears in chat history
    const chatMessages = page.locator('#chat-messages');
    await expect(chatMessages).toBeVisible();

    // Wait for user message to appear
    const userMessage = chatMessages.locator(`text="${testMessage}"`);
    await expect(userMessage).toBeVisible({ timeout: 10000 });
    console.log('✓ Message displayed in chat');

    // Step 4: Refresh the page
    console.log('Refreshing page...');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Step 5: Verify the session is restored after refresh
    const restoredSessionId = await sessionSelect.inputValue();
    expect(restoredSessionId).toBe(sessionId);
    console.log(`✓ Session restored: ${restoredSessionId}`);

    // Step 6: Verify the message is still visible after refresh
    const restoredUserMessage = chatMessages.locator(`text="${testMessage}"`);
    await expect(restoredUserMessage).toBeVisible({ timeout: 10000 });
    console.log('✓ Message recovered after page refresh');
  });

  test('should recover multiple messages after page refresh', async ({ page }) => {
    // Create a new session
    const newSessionBtn = page.locator('button[title="新建会话"]');
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();
    await page.waitForTimeout(500);

    const sessionSelect = page.locator('#session-select');
    const sessionId = await sessionSelect.inputValue();
    expect(sessionId).not.toBe('');

    // Send multiple unique messages
    const testMessages = [
      `First message ${Date.now()}`,
      `Second message ${Date.now() + 1}`,
      `Third message ${Date.now() + 2}`,
    ];

    const chatInput = page.locator('#chat-input');
    const sendBtn = page.locator('button[title="发送"]');
    const chatMessages = page.locator('#chat-messages');

    for (const message of testMessages) {
      await chatInput.fill(message);
      await sendBtn.click();
      await page.waitForTimeout(300);
      console.log(`✓ Sent message: "${message}"`);
    }

    // Verify all messages appear
    for (const message of testMessages) {
      const msgElement = chatMessages.locator(`text="${message}"`);
      await expect(msgElement).toBeVisible({ timeout: 5000 });
    }
    console.log('✓ All messages displayed before refresh');

    // Refresh the page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Verify session is restored
    const restoredSessionId = await sessionSelect.inputValue();
    expect(restoredSessionId).toBe(sessionId);

    // Verify all messages are recovered
    for (const message of testMessages) {
      const restoredMessage = chatMessages.locator(`text="${message}"`);
      await expect(restoredMessage).toBeVisible({ timeout: 10000 });
    }
    console.log('✓ All messages recovered after page refresh');
  });

  test('should handle message recovery with slow connection', async ({ page }) => {
    // Create a new session
    const newSessionBtn = page.locator('button[title="新建会话"]');
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();
    await page.waitForTimeout(500);

    const sessionSelect = page.locator('#session-select');
    const sessionId = await sessionSelect.inputValue();
    expect(sessionId).not.toBe('');

    // Send a message
    const testMessage = `Slow connection test ${Date.now()}`;
    const chatInput = page.locator('#chat-input');
    const sendBtn = page.locator('button[title="发送"]');

    await chatInput.fill(testMessage);
    await sendBtn.click();
    await page.waitForTimeout(500);

    const chatMessages = page.locator('#chat-messages');
    const userMessage = chatMessages.locator(`text="${testMessage}"`);
    await expect(userMessage).toBeVisible({ timeout: 10000 });

    // Simulate slow connection by waiting before refresh
    console.log('Simulating slow connection...');
    await page.waitForTimeout(2000);

    // Refresh page
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Verify recovery with extended timeout
    const restoredSessionId = await sessionSelect.inputValue();
    expect(restoredSessionId).toBe(sessionId);

    const restoredMessage = chatMessages.locator(`text="${testMessage}"`);
    await expect(restoredMessage).toBeVisible({ timeout: 15000 });
    console.log('✓ Message recovered despite slow connection');
  });

  test('should preserve message order after refresh', async ({ page }) => {
    // Create a new session
    const newSessionBtn = page.locator('button[title="新建会话"]');
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();
    await page.waitForTimeout(500);

    // Send messages in sequence
    const testMessages = [
      `Message A ${Date.now()}`,
      `Message B ${Date.now() + 1}`,
      `Message C ${Date.now() + 2}`,
    ];

    const chatInput = page.locator('#chat-input');
    const sendBtn = page.locator('button[title="发送"]');
    const chatMessages = page.locator('#chat-messages');

    for (const message of testMessages) {
      await chatInput.fill(message);
      await sendBtn.click();
      await page.waitForTimeout(300);
    }

    // Capture message order before refresh
    const messagesBefore = await chatMessages.allTextContents();
    const orderBefore = testMessages.map(msg =>
      messagesBefore.findIndex(content => content.includes(msg))
    );

    // Refresh page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Capture message order after refresh
    const messagesAfter = await chatMessages.allTextContents();
    const orderAfter = testMessages.map(msg =>
      messagesAfter.findIndex(content => content.includes(msg))
    );

    // Verify order is preserved
    expect(orderBefore).toEqual(orderAfter);
    console.log('✓ Message order preserved after refresh');
  });

  test('should fail gracefully if session data is corrupted', async ({ page }) => {
    // This test validates error handling when recovery fails
    // For now, we just verify the basic flow doesn't crash

    const newSessionBtn = page.locator('button[title="新建会话"]');
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();
    await page.waitForTimeout(500);

    const testMessage = `Corruption test ${Date.now()}`;
    const chatInput = page.locator('#chat-input');
    const sendBtn = page.locator('button[title="发送"]');

    await chatInput.fill(testMessage);
    await sendBtn.click();
    await page.waitForTimeout(500);

    const chatMessages = page.locator('#chat-messages');
    const userMessage = chatMessages.locator(`text="${testMessage}"`);
    await expect(userMessage).toBeVisible({ timeout: 10000 });

    // Refresh page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Even if recovery fails, the page should not crash
    const chatInputAfter = page.locator('#chat-input');
    await expect(chatInputAfter).toBeVisible({ timeout: 10000 });
    console.log('✓ Page remains functional after refresh');
  });
});
