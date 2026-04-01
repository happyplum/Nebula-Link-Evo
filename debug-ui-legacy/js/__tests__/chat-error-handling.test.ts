/**
 * Tests for chat.ts error handling — API errors (429/503/timeout/non-JSON) and SSE reconnection UX.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ui.ts exports before importing ChatManager
vi.mock('../ui.js', () => ({
  showError: vi.fn(),
  showWarning: vi.fn(),
  showSuccess: vi.fn(),
  showNotification: vi.fn(),
  updateStatus: vi.fn(),
}));

import { showError, showWarning, updateStatus } from '../ui.js';
import { ChatManager } from '../chat.js';

// Minimal DOM shell required by ChatManager constructor
function setupDOM(): void {
  document.body.innerHTML = `
    <div id="chat-messages"></div>
    <div id="chat-left-pane"></div>
    <select id="session-select"></select>
    <input id="chat-input" />
    <div id="notificationContainer"></div>
    <button id="interrupt-btn"></button>
    <button id="pause-btn"></button>
    <button id="resume-btn"></button>
    <button id="cancel-btn"></button>
    <div id="chat-control-bar"></div>
  `;
}

function mockFetchResponse(status: number, body: unknown, contentType = 'application/json'): Response {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(bodyStr, {
    status,
    headers: { 'Content-Type': contentType },
  });
}

describe('ChatManager API error handling', () => {
  let manager: ChatManager;

  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    manager = new ChatManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('429 response triggers showWarning', async () => {
    const fetchMock = vi.mocked(fetch);
    // loadSessions fetch → 429
    fetchMock.mockResolvedValueOnce(mockFetchResponse(429, { error: 'Rate limited' }));

    await manager.loadSessions();

    expect(showWarning).toHaveBeenCalledWith('请求过于频繁，请稍后再试');
  });

  it('503 response triggers showError', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(503, { error: 'Unavailable' }));

    await manager.loadSessions();

    expect(showError).toHaveBeenCalledWith('服务暂时不可用，请稍后再试');
  });

  it('500 with HTML body does not crash (no unhandled rejection)', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(500, '<html>Server Error</html>', 'text/html')
    );

    // Should resolve without throwing
    await expect(manager.loadSessions()).resolves.toBeUndefined();
    // showError called for the general load failure
    expect(showError).toHaveBeenCalled();
  });

  it('non-JSON body on error response yields fallback error object', async () => {
    const fetchMock = vi.mocked(fetch);
    // First call: interrupt returns non-OK with HTML body
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(500, '<html>Error</html>', 'text/html')
    );
    manager.currentSessionId = 'test-session';

    await (manager as any).interruptSession();

    // Should not crash — safeJsonResponse catches JSON parse failure
    // and returns { error: 'HTTP 500' }
    expect(showError).toHaveBeenCalledWith('打断失败：HTTP 500');
  });
});

describe('ChatManager sendChatMessageHTTP timeout', () => {
  let manager: ChatManager;

  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    manager = new ChatManager();
    manager.currentSessionId = 'test-session';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AbortError shows timeout message', async () => {
    const fetchMock = vi.mocked(fetch);
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    fetchMock.mockRejectedValueOnce(abortError);

    // Access private method via bracket notation
    await (manager as any).sendChatMessageHTTP('test-session', 'hello');

    expect(showError).toHaveBeenCalledWith('请求超时，请检查网络连接后重试');
  });
});

describe('SSE reconnection UX indicators', () => {
  let manager: ChatManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockEventSource: any;

  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());

    mockEventSource = null;

    vi.stubGlobal('EventSource', vi.fn(function(this: any) {
      this.onopen = null;
      this.onerror = null;
      this.onmessage = null;
      this.close = vi.fn();
      this.addEventListener = vi.fn();
      mockEventSource = this;
    }));

    manager = new ChatManager();
    manager.currentSessionId = 'sse-test-session';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SSE onerror triggers updateStatus with reconnecting state', async () => {
    const fetchMock = vi.mocked(fetch);
    // switchSession fetch for session details
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(200, { status: 'idle' })
    );

    // Trigger SSE initialization
    await manager.switchSession('sse-test-session');

    // Simulate SSE error
    mockEventSource.onerror();

    expect(updateStatus).toHaveBeenCalledWith(false, 'reconnecting', 'SSE 重连中...');
  });

  it('SSE onopen triggers updateStatus with connected state', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(200, { status: 'idle' })
    );

    await manager.switchSession('sse-test-session');

    // Simulate SSE open
    mockEventSource.onopen();

    expect(updateStatus).toHaveBeenCalledWith(true, 'connected', 'SSE 已连接');
  });
});
