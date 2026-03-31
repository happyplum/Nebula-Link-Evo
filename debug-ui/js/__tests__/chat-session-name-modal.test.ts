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

describe('Chat Session Name Modal', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    setupChatDom();

    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      
      if (url === '/api/config') {
        return createResponse({ decision: { provider: 'test-provider', model: 'test-model' } });
      }
      if (url === '/api/chat/sessions' && init?.method === 'POST') {
        return createResponse({ id: 'new-session-id' });
      }
      if (url === '/api/chat/sessions') {
        return createResponse([{ id: 's1', title: 'Session 1', createdAt: 1000, status: 'idle' }]);
      }
      if (url === '/api/chat/sessions/new-session-id') {
        return createResponse({ id: 'new-session-id', status: 'idle' });
      }
      if (url.startsWith('/api/chat/sessions/new-session-id/messages?')) {
        return createResponse([]);
      }
      return createResponse({});
    });

    vi.stubGlobal('fetch', fetchMock);

    // Mock EventSource
    class MockEventSource {
      constructor() {}
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal('EventSource', MockEventSource);

    await import('../chat.js');
  });

  it('createSession(title) uses provided title directly without modal', async () => {
    const manager = window.chatManager!;
    await manager.createSession('test-name');

    const postCall = fetchMock.mock.calls.find((call: unknown[]) => 
      call[0] === '/api/chat/sessions' && (call[1] as RequestInit)?.method === 'POST'
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.title).toBe('test-name');
    
    // Ensure no modal was created
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('createSession() shows modal and uses entered name', async () => {
    const manager = window.chatManager!;
    
    // Start createSession, which will await the modal
    const createPromise = manager.createSession();
    
    // Wait a tick for the modal to be rendered
    await new Promise(resolve => setTimeout(resolve, 0));
    
    const overlay = document.querySelector('.modal-overlay');
    expect(overlay).not.toBeNull();
    
    const input = overlay!.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    
    // Type a new name
    input.value = 'My Custom Session';
    
    // Click OK
    const okBtn = overlay!.querySelector('button.primary') as HTMLButtonElement;
    okBtn.click();
    
    await createPromise;
    
    const postCall = fetchMock.mock.calls.find((call: unknown[]) => 
      call[0] === '/api/chat/sessions' && (call[1] as RequestInit)?.method === 'POST'
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.title).toBe('My Custom Session');
    
    // Modal should be removed
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('createSession() uses default name when modal is cancelled', async () => {
    const manager = window.chatManager!;
    
    const createPromise = manager.createSession();
    
    await new Promise(resolve => setTimeout(resolve, 0));
    
    const overlay = document.querySelector('.modal-overlay');
    expect(overlay).not.toBeNull();
    
    // Click Cancel
    const cancelBtn = Array.from(overlay!.querySelectorAll('button')).find(b => b.textContent === '取消') as HTMLButtonElement;
    cancelBtn.click();
    
    await createPromise;
    
    const postCall = fetchMock.mock.calls.find((call: unknown[]) => 
      call[0] === '/api/chat/sessions' && (call[1] as RequestInit)?.method === 'POST'
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.title).toMatch(/^新会话 /); // Should start with default prefix
    
    // Modal should be removed
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });
});