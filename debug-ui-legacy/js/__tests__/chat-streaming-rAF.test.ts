/**
 * Tests for streaming token rAF batching and stream state tracking in chat.ts.
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

function createResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

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
  `;
}

function createInnerHtmlWriteTracker(target: HTMLElement): { getWrites: () => number; restore: () => void } {
  const descriptor =
    Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')
    ?? Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerHTML');

  if (!descriptor?.get || !descriptor?.set) {
    throw new Error('innerHTML descriptor is unavailable in this environment');
  }

  let writes = 0;
  Object.defineProperty(target, 'innerHTML', {
    configurable: true,
    get() {
      return descriptor.get!.call(target) as string;
    },
    set(value: string) {
      writes += 1;
      descriptor.set!.call(target, value);
    },
  });

  return {
    getWrites: () => writes,
    restore: () => {
      delete (target as unknown as Record<string, unknown>).innerHTML;
    },
  };
}

describe('ChatManager streaming rAF batching', () => {
  let ChatManagerClass: typeof ChatManagerType;
  let manager: ChatManagerType;
  let rafQueue: FrameRequestCallback[];

  beforeEach(async () => {
    vi.resetModules();
    setupDom();
    vi.clearAllMocks();
    vi.useFakeTimers();

    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    }));
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
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('tracks isStreaming during stream lifecycle', () => {
    expect(manager.isStreaming).toBe(false);

    manager.handleStream({
      type: 'assistant.started',
      sessionId: 'session-1',
      messageId: 'msg-stream-state',
    });
    expect(manager.isStreaming).toBe(true);

    manager.handleStream({
      type: 'assistant.completed',
      sessionId: 'session-1',
      messageId: 'msg-stream-state',
    });
    expect(manager.isStreaming).toBe(false);
  });

  it('batches token DOM writes into a single rAF update', () => {
    const messageId = 'msg-raf-batch';
    manager.handleStream({
      type: 'assistant.started',
      sessionId: 'session-1',
      messageId,
    });

    const msgDiv = document.querySelector(`[data-id="${messageId}"]`) as HTMLElement;
    const contentDiv = msgDiv.querySelector('.msg-content') as HTMLElement;
    const tracker = createInnerHtmlWriteTracker(contentDiv);

    manager.handleStream({ type: 'assistant.delta', sessionId: 'session-1', messageId, text: 'A' });
    manager.handleStream({ type: 'assistant.delta', sessionId: 'session-1', messageId, text: 'B' });
    manager.handleStream({ type: 'assistant.delta', sessionId: 'session-1', messageId, text: 'C' });
    manager.handleStream({ type: 'assistant.delta', sessionId: 'session-1', messageId, text: 'D' });
    manager.handleStream({ type: 'assistant.delta', sessionId: 'session-1', messageId, text: 'E' });

    expect(contentDiv.innerHTML).toBe('');
    expect(tracker.getWrites()).toBe(0);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    const pending = rafQueue.shift();
    expect(pending).toBeTypeOf('function');
    pending?.(16);

    expect(contentDiv.innerHTML).toBe('ABCDE');
    expect(tracker.getWrites()).toBe(1);

    tracker.restore();
  });

  it('flushes pending content immediately on stream end', () => {
    const messageId = 'msg-raf-end-flush';
    manager.handleStream({
      type: 'assistant.started',
      sessionId: 'session-1',
      messageId,
    });

    const msgDiv = document.querySelector(`[data-id="${messageId}"]`) as HTMLElement;
    const contentDiv = msgDiv.querySelector('.msg-content') as HTMLElement;

    manager.handleStream({ type: 'assistant.delta', sessionId: 'session-1', messageId, text: 'Hello' });
    manager.handleStream({ type: 'assistant.delta', sessionId: 'session-1', messageId, text: ' world' });

    expect(contentDiv.innerHTML).toBe('');
    expect(rafQueue.length).toBe(1);

    manager.handleStream({
      type: 'assistant.completed',
      sessionId: 'session-1',
      messageId,
    });

    expect(contentDiv.innerHTML).toBe('Hello world');
  });
});
