import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/features/chat/store/chat.store.js';

import { useChatStream } from './useChatStream.js';

// --- EventSource mock (shared with core test) ---
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
      for (const h of handlers) h(event);
    },
  };
  mockEs = es;
  return es;
}

beforeEach(() => {
  vi.useFakeTimers();
  useChatStore.getState().reset();
  localStorage.clear();
  mockEs = null as unknown as MockESInstance;

  const Ctor = function (url: string) {
    const es = createES(url);
    const anyEs = es as unknown as { addEventListener: unknown; close: unknown };
    anyEs.addEventListener = (
      type: string,
      handler: (e: MessageEvent) => void,
    ) => {
      if (!es.listeners.has(type)) es.listeners.set(type, new Set());
      es.listeners.get(type)!.add(handler);
    };
    anyEs.close = es.close;
    return es;
  };
  Object.assign(Ctor, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
  vi.stubGlobal('EventSource', Ctor);
});

// --- Helpers ---
function renderStream(
  sessionId: string | null,
  opts?: { enabled?: boolean; allowResume?: boolean },
) {
  return renderHook(
    (props: { sessionId: string | null; enabled?: boolean; allowResume?: boolean }) =>
      useChatStream(props),
    {
      initialProps: {
        sessionId,
        enabled: true,
        allowResume: true,
        ...opts,
      },
    },
  );
}

function open() {
  act(() => mockEs.onopen?.(new Event('open')));
}

function emit(type: string, data: unknown) {
  act(() => mockEs.emit(type, data));
}

describe('useChatStream recovery', () => {
  describe('lastEventId persistence', () => {
    it('stores seq as lastEventId in localStorage', () => {
      renderStream('s1');
      open();
      emit('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 42,
        messages: [],
        state: 'idle',
      });
      expect(localStorage.getItem('sse_lastEventId_s1')).toBe('42');
    });

    it('includes lastEventId in URL when localStorage has value', () => {
      localStorage.setItem('sse_lastEventId_s1', '15');

      renderStream('s1');
      expect(mockEs.url).toBe('/api/chat/sessions/s1/stream?lastEventId=15');
    });

    it('does not include lastEventId when localStorage is empty', () => {
      renderStream('s1');
      expect(mockEs.url).toBe('/api/chat/sessions/s1/stream');
    });

    it('updates lastEventId to highest seq seen', () => {
      renderStream('s1');
      open();
      emit('message.created', {
        type: 'message.created',
        sessionId: 's1',
        seq: 5,
        messageId: 'm1',
        content: 'hi',
      });
      emit('message.created', {
        type: 'message.created',
        sessionId: 's1',
        seq: 10,
        messageId: 'm2',
        content: 'there',
      });
      expect(localStorage.getItem('sse_lastEventId_s1')).toBe('10');
    });

    it('preserves lastEventId across reconnections', () => {
      const { result } = renderStream('s1');
      open();
      emit('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 20,
        messages: [],
        state: 'idle',
      });
      expect(localStorage.getItem('sse_lastEventId_s1')).toBe('20');

      // Trigger error → reconnect
      act(() => {
        mockEs.onerror?.(new Event('error'));
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // New ES should include lastEventId
      expect(mockEs.url).toContain('lastEventId=20');
    });
  });

  describe('session switch with allowResume=false', () => {
    it('clears lastEventId for new session when allowResume=false', () => {
      localStorage.setItem('sse_lastEventId_s2', '99');

      const { rerender } = renderStream('s1', { allowResume: false });

      // Switch to s2 — should clear s2's lastEventId
      rerender({ sessionId: 's2', enabled: true, allowResume: false });
      expect(localStorage.getItem('sse_lastEventId_s2')).toBeNull();
      // URL should NOT include lastEventId
      expect(mockEs.url).toBe('/api/chat/sessions/s2/stream');
    });

    it('preserves lastEventId when allowResume=true', () => {
      localStorage.setItem('sse_lastEventId_s2', '50');

      const { rerender } = renderStream('s1', { allowResume: true });

      rerender({ sessionId: 's2', enabled: true, allowResume: true });
      expect(localStorage.getItem('sse_lastEventId_s2')).toBe('50');
      expect(mockEs.url).toContain('lastEventId=50');
    });

    it('resets highestSeq on session switch', () => {
      const { rerender } = renderStream('s1');
      open();
      // Process event with seq=10 on s1
      emit('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 10,
        messages: [],
        state: 'idle',
      });

      // Switch to s2
      rerender({ sessionId: 's2', enabled: true, allowResume: true });
      open();

      // Send event with seq=5 on s2 — should NOT be deduplicated
      // (highestSeq reset to -1)
      emit('message.created', {
        type: 'message.created',
        sessionId: 's2',
        seq: 5,
        messageId: 'm1',
        content: 'fresh',
      });
      expect(useChatStore.getState().messagesBySession['s2']).toHaveLength(1);
    });

    it('disconnects old session on switch', () => {
      const { rerender } = renderStream('s1');
      open();
      const oldEs = mockEs;

      rerender({ sessionId: 's2', enabled: true, allowResume: true });

      expect(oldEs.close).toHaveBeenCalled();
      expect(mockEs).not.toBe(oldEs);
    });
  });

  describe('session switch to null', () => {
    it('disconnects when sessionId becomes null', () => {
      const { rerender } = renderStream('s1');
      open();

      rerender({ sessionId: null, enabled: true, allowResume: true });
      expect(mockEs.close).toHaveBeenCalled();
    });
  });

  describe('resume from lastEventId', () => {
    it('server replays events after stored lastEventId', () => {
      // Simulate: user was at seq=25, reconnects
      localStorage.setItem('sse_lastEventId_s1', '25');

      renderStream('s1');
      expect(mockEs.url).toContain('lastEventId=25');

      open();

      // Server sends snapshot starting after seq 25
      emit('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 26,
        messages: [
          { id: 'm1', role: 'user', content: 'replayed', created_at: '2026-01-01' },
        ],
        state: 'idle',
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('replayed');
    });

    it('ignores stale events with seq <= stored lastEventId', () => {
      localStorage.setItem('sse_lastEventId_s1', '25');

      renderStream('s1');
      open();

      // Stale event — should be ignored (dedup catches it)
      emit('message.created', {
        type: 'message.created',
        sessionId: 's1',
        seq: 20,
        messageId: 'm-old',
        content: 'stale',
      });

      expect(useChatStore.getState().messagesBySession['s1'] ?? []).toHaveLength(0);
    });
  });

  describe('reconnection preserves lastEventId', () => {
    it('reconnect URL includes last known lastEventId after error', () => {
      renderStream('s1');
      open();

      emit('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 30,
        messages: [],
        state: 'idle',
      });

      // Error → reconnect
      act(() => {
        mockEs.onerror?.(new Event('error'));
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(mockEs.url).toContain('lastEventId=30');
    });
  });
});
