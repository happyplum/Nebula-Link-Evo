import { test, expect, chromium, Browser, Page, BrowserContext } from '@playwright/test';

const DEBUG_UI_URL = 'http://localhost:5173/debug/#/chat';
const API_URL = 'http://localhost:3000';

test.describe('Chat E2E Test', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('Complete chat flow: create session, send message, delete session', async () => {
    console.log('1. Navigating to chat page...');
    await page.goto(DEBUG_UI_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify we're on the chat page
    const chatInput = page.locator('#chat-input');
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    console.log('✓ Chat page loaded');

    // 2. Click new session button
    console.log('2. Creating new session...');
    const newSessionBtn = page.locator('button[title="新建会话"]');
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();
    await page.waitForTimeout(2000);

    // Verify session was created (session select should have a value)
    const sessionSelect = page.locator('#session-select');
    const selectedValue = await sessionSelect.inputValue();
    expect(selectedValue).not.toBe('');
    console.log(`✓ Session created: ${selectedValue}`);

    // 3. Type message in input field
    console.log('3. Typing message...');
    const testMessage = `Test message ${Date.now()}`;
    await chatInput.fill(testMessage);
    const inputValue = await chatInput.inputValue();
    expect(inputValue).toBe(testMessage);
    console.log(`✓ Message typed: "${testMessage}"`);

    // 4. Click send button
    console.log('4. Sending message...');
    const sendBtn = page.locator('button[title="发送"]');
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();
    await page.waitForTimeout(1000);

    // 5. Verify message appears in chat
    console.log('5. Verifying message appears in chat...');
    const chatMessages = page.locator('#chat-messages');
    
    // Wait for the message to appear (user message should appear immediately)
    await page.waitForTimeout(2000);
    
    // Check if user message is displayed
    const userMessage = chatMessages.locator(`text="${testMessage}"`);
    await expect(userMessage).toBeVisible({ timeout: 5000 });
    console.log('✓ User message displayed');

    // Check for AI response (may show error if provider not configured)
    await page.waitForTimeout(3000);
    const messagesContent = await chatMessages.textContent();
    console.log(`Chat content preview: ${messagesContent?.substring(0, 200)}...`);

    // 6. Delete session
    console.log('6. Deleting session...');
    const deleteBtn = page.locator('button[title="删除会话"]');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
    
    // Handle confirmation dialog if present
    page.on('dialog', async dialog => {
      console.log(`Dialog message: ${dialog.message()}`);
      await dialog.accept();
    });
    
    await page.waitForTimeout(2000);

    // 7. Verify session is deleted (select should be empty)
    console.log('7. Verifying session deletion...');
    const finalSelectedValue = await sessionSelect.inputValue();
    expect(finalSelectedValue).toBe('');
    console.log('✓ Session deleted');

    // Take final screenshot
    await page.screenshot({ path: 'test-results/chat-e2e-final.png' });
    console.log('\n=== E2E Test Complete ===');
    console.log('All steps passed:');
    console.log('  ✓ Navigate to chat page');
    console.log('  ✓ Create new session');
    console.log('  ✓ Type message');
    console.log('  ✓ Send message');
    console.log('  ✓ Message displayed');
    console.log('  ✓ Delete session');
    console.log('  ✓ Session deleted');
  });
});
