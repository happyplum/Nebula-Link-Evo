/**
 * Tests for tool_result handling in chat.ts
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock scrollIntoView and scrollToBottom
Element.prototype.scrollIntoView = vi.fn();
window.scrollTo = vi.fn();

// Mock showNotification to avoid DOM dependencies
vi.mock('../ui.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showNotification: vi.fn(),
}));

describe('ChatManager tool_result handling', () => {
  let ChatManager: any;
  let container: HTMLElement;

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();

    // Set up DOM
    document.body.innerHTML = `
      <div id="messageContainer">
        <div id="statusIndicator" class="offline"></div>
        <div id="statusText"></div>
        <div id="sessionList"></div>
        <div id="notificationContainer"></div>
      </div>
      <div id="inputPanel">
        <input id="chatInput" />
        <button id="sendButton">Send</button>
      </div>
    `;
    container = document.getElementById('messageContainer')!;

    // Import ChatManager module (dynamic import for caching)
    const module = await import('../chat.js');
    ChatManager = module.ChatManager;

    // Mock WebSocket and EventSource
    global.EventSource = vi.fn(() => ({
      addEventListener: vi.fn(),
      onmessage: null,
      close: vi.fn(),
    })) as any;

    global.WebSocket = vi.fn(() => ({
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
    })) as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle assistant.tool_result event and update matching tool_call', () => {
    // Create a new chat manager instance
    const chatManager = new ChatManager();
    chatManager.messageContainer = container;
    chatManager.currentSessionId = 'test-session';

    // Create a message div with tool_call
    const msgDiv = document.createElement('div');
    msgDiv.dataset.id = 'msg-1';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    msgDiv.appendChild(contentDiv);

    const toolCallDiv = document.createElement('div');
    toolCallDiv.className = 'tool-call-message';
    toolCallDiv.dataset.toolCallId = 'tool-123';
    toolCallDiv.textContent = '🔧 使用工具: search';
    contentDiv.appendChild(toolCallDiv);

    container.appendChild(msgDiv);

    // Simulate assistant.tool_result event
    const toolResultData: any = {
      type: 'assistant.tool_result',
      sessionId: 'test-session',
      messageId: 'msg-1',
      toolCallId: 'tool-123',
      result: 'Search results found: 42 items',
    };

    chatManager.handleStream(toolResultData);

    // Verify result div was created
    const resultDiv = msgDiv.querySelector('.tool-result-message') as HTMLElement;
    expect(resultDiv).not.toBeNull();
    expect(resultDiv?.textContent).toBe('🔧 结果: Search results found: 42 items');
  });

  it('should truncate long result text', () => {
    const chatManager = new ChatManager();
    chatManager.messageContainer = container;
    chatManager.currentSessionId = 'test-session';

    const msgDiv = document.createElement('div');
    msgDiv.dataset.id = 'msg-2';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    msgDiv.appendChild(contentDiv);

    const toolCallDiv = document.createElement('div');
    toolCallDiv.className = 'tool-call-message';
    toolCallDiv.dataset.toolCallId = 'tool-456';
    toolCallDiv.textContent = '🔧 使用工具: search';
    contentDiv.appendChild(toolCallDiv);

    container.appendChild(msgDiv);

    // Create a long result (> 100 chars)
    const longResult = 'A'.repeat(150);

    const toolResultData: any = {
      type: 'assistant.tool_result',
      sessionId: 'test-session',
      messageId: 'msg-2',
      toolCallId: 'tool-456',
      result: longResult,
    };

    chatManager.handleStream(toolResultData);

    const resultDiv = msgDiv.querySelector('.tool-result-message') as HTMLElement;
    expect(resultDiv?.textContent).toHaveLength(100 + 3 + '🔧 结果: '.length); // 100 + "..." + prefix
    expect(resultDiv?.textContent).toContain('...');
  });

  it('should show "✅ 完成" when result is empty', () => {
    const chatManager = new ChatManager();
    chatManager.messageContainer = container;
    chatManager.currentSessionId = 'test-session';

    const msgDiv = document.createElement('div');
    msgDiv.dataset.id = 'msg-3';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    msgDiv.appendChild(contentDiv);

    const toolCallDiv = document.createElement('div');
    toolCallDiv.className = 'tool-call-message';
    toolCallDiv.dataset.toolCallId = 'tool-789';
    toolCallDiv.textContent = '🔧 使用工具: navigate';
    contentDiv.appendChild(toolCallDiv);

    container.appendChild(msgDiv);

    const toolResultData: any = {
      type: 'assistant.tool_result',
      sessionId: 'test-session',
      messageId: 'msg-3',
      toolCallId: 'tool-789',
      result: '',
    };

    chatManager.handleStream(toolResultData);

    const resultDiv = msgDiv.querySelector('.tool-result-message') as HTMLElement;
    expect(resultDiv?.textContent).toBe('🔧 结果: ✅ 完成');
  });

  it('should silently ignore orphan tool_result (no matching toolCallId)', () => {
    const chatManager = new ChatManager();
    chatManager.messageContainer = container;
    chatManager.currentSessionId = 'test-session';

    const msgDiv = document.createElement('div');
    msgDiv.dataset.id = 'msg-4';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    msgDiv.appendChild(contentDiv);

    // No tool_call div with matching toolCallId
    container.appendChild(msgDiv);

    const toolResultData: any = {
      type: 'assistant.tool_result',
      sessionId: 'test-session',
      messageId: 'msg-4',
      toolCallId: 'non-existent-tool',
      result: 'Some result',
    };

    // Should not throw
    expect(() => {
      chatManager.handleStream(toolResultData);
    }).not.toThrow();

    // Should not create result div
    const resultDiv = msgDiv.querySelector('.tool-result-message');
    expect(resultDiv).toBeNull();
  });

  it('should silently ignore tool_result without toolCallId', () => {
    const chatManager = new ChatManager();
    chatManager.messageContainer = container;
    chatManager.currentSessionId = 'test-session';

    const msgDiv = document.createElement('div');
    msgDiv.dataset.id = 'msg-5';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    msgDiv.appendChild(contentDiv);

    container.appendChild(msgDiv);

    const toolResultData: any = {
      type: 'assistant.tool_result',
      sessionId: 'test-session',
      messageId: 'msg-5',
      // No toolCallId
      result: 'Some result',
    };

    // Should not throw
    expect(() => {
      chatManager.handleStream(toolResultData);
    }).not.toThrow();

    // Should not create result div
    const resultDiv = msgDiv.querySelector('.tool-result-message');
    expect(resultDiv).toBeNull();
  });

  it('should insert result div after matching tool_call div', () => {
    const chatManager = new ChatManager();
    chatManager.messageContainer = container;
    chatManager.currentSessionId = 'test-session';

    const msgDiv = document.createElement('div');
    msgDiv.dataset.id = 'msg-6';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    msgDiv.appendChild(contentDiv);

    const toolCallDiv = document.createElement('div');
    toolCallDiv.className = 'tool-call-message';
    toolCallDiv.dataset.toolCallId = 'tool-abc';
    toolCallDiv.textContent = '🔧 使用工具: click';
    contentDiv.appendChild(toolCallDiv);

    // Add another element after tool_call
    const otherDiv = document.createElement('div');
    otherDiv.textContent = 'Other content';
    contentDiv.appendChild(otherDiv);

    container.appendChild(msgDiv);

    const toolResultData: any = {
      type: 'assistant.tool_result',
      sessionId: 'test-session',
      messageId: 'msg-6',
      toolCallId: 'tool-abc',
      result: 'Clicked successfully',
    };

    chatManager.handleStream(toolResultData);

    const resultDiv = msgDiv.querySelector('.tool-result-message') as HTMLElement;
    expect(resultDiv).not.toBeNull();

    // Verify order: tool_call -> result -> other
    const children = Array.from(contentDiv.children);
    const toolCallIndex = children.indexOf(toolCallDiv);
    const resultIndex = children.indexOf(resultDiv!);
    const otherIndex = children.indexOf(otherDiv);

    expect(toolCallIndex).toBeLessThan(resultIndex);
    expect(resultIndex).toBeLessThan(otherIndex);
  });
});
