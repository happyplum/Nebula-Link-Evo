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

describe('Chat snapshot preserves thinking field', () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    setupChatDom();

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

  it('snapshot with thinking field preserves it in merged messages', async () => {
    const manager = window.chatManager!;
    await manager.switchSession('s1');

    // Simulate receiving a session.snapshot event with thinking field
    manager['handleSSEMessage']({
      lastEventId: '0',
      data: JSON.stringify({
        type: 'session.snapshot',
        sessionId: 's1',
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: 'Hello',
            thinking: 'Thinking: I should say hello',
            created_at: '1000',
          },
        ],
        state: 'idle',
      })
    } as MessageEvent<string>);

    // Access the internal session state to verify thinking is preserved
    const state = manager['sessionState'].get('s1');
    expect(state?.messages).toBeDefined();
    expect(state?.messages[0].thinking).toBe('Thinking: I should say hello');
  });

  it('snapshot without thinking field sets thinking to undefined', async () => {
    const manager = window.chatManager!;
    await manager.switchSession('s1');

    // Simulate receiving a session.snapshot event without thinking field
    manager['handleSSEMessage']({
      lastEventId: '0',
      data: JSON.stringify({
        type: 'session.snapshot',
        sessionId: 's1',
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: 'Hello',
            created_at: '1000',
          },
        ],
        state: 'idle',
      })
    } as MessageEvent<string>);

    // Access the internal session state to verify thinking is undefined
    const state = manager['sessionState'].get('s1');
    expect(state?.messages).toBeDefined();
    expect(state?.messages[0].thinking).toBeUndefined();
  });
});
