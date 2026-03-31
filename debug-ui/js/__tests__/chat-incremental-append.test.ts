/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatManager as ChatManagerType } from '../chat.js';

vi.mock('../ui.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  updateStatus: vi.fn(),
}));

function setupDom(): void {
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
    <div id="screenshot-preview"><img /></div>
  `;
}

function createResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe('ChatManager incremental append behavior', () => {
  let ChatManagerClass: typeof ChatManagerType;
  let manager: ChatManagerType;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    setupDom();
    localStorage.clear();

    class MockEventSource {
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      addEventListener = vi.fn();
      close = vi.fn();
      constructor(_url: string) {}
    }

    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', vi.fn(async () => createResponse([])));

    const chatModule = await import('../chat.js');
    ChatManagerClass = chatModule.ChatManager;
    manager = new ChatManagerClass();
    manager.currentSessionId = 'session-1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sendMessage appends optimistic message without wiping existing DOM nodes', () => {
    manager.handleStream({
      type: 'session.snapshot',
      sessionId: 'session-1',
      state: 'idle',
      messages: [
        { id: 'm1', role: 'assistant', content: 'old-1', created_at: '1000' },
        { id: 'm2', role: 'assistant', content: 'old-2', created_at: '2000' },
      ],
    });

    const container = document.getElementById('chat-messages') as HTMLElement;
    const firstNodeBefore = container.children[0];
    const countBefore = container.children.length;
    const input = document.getElementById('chat-input') as HTMLInputElement;
    input.value = 'new-message';

    const sendHttpSpy = vi
      .spyOn(
        manager as unknown as {
          sendChatMessageHTTP: (sessionId: string, message: string, screenshot?: string | null) => Promise<void>;
        },
        'sendChatMessageHTTP'
      )
      .mockResolvedValue(undefined);

    manager.sendMessage();

    expect(sendHttpSpy).toHaveBeenCalledTimes(1);
    expect(container.children.length).toBe(countBefore + 1);
    expect(container.children[0]).toBe(firstNodeBefore);
    expect(container.lastElementChild?.getAttribute('data-id')).toMatch(/^temp-/);
    expect(container.textContent).toContain('new-message');
  });

  it('chat_stream_start appends assistant message without full re-render', () => {
    manager.handleStream({
      type: 'session.snapshot',
      sessionId: 'session-1',
      state: 'idle',
      messages: [
        { id: 'm1', role: 'assistant', content: 'seed-1', created_at: '1000' },
        { id: 'm2', role: 'assistant', content: 'seed-2', created_at: '2000' },
      ],
    });

    const container = document.getElementById('chat-messages') as HTMLElement;
    const firstNodeBefore = container.children[0];
    const countBefore = container.children.length;

    manager.handleStream({
      type: 'assistant.started',
      sessionId: 'session-1',
      messageId: 'assistant-1',
    });

    expect(container.children.length).toBe(countBefore + 1);
    expect(container.children[0]).toBe(firstNodeBefore);
    expect(container.querySelector('[data-id="assistant-1"]')).not.toBeNull();
  });

  it('keeps both optimistic messages in DOM when sending rapidly', () => {
    const input = document.getElementById('chat-input') as HTMLInputElement;
    const container = document.getElementById('chat-messages') as HTMLElement;

    const sendHttpSpy = vi
      .spyOn(
        manager as unknown as {
          sendChatMessageHTTP: (sessionId: string, message: string, screenshot?: string | null) => Promise<void>;
        },
        'sendChatMessageHTTP'
      )
      .mockResolvedValue(undefined);

    let now = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 1;
      return now;
    });

    input.value = 'first';
    manager.sendMessage();
    input.value = 'second';
    manager.sendMessage();

    const userMessages = Array.from(container.querySelectorAll('.chat-message.user')) as HTMLElement[];
    expect(sendHttpSpy).toHaveBeenCalledTimes(2);
    expect(userMessages.length).toBe(2);
    expect(userMessages.map((el) => el.dataset.id || '')).toEqual([
      expect.stringMatching(/^temp-/),
      expect.stringMatching(/^temp-/),
    ]);
    expect(container.textContent).toContain('first');
    expect(container.textContent).toContain('second');
  });
});
