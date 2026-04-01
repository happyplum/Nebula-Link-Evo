import { beforeEach, describe, expect, it, vi } from 'vitest';

function createResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function setupChatDom(): void {
  document.body.innerHTML = `
    <div id="notificationContainer"></div>
    <div id="chat-left-pane"></div>
    <div id="chat-messages"></div>
    <select id="session-select"></select>
    <input id="chat-input" />
    <input id="cot-toggle" type="checkbox" />
    <button id="interrupt-btn"></button>
    <button id="pause-btn"></button>
    <button id="resume-btn"></button>
    <button id="cancel-btn"></button>
    <div id="chat-control-bar"></div>
    <div id="pausing-feedback" class="hidden"></div>
    <div id="screenshot-preview"><img /></div>
  `;
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, Function[]> = {};
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: Function) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }
  close(): void {}
}

describe('Chat SSE lastEventId 验证', () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    setupChatDom();

    MockEventSource.instances = [];

    vi.useFakeTimers();

    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        if (url === '/api/chat/sessions') {
          return createResponse([{ id: 's1', title: 'Session 1', createdAt: 1000, status: 'idle' }]);
        }
        if (url === '/api/chat/sessions/s1') {
          return createResponse({ id: 's1', status: 'idle' });
        }
        if (url === '/api/chat/sessions/s1/messages' && init?.method === 'POST') {
          return createResponse({ success: true }, true, 202);
        }
        if (url.startsWith('/api/chat/sessions/s1/messages?')) {
          return createResponse([]);
        }
        return createResponse({});
      })
    );

    await import('../chat.js');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('应该保留并发送数字格式的 lastEventId', async () => {
    const manager = window.chatManager!;

    // Simulate a numeric lastEventId being stored from an SSE event
    localStorage.setItem('sse_lastEventId_s1', '42');
    const state = (manager as any).ensureSessionState('s1');
    state.lastEventId = '42';

    // Simulate reconnection (allowResume=true) by calling initSSE directly
    MockEventSource.instances = [];
    (manager as any).initSSE('s1', true);

    expect(MockEventSource.instances.length).toBe(1);
    const esUrl = new URL(MockEventSource.instances[0].url);
    expect(esUrl.searchParams.get('lastEventId')).toBe('42');
  });

  it('应该清除并发送空字符串当 lastEventId 为非数字格式', async () => {
    const manager = window.chatManager!;

    // Simulate a non-numeric lastEventId being stored (e.g., from a bug)
    localStorage.setItem('sse_lastEventId_s1', 'event-42');
    const state = (manager as any).ensureSessionState('s1');
    state.lastEventId = 'event-42';

    // Simulate reconnection (allowResume=true) by calling initSSE directly
    MockEventSource.instances = [];
    (manager as any).initSSE('s1', true);

    expect(MockEventSource.instances.length).toBe(1);
    const esUrl = new URL(MockEventSource.instances[0].url);
    expect(esUrl.searchParams.get('lastEventId')).toBeNull();
    expect(localStorage.getItem('sse_lastEventId_s1')).toBeNull();
  });

  it('不应该发送空的 lastEventId', async () => {
    const manager = window.chatManager!;

    // Ensure no lastEventId is stored
    localStorage.removeItem('sse_lastEventId_s1');
    const state = (manager as any).ensureSessionState('s1');
    state.lastEventId = '';

    // Simulate reconnection (allowResume=true) by calling initSSE directly
    MockEventSource.instances = [];
    (manager as any).initSSE('s1', true);

    expect(MockEventSource.instances.length).toBe(1);
    const esUrl = new URL(MockEventSource.instances[0].url);
    expect(esUrl.searchParams.get('lastEventId')).toBeNull();
  });
});
