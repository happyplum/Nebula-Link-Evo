// Chat panel tests for Debug UI
import { test, expect } from '@playwright/test';
import { ChatPage } from '../page-objects/chat-page.js';

test.describe('Chat Panel', () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    await chatPage.goto('/');
  });

  test('should display chat panel', async ({ page }) => {
    const chatPanel = page.locator('[data-testid="chat-panel"], #chat-panel');
    await expect(chatPanel).toBeVisible();
  });

  test('should have message input', async ({ page }) => {
    const messageInput = page.locator('textarea, input[type="text"], [data-testid="message-input"]');
    await expect(messageInput).toBeVisible();
  });

  test('should display message history', async ({ page }) => {
    const messageList = page.locator('[data-testid="messages"], .messages, .message-list');
    await expect(messageList).toBeVisible();
  });
});
