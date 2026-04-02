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

const OPEN = 1; // WebSocket.OPEN

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
  readyState = OPEN;

  constructor(public url: string) {
    mockWsInstance = this;
  }
}

function createOpenEvent(): Event {
  return new Event('open');
}

function createMessageEvent(data: unknown): MessageEvent {
  return new MessageEvent('message', { data: JSON.stringify(data) });
}

function createCloseEvent(): CloseEvent {
  return new CloseEvent('close');
}

// --- Setup ---
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

function renderHookWithSocket() {
  return renderHook(() => useDebugSocket());
}

describe('useDebugSocket', () => {
  describe('connection lifecycle', () => {
    it('connects on mount and updates store to "connecting"', () => {
      renderHookWithSocket();
      expect(useRuntimeStore.getState().connectionStatus).toBe('connecting');
      expect(mockWsInstance).toBeTruthy();
      expect(mockWsInstance.url).toBe('ws://localhost:3000/ws/debug');
    });

    it('updates store to "connected" on open', () => {
      renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });
      expect(useRuntimeStore.getState().connectionStatus).toBe('connected');
    });

    it('resets reconnect attempt on connect', () => {
      useRuntimeStore.getState().setReconnectAttempt(3);
      renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });
      expect(useRuntimeStore.getState().reconnectAttempt).toBe(0);
    });

    it('disconnects on unmount', () => {
      const { unmount } = renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });
      unmount();
      expect(useRuntimeStore.getState().connectionStatus).toBe('disconnected');
    });

    it('cleans up reconnect timer on unmount', () => {
      const { unmount } = renderHookWithSocket();
      act(() => {
        mockWsInstance.onclose?.(createCloseEvent());
      });
      unmount();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
    });
  });

  describe('message handling', () => {
    it('dispatches service_status to store', () => {
      renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });

      act(() => {
        mockWsInstance.onmessage?.(
          createMessageEvent({
            type: 'service_status',
            services: {
              playwright: {
                isOpen: true,
                url: 'http://example.com',
                status: 'healthy',
              },
            },
          }),
        );
      });

      expect(useRuntimeStore.getState().playwrightIsOpen).toBe(true);
      expect(useRuntimeStore.getState().playwrightUrl).toBe('http://example.com');
      expect(useRuntimeStore.getState().playwrightStatus).toBe('ready');
    });

    it('sets playwright status to unhealthy', () => {
      renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });

      act(() => {
        mockWsInstance.onmessage?.(
          createMessageEvent({
            type: 'service_status',
            services: {
              playwright: { isOpen: false, status: 'unhealthy' },
            },
          }),
        );
      });

      expect(useRuntimeStore.getState().playwrightStatus).toBe('unhealthy');
      expect(useRuntimeStore.getState().playwrightIsOpen).toBe(false);
    });

    it('notifies registered message handlers', () => {
      const handler = vi.fn();
      const { result } = renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });

      act(() => {
        result.current.onMessage(handler);
      });

      const messageData = { type: 'task_started', taskId: 'abc' };
      act(() => {
        mockWsInstance.onmessage?.(createMessageEvent(messageData));
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'task_started', taskId: 'abc' }),
      );
    });

    it('unsubscribes handler via returned function', () => {
      const handler = vi.fn();
      const { result } = renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });

      let unsubscribe: () => void;
      act(() => {
        unsubscribe = result.current.onMessage(handler);
      });

      act(() => {
        unsubscribe();
      });

      act(() => {
        mockWsInstance.onmessage?.(createMessageEvent({ type: 'ping' }));
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('sends JSON to socket when connected', () => {
      const { result } = renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });

      act(() => {
        result.current.sendMessage('pause', { taskId: '123' });
      });

      expect(mockWsInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'pause', taskId: '123' }),
      );
    });

    it('sends without data', () => {
      const { result } = renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });

      act(() => {
        result.current.sendMessage('ping');
      });

      expect(mockWsInstance.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
    });

    it('does nothing when socket is not open', () => {
      const { result } = renderHookWithSocket();
      mockWsInstance.readyState = 3; // CLOSED

      act(() => {
        result.current.sendMessage('ping');
      });

      expect(mockWsInstance.send).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('closes socket and stops reconnection', () => {
      const { result } = renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });

      act(() => {
        result.current.disconnect();
      });

      expect(useRuntimeStore.getState().connectionStatus).toBe('disconnected');
      expect(useRuntimeStore.getState().reconnectAttempt).toBe(0);
    });

    it('does not trigger reconnect after manual disconnect', () => {
      const { result } = renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });

      act(() => {
        result.current.disconnect();
      });

      act(() => {
        mockWsInstance.onclose?.(createCloseEvent());
      });

      act(() => {
        vi.advanceTimersByTime(5000);
      });
    });
  });

  describe('reconnect', () => {
    it('disconnects then reconnects', () => {
      const { result } = renderHookWithSocket();
      act(() => {
        mockWsInstance.onopen?.(createOpenEvent());
      });

      act(() => {
        result.current.reconnect();
      });

      expect(useRuntimeStore.getState().connectionStatus).toBe('connecting');
      expect(mockWsInstance).toBeTruthy();
    });

    it('reconnects with exponential backoff after unexpected close', () => {
      renderHookWithSocket();

      act(() => {
        mockWsInstance.onclose?.(createCloseEvent());
      });

      expect(useRuntimeStore.getState().connectionStatus).toBe('reconnecting');
      expect(useRuntimeStore.getState().reconnectAttempt).toBe(1);

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(useRuntimeStore.getState().connectionStatus).toBe('connecting');
    });

    it('stops after max reconnect attempts', () => {
      renderHookWithSocket();

      // Simulate 5 failed reconnection cycles
      for (let i = 1; i <= 5; i++) {
        act(() => {
          mockWsInstance.onclose?.(createCloseEvent());
        });
        expect(useRuntimeStore.getState().reconnectAttempt).toBe(i);

        act(() => {
          vi.advanceTimersByTime(10000);
        });
      }

      // 6th close: attempt exceeds max, store stays at 5
      act(() => {
        mockWsInstance.onclose?.(createCloseEvent());
      });

      act(() => {
        vi.advanceTimersByTime(60000);
      });

      // Status should remain disconnected, no further reconnect
      expect(useRuntimeStore.getState().connectionStatus).toBe('disconnected');
      expect(useRuntimeStore.getState().reconnectAttempt).toBe(5);
    });
  });
});
