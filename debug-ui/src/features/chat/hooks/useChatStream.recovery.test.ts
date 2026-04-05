import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/features/chat/store/chat.store.js';

import { useChatStream } from './useChatStream.js';

interface MockESInstance {
  url: string;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  listeners: Map<string, Set<(e: MessageEvent) => void>>;
  close: ReturnType<typeof vi.fn>;
  emit: (type: string, data: unknown) => void;
}

let mockEs: MockESInstance;

function createES(url: string): MockESInstance {
  const es: MockESInstance = {
    url,
    onopen: null,
    onerror: null,
    listeners: new Map(),
    close: vi.fn(),
    emit(type: string, data: unknown) {
      const handlers = this.listeners.get(type);
      if (!handlers) return;
      const event = new MessageEvent(type, { data: JSON.stringify(data) });
      for (const handler of handlers) handler(event);
    },
  };
  mockEs = es;
  return es;
}

beforeEach(() => {
  vi.useFakeTimers();
  useChatStore.getState().reset();
  mockEs = null as unknown as MockESInstance;

  const Ctor = function (url: string) {
    const es = createES(url);
    const anyEs = es as unknown as { addEventListener: unknown; close: unknown };
    anyEs.addEventListener = (type: string, handler: (e: MessageEvent) => void) => {
      if (!es.listeners.has(type)) es.listeners.set(type, new Set());
      es.listeners.get(type)!.add(handler);
    };
    anyEs.close = es.close;
    return es;
  };

  Object.assign(Ctor, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
  vi.stubGlobal('EventSource', Ctor);
});

function renderStream(sessionId: string | null, opts?: { enabled?: boolean }) {
  return renderHook(
    (props: { sessionId: string | null; enabled?: boolean }) => useChatStream(props),
    {
      initialProps: {
        sessionId,
        enabled: true,
        ...opts,
      },
    }
  );
}

function open() {
  act(() => mockEs.onopen?.(new Event('open')));
}

function emit(type: string, data: unknown) {
  act(() => mockEs.emit(type, data));
}

describe('useChatStream recovery', () => {
  it('always connects to the bare stream URL', () => {
    renderStream('s1');
    expect(mockEs.url).toBe('/api/chat/sessions/s1/stream');
  });

  it('reconnects to the same bare stream URL after error', () => {
    renderStream('s1');
    open();

    act(() => {
      mockEs.onerror?.(new Event('error'));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockEs.url).toBe('/api/chat/sessions/s1/stream');
  });

  it('replaces stale in-memory messages with snapshot on reconnect', () => {
    renderStream('s1');
    open();

    emit('session.snapshot', {
      type: 'session.snapshot',
      sessionId: 's1',
      seq: 0,
      messages: [{ id: 'm-old', role: 'user', content: 'old', created_at: '2026-01-01' }],
      state: 'idle',
    });

    act(() => {
      mockEs.onerror?.(new Event('error'));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    open();
    emit('session.snapshot', {
      type: 'session.snapshot',
      sessionId: 's1',
      seq: 0,
      messages: [
        { id: 'm-new', role: 'assistant', content: 'new snapshot', created_at: '2026-01-02' },
      ],
      state: 'running',
    });

    const messages = useChatStore.getState().messagesBySession['s1'];
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('m-new');
    expect(useChatStore.getState().streamingState).toBe('idle');
  });

  it('applies live events after reconnect snapshot', () => {
    renderStream('s1');
    open();

    act(() => {
      mockEs.onerror?.(new Event('error'));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    open();
    emit('session.snapshot', {
      type: 'session.snapshot',
      sessionId: 's1',
      seq: 0,
      messages: [],
      state: 'running',
    });
    emit('assistant.started', {
      type: 'assistant.started',
      sessionId: 's1',
      seq: 1,
      messageId: 'a1',
    });
    emit('assistant.delta', {
      type: 'assistant.delta',
      sessionId: 's1',
      seq: 2,
      messageId: 'a1',
      text: 'hello after reconnect',
    });

    expect(useChatStore.getState().streamingState).toBe('streaming');
    expect(useChatStore.getState().streamingContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(useChatStore.getState().streamingContent).toBe('hello after reconnect');
  });

  it('disconnects old session and opens a new bare stream URL on session switch', () => {
    const { rerender } = renderStream('s1');
    open();
    const oldEs = mockEs;

    rerender({ sessionId: 's2', enabled: true });

    expect(oldEs.close).toHaveBeenCalled();
    expect(mockEs.url).toBe('/api/chat/sessions/s2/stream');
  });
});
