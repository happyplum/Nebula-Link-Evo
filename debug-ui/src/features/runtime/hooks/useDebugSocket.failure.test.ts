import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';
import { useDebugSocket } from './useDebugSocket.js';

// --- WebSocket mock ---
let mockWsInstance: {
  url: string;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
};

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  readyState = 1;

  constructor(public url: string) {
    mockWsInstance = this;
  }
}

function createMessageEvent(data: unknown): MessageEvent {
  return new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
}

function createCloseEvent(): CloseEvent {
  return new CloseEvent('close');
}

function createErrorEvent(): Event {
  return new Event('error');
}

beforeEach(() => {
  vi.useFakeTimers();
  useRuntimeStore.getState().reset();
  mockWsInstance = null as unknown as typeof mockWsInstance;

  vi.stubGlobal(
    'WebSocket',
    Object.assign(function (url: string) {
      return new MockWebSocket(url);
    }, MockWebSocket),
  );
});

describe('useDebugSocket failure scenarios', () => {
  describe('invalid messages', () => {
    it('ignores non-JSON messages without crashing', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });
      act(() => {
        result.current.onMessage(handler);
      });

      act(() => {
        mockWsInstance.onmessage?.(new MessageEvent('message', { data: 'not-json' }));
      });

      // Handler should NOT be called for unparseable messages
      expect(handler).not.toHaveBeenCalled();
      // Store should remain in connected state
      expect(useRuntimeStore.getState().connectionStatus).toBe('connected');
    });

    it('ignores messages without type field', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });
      act(() => {
        result.current.onMessage(handler);
      });

      act(() => {
        mockWsInstance.onmessage?.(createMessageEvent({ foo: 'bar' }));
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores messages where type is not a string', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });
      act(() => {
        result.current.onMessage(handler);
      });

      act(() => {
        mockWsInstance.onmessage?.(createMessageEvent({ type: 42 }));
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('handles null message data', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });
      act(() => {
        result.current.onMessage(handler);
      });

      // JSON.parse(null) returns null in some environments, throws in others
      act(() => {
        mockWsInstance.onmessage?.(new MessageEvent('message', { data: null }));
      });

      // Should not crash regardless
      expect(useRuntimeStore.getState().connectionStatus).toBe('connected');
    });
  });

  describe('service_status edge cases', () => {
    it('handles service_status without playwright', () => {
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });

      act(() => {
        mockWsInstance.onmessage?.(
          createMessageEvent({
            type: 'service_status',
            services: { mcp: { enabled: true } },
          }),
        );
      });

      // Should not crash, playwright state stays default
      expect(useRuntimeStore.getState().playwrightIsOpen).toBe(false);
      expect(useRuntimeStore.getState().playwrightStatus).toBe('unknown');
    });

    it('handles service_status with partial playwright data', () => {
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });

      act(() => {
        mockWsInstance.onmessage?.(
          createMessageEvent({
            type: 'service_status',
            services: {
              playwright: { isOpen: true },
            },
          }),
        );
      });

      expect(useRuntimeStore.getState().playwrightIsOpen).toBe(true);
      // url and status not provided — should stay unchanged
      expect(useRuntimeStore.getState().playwrightUrl).toBeNull();
      expect(useRuntimeStore.getState().playwrightStatus).toBe('unknown');
    });

    it('handles service_status without services field', () => {
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });

      act(() => {
        mockWsInstance.onmessage?.(
          createMessageEvent({ type: 'service_status' }),
        );
      });

      expect(useRuntimeStore.getState().playwrightStatus).toBe('unknown');
    });
  });

  describe('WebSocket errors', () => {
    it('handles onerror without crashing', () => {
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });

      act(() => {
        mockWsInstance.onerror?.(createErrorEvent());
      });

      // Should still be connected until onclose fires
      expect(useRuntimeStore.getState().connectionStatus).toBe('connected');
    });

    it('onerror followed by onclose triggers reconnect', () => {
      renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });

      act(() => {
        mockWsInstance.onerror?.(createErrorEvent());
      });

      act(() => {
        mockWsInstance.onclose?.(createCloseEvent());
      });

      expect(useRuntimeStore.getState().connectionStatus).toBe('reconnecting');
      expect(useRuntimeStore.getState().reconnectAttempt).toBe(1);
    });
  });

  describe('sendMessage edge cases', () => {
    it('does nothing when socket is null', () => {
      const { result } = renderHook(() => useDebugSocket());
      // Force disconnect to null the socket
      act(() => {
        result.current.disconnect();
      });

      // sendMessage should silently fail
      act(() => {
        result.current.sendMessage('ping');
      });

      // No crash expected
    });

    it('handles send failure gracefully', () => {
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });

      mockWsInstance.send.mockImplementation(() => {
        throw new Error('Send failed');
      });

      // Should throw — caller's responsibility to handle
      expect(() => {
        result.current.sendMessage('ping');
      }).toThrow('Send failed');
    });
  });

  describe('reconnection edge cases', () => {
    it('does not reconnect when component is unmounted', () => {
      const { unmount } = renderHook(() => useDebugSocket());

      act(() => {
        mockWsInstance.onclose?.(createCloseEvent());
      });

      unmount();

      act(() => {
        vi.advanceTimersByTime(60000);
      });

      // Should not create new WebSocket after unmount
    });

    it('reconnect attempt resets after successful connection', () => {
      renderHook(() => useDebugSocket());

      // First close triggers reconnect
      act(() => {
        mockWsInstance.onclose?.(createCloseEvent());
      });
      expect(useRuntimeStore.getState().reconnectAttempt).toBe(1);

      // Advance timer to trigger reconnect
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // New connection opens
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });

      expect(useRuntimeStore.getState().reconnectAttempt).toBe(0);
      expect(useRuntimeStore.getState().connectionStatus).toBe('connected');
    });

    it('multiple disconnect calls are idempotent', () => {
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });

      act(() => {
        result.current.disconnect();
      });
      act(() => {
        result.current.disconnect();
      });

      expect(useRuntimeStore.getState().connectionStatus).toBe('disconnected');
    });
  });

  describe('handler management', () => {
    it('multiple handlers all receive messages', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });

      act(() => {
        result.current.onMessage(handler1);
        result.current.onMessage(handler2);
      });

      act(() => {
        mockWsInstance.onmessage?.(createMessageEvent({ type: 'ping' }));
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('adding same handler reference twice is deduplicated by Set', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useDebugSocket());
      act(() => {
        mockWsInstance.onopen?.(new Event('open'));
      });

      act(() => {
        result.current.onMessage(handler);
        result.current.onMessage(handler);
      });

      act(() => {
        mockWsInstance.onmessage?.(createMessageEvent({ type: 'ping' }));
      });

      // Set deduplicates — handler called once
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
