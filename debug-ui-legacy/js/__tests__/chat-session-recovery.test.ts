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

describe('Chat 会话恢复与合并规则', () => {
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

  it('切换会话时先初始化状态并强制走快照流', async () => {
    localStorage.setItem('sse_lastEventId_s1', '42');
    const manager = window.chatManager!;
    await manager.switchSession('s1');
    const MockEventSourceClass = EventSource as unknown as { instances: Array<{ url: string }> };
    const latestUrl = MockEventSourceClass.instances[MockEventSourceClass.instances.length - 1]?.url || '';
    expect(latestUrl).toContain('/api/chat/sessions/s1/stream');
    expect(latestUrl).not.toContain('lastEventId=42');
  });

  it('message.created 会替换乐观消息且不重复', async () => {
    const manager = window.chatManager!;
    await manager.switchSession('s1');
    const input = document.getElementById('chat-input') as HTMLInputElement;
    input.value = 'hello';
    manager.sendMessage();
    manager.handleStream({
      type: 'message.created',
      sessionId: 's1',
      messageId: 'user-1',
      role: 'user',
      content: 'hello',
    });
    const messages = Array.from(document.querySelectorAll('#chat-messages .chat-message'));
    expect(messages.length).toBe(1);
    expect(messages[0].getAttribute('data-id')).toBe('user-1');
  });

  it('快照与增量事件按统一规则去重并保持时间顺序', async () => {
    const manager = window.chatManager!;
    await manager.switchSession('s1');
    manager['handleSSEMessage']({
      lastEventId: '0',
      data: JSON.stringify({
        type: 'session.snapshot',
        sessionId: 's1',
        messages: [
          { id: 'm2', role: 'assistant', content: 'later', created_at: '2000' },
          { id: 'm1', role: 'user', content: 'earlier', created_at: '1000' },
        ],
        state: 'idle',
      })
    } as MessageEvent<string>);
    manager.handleStream({
      type: 'message.created',
      sessionId: 's1',
      messageId: 'm1',
      role: 'user',
      content: 'earlier',
    });
    const ids = Array.from(document.querySelectorAll('#chat-messages .chat-message')).map((node) => node.getAttribute('data-id'));
    expect(ids).toEqual(['m1', 'm2']);
  });

  it('先到 token 再到 started 时不会丢失内容', async () => {
    const manager = window.chatManager!;
    await manager.switchSession('s1');
    manager.handleStream({
      type: 'assistant.delta',
      sessionId: 's1',
      messageId: 'a1',
      text: '你好',
    });
    manager.handleStream({
      type: 'assistant.started',
      sessionId: 's1',
      messageId: 'a1',
    });
    const message = document.querySelector('#chat-messages .chat-message[data-id="a1"] .msg-content');
    expect(message?.innerHTML).toContain('你好');
  });
});
