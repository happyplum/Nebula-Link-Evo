import { beforeEach, describe, expect, it, vi } from 'vitest';

type ChatManager = {
  currentSessionId: string | null;
  sessions: any[];
  loadSessions: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
};

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

describe('Chat 会话自动加载行为', () => {
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

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    setupChatDom();

    MockEventSource.instances = [];

    vi.stubGlobal('EventSource', MockEventSource);

    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === '/api/chat/sessions') {
        return createResponse([
          { id: 's1', title: 'Session 1', createdAt: 1000, status: 'idle' },
          { id: 's2', title: 'Session 2', createdAt: 2000, status: 'idle' },
        ]);
      }
      if (url === '/api/chat/sessions/s1') {
        return createResponse({ id: 's1', status: 'idle' });
      }
      if (url === '/api/chat/sessions/s2') {
        return createResponse({ id: 's2', status: 'idle' });
      }
      if (url.startsWith('/api/chat/sessions/') && url.includes('/messages')) {
        return createResponse([]);
      }
      return createResponse({});
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  async function createManager(): Promise<ChatManager> {
    await import('../chat.js');
    return window.chatManager!;
  }

  it('loadSessions() 初始化时自动选择并加载第一个会话', async () => {
    const manager = await createManager();

    // 第一个会话应被自动选中
    expect(manager.currentSessionId).toBe('s1');

    // Session select 应显示选中的会话
    const sessionSelect = document.getElementById('session-select') as HTMLSelectElement;
    expect(sessionSelect.value).toBe('s1');

    // 应创建 SSE 连接
    const latestUrl = MockEventSource.instances[MockEventSource.instances.length - 1]?.url || '';
    expect(latestUrl).toContain('/api/chat/sessions/s1/stream');
  });

  it('loadSessions() 不会重新加载已选中的会话', async () => {
    const manager = await createManager();

    // 手动切换到第二个会话
    await manager.switchSession('s2');
    const initialCount = MockEventSource.instances.length;

    // 调用 loadSessions() - 不应重新调用 switchSession
    await manager.loadSessions();

    // currentSessionId 应保持为 s2
    expect(manager.currentSessionId).toBe('s2');

    // Session select 应显示 s2
    const sessionSelect = document.getElementById('session-select') as HTMLSelectElement;
    expect(sessionSelect.value).toBe('s2');

    // 不应创建新的 SSE 连接（数量不变）
    expect(MockEventSource.instances.length).toBe(initialCount);
  });

  it('空会话列表不会触发自动加载', async () => {
    // Reset modules and setup for this test
    vi.resetModules();
    MockEventSource.instances = [];
    setupChatDom();

    // Mock fetch to return empty sessions
    const emptyFetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === '/api/chat/sessions') {
        return createResponse([]);
      }
      return createResponse({});
    });

    vi.stubGlobal('fetch', emptyFetchMock);
    vi.stubGlobal('EventSource', MockEventSource);

    const manager = await createManager();

    // currentSessionId 应保持为 null
    expect(manager.currentSessionId).toBeNull();

    // Session select 应为空
    const sessionSelect = document.getElementById('session-select') as HTMLSelectElement;
    expect(sessionSelect.value).toBe('');

    // 不应创建 SSE 连接
    expect(MockEventSource.instances.length).toBe(0);
  });
});
