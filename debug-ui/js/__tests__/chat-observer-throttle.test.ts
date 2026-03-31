/**
 * Tests for MutationObserver throttle during streaming in chat-component.ts.
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { show, hide } from '../chat-component.js';

// Mock scrollIntoView - jsdom doesn't implement this
Element.prototype.scrollIntoView = vi.fn();

describe('MutationObserver throttle implementation', () => {
  let sidebarPanel: HTMLElement;
  let chatPageContainer: HTMLElement | null = null;

  beforeEach(() => {
    // Clean up document
    document.body.innerHTML = '';
    vi.useRealTimers(); // Use real timers for MutationObserver tests

    // Set up sidebar element that observer watches
    sidebarPanel = document.createElement('div');
    sidebarPanel.id = 'sidebar-ai';
    document.body.appendChild(sidebarPanel);

    // Set up required sidebar elements for sync
    const sidebarElements = [
      'session-status-filter',
      'session-select',
      'cot-toggle',
      'chat-control-bar',
      'interrupt-btn',
      'pause-btn',
      'resume-btn',
      'cancel-btn',
      'pausing-feedback',
      'chat-messages',
      'screenshot-preview',
      'chat-input',
      'chat-model-selector',
    ];

    sidebarElements.forEach(id => {
      const el = document.createElement(id.startsWith('chat-') ? 'div' : id === 'cot-toggle' ? 'input' : id.startsWith('chat-input') ? 'textarea' : id.startsWith('session-status-filter') || id.startsWith('session-select') || id === 'chat-model-selector' ? 'select' : 'button');
      el.id = id;
      if (id === 'cot-toggle') (el as HTMLInputElement).type = 'checkbox';
      sidebarPanel.appendChild(el);
    });
  });

  afterEach(() => {
    hide();
    vi.clearAllMocks();
  });

  describe('syncChatPageFromSidebar called immediately when not streaming', () => {
    it('should call sync immediately on mutation when isStreaming is false', async () => {
      // Set up chatManager with isStreaming = false
      const mockChatManager = {
        isStreaming: false,
        switchSession: vi.fn(),
        createSession: vi.fn(),
        deleteCurrentSession: vi.fn(),
        toggleCoT: vi.fn(),
        sendMessage: vi.fn(),
        captureScreenshot: vi.fn(),
        clearScreenshot: vi.fn(),
        setStatusFilter: vi.fn(),
      } as unknown;

      (window as unknown as { chatManager?: unknown }).chatManager = mockChatManager;

      // Set a value on a sidebar element
      const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
      if (chatInput) chatInput.value = 'test message';

      // Initialize component and observer
      show();

      // Get the chat page container
      chatPageContainer = document.getElementById('chat-page-container');

      // Trigger DOM mutation
      sidebarPanel.appendChild(document.createElement('div'));

      // Wait for MutationObserver callback to run (microtasks)
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify the value was synced to chat page input
      const chatPageInput = document.getElementById('chat-page-chat-input') as HTMLTextAreaElement | null;
      expect(chatPageInput?.value).toBe('test message');
    });
  });

  describe('syncChatPageFromSidebar throttled when streaming', () => {
    it('should throttle rapid mutations during streaming', async () => {
      // Set up chatManager with isStreaming = true
      const mockChatManager = {
        isStreaming: true,
        switchSession: vi.fn(),
        createSession: vi.fn(),
        deleteCurrentSession: vi.fn(),
        toggleCoT: vi.fn(),
        sendMessage: vi.fn(),
        captureScreenshot: vi.fn(),
        clearScreenshot: vi.fn(),
        setStatusFilter: vi.fn(),
      } as unknown;

      (window as unknown as { chatManager?: unknown }).chatManager = mockChatManager;

      // Set a value on a sidebar element
      const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
      if (chatInput) chatInput.value = 'first message';

      // Initialize component and observer
      show();

      // Get the chat page container
      chatPageContainer = document.getElementById('chat-page-container');

      // Trigger first mutation
      sidebarPanel.appendChild(document.createElement('div'));

      // Allow MutationObserver callback to run
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify the first value was synced
      const chatPageInput = document.getElementById('chat-page-chat-input') as HTMLTextAreaElement | null;
      expect(chatPageInput?.value).toBe('first message');

      // Change the value again
      if (chatInput) chatInput.value = 'second message';

      // Trigger second mutation immediately (within 200ms)
      sidebarPanel.appendChild(document.createElement('div'));

      // Allow MutationObserver callback to run
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should still have the first value (second mutation throttled)
      expect(chatPageInput?.value).toBe('first message');
    });
  });

  describe('syncChatPageFromSidebar called after throttle window expires', () => {
    it('should call sync after 200ms throttle window expires during streaming', async () => {
      // Set up chatManager with isStreaming = true
      const mockChatManager = {
        isStreaming: true,
        switchSession: vi.fn(),
        createSession: vi.fn(),
        deleteCurrentSession: vi.fn(),
        toggleCoT: vi.fn(),
        sendMessage: vi.fn(),
        captureScreenshot: vi.fn(),
        clearScreenshot: vi.fn(),
        setStatusFilter: vi.fn(),
      } as unknown;

      (window as unknown as { chatManager?: unknown }).chatManager = mockChatManager;

      // Set a value on a sidebar element
      const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
      if (chatInput) chatInput.value = 'first message';

      // Initialize component and observer
      show();

      // Get the chat page container
      chatPageContainer = document.getElementById('chat-page-container');

      // Trigger first mutation at t=0
      sidebarPanel.appendChild(document.createElement('div'));

      // Allow MutationObserver callback to run
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify the first value was synced
      const chatPageInput = document.getElementById('chat-page-chat-input') as HTMLTextAreaElement | null;
      expect(chatPageInput?.value).toBe('first message');

      // Change the value again
      if (chatInput) chatInput.value = 'second message';

      // Wait for throttle window to expire (200ms)
      await new Promise(resolve => setTimeout(resolve, 210));

      // Trigger second mutation
      sidebarPanel.appendChild(document.createElement('div'));

      // Allow MutationObserver callback to run
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have the second value now (sync called again)
      expect(chatPageInput?.value).toBe('second message');
    });
  });

  describe('throttle does not apply when not streaming', () => {
    it('should not throttle rapid mutations when isStreaming is false', async () => {
      // Set up chatManager with isStreaming = false
      const mockChatManager = {
        isStreaming: false,
        switchSession: vi.fn(),
        createSession: vi.fn(),
        deleteCurrentSession: vi.fn(),
        toggleCoT: vi.fn(),
        sendMessage: vi.fn(),
        captureScreenshot: vi.fn(),
        clearScreenshot: vi.fn(),
        setStatusFilter: vi.fn(),
      } as unknown;

      (window as unknown as { chatManager?: unknown }).chatManager = mockChatManager;

      // Get the sidebar input
      const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;

      // Initialize component and observer
      show();

      // Get the chat page container and input after show() creates them
      chatPageContainer = document.getElementById('chat-page-container');
      const chatPageInput = document.getElementById('chat-page-chat-input') as HTMLTextAreaElement | null;

      // Trigger multiple rapid mutations with different values
      for (let i = 0; i < 5; i++) {
        if (chatInput) chatInput.value = `message ${i}`;
        sidebarPanel.appendChild(document.createElement('div'));
        // Allow callback to run after each mutation
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Should have the last value (no throttling when not streaming)
      expect(chatPageInput?.value).toBe('message 4');
    });
  });
});
