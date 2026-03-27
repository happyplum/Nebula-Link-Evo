import { vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Mock WebSocket implementation
 * Compatible with both 'ws' and '@fastify/websocket' WebSocket
 */
interface MockWebSocket {
  readyState: number;
  CONNECTING: number;
  OPEN: number;
  CLOSING: number;
  CLOSED: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

/**
 * Create a mock WebSocket
 *
 * @param config - Optional mock configuration
 * @returns Mock WebSocket instance
 */
export function createWebSocketMock(config?: {
  url?: string;
  initialState?: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';
  autoConnect?: boolean;
  shouldFailOnSend?: boolean;
  shouldFailOnConnect?: boolean;
}): MockWebSocket {
  const mockConfig = {
    url: 'ws://localhost:3000/ws',
    initialState: 'CONNECTING' as const,
    autoConnect: true,
    shouldFailOnSend: false,
    shouldFailOnConnect: false,
    ...config,
  };

  const eventEmitter = new EventEmitter();
  let state = mockConfig.initialState === 'CONNECTING' ? 0 : 1; // 0 = CONNECTING, 1 = OPEN

  const mockWs = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    readyState: state,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,

    send: vi.fn((data: string | Buffer) => {
      if (mockConfig.shouldFailOnSend) {
        throw new Error('Failed to send WebSocket message');
      }
      // Simulate successful send
    }),

    close: vi.fn((code?: number, reason?: string) => {
      state = 3;
      mockWs.readyState = state;

      const closeEvent = {
        code: code || 1000,
        reason: reason || 'Normal closure',
        wasClean: true,
      };

      if (mockWs.onclose) {
        mockWs.onclose(closeEvent as CloseEvent);
      }

      eventEmitter.emit('close', closeEvent);
    }),

    addEventListener: vi.fn((event: string, listener: (...args: any[]) => void) => {
      eventEmitter.on(event, listener);
    }),

    removeEventListener: vi.fn((event: string, listener: (...args: any[]) => void) => {
      eventEmitter.off(event, listener);
    }),

    ping: vi.fn(),
    terminate: vi.fn(),
  } as unknown as MockWebSocket;

  // Auto-connect simulation
  if (mockConfig.autoConnect && mockConfig.initialState === 'CONNECTING') {
    setTimeout(() => {
      if (mockConfig.shouldFailOnConnect) {
        state = 3;
        mockWs.readyState = state;

        const errorEvent = new Event('error');
        if (mockWs.onerror) {
          mockWs.onerror(errorEvent);
        }
        eventEmitter.emit('error', errorEvent);
      } else {
        state = 1;
        mockWs.readyState = state;

        const openEvent = new Event('open');
        if (mockWs.onopen) {
          mockWs.onopen(openEvent);
        }
        eventEmitter.emit('open', openEvent);
      }
    }, 0);
  }

  // Setup proxy for dynamic event handler assignment
  const handlerProxy = {
    set(target: any, prop: string, value: any) {
      if (['onopen', 'onmessage', 'onerror', 'onclose'].includes(prop)) {
        target[prop] = value;
        return true;
      }
      return Reflect.set(target, prop, value);
    },
  };

  return new Proxy(mockWs, handlerProxy);
}

/**
 * Simulate receiving a message on the mock WebSocket
 */
export function simulateWebSocketMessage(mockWs: MockWebSocket, data: string | object): void {
  const messageEvent = {
    data: typeof data === 'string' ? data : JSON.stringify(data),
    origin: 'ws://localhost:3000',
    lastEventId: '',
    source: null as any,
    ports: [],
  };

  if (mockWs.onmessage) {
    mockWs.onmessage(messageEvent as MessageEvent);
  }

  // Also emit via event emitter if addEventListener was used
  (mockWs as any).emit?.('message', messageEvent);
}

/**
 * Simulate WebSocket error
 */
export function simulateWebSocketError(mockWs: MockWebSocket, error: Error): void {
  const errorEvent = { error, type: 'error' };

  if (mockWs.onerror) {
    mockWs.onerror(errorEvent as Event);
  }

  (mockWs as any).emit?.('error', errorEvent);
}

/**
 * Simulate WebSocket close
 */
export function simulateWebSocketClose(mockWs: MockWebSocket, code?: number, reason?: string): void {
  mockWs.readyState = 3;

  const closeEvent = {
    code: code || 1000,
    reason: reason || 'Normal closure',
    wasClean: true,
  };

  if (mockWs.onclose) {
    mockWs.onclose(closeEvent as CloseEvent);
  }

  (mockWs as any).emit?.('close', closeEvent);
}

/**
 * Get a mock Fastify WebSocket connection object
 */
export function createFastifyWebSocketMock(config?: {
  socket?: MockWebSocket;
}): any {
  const mockWs = config?.socket || createWebSocketMock({ initialState: 'OPEN' });

  return {
    socket: mockWs,
    send: vi.fn((data: any) => {
      mockWs.send(JSON.stringify(data));
    }),
    close: vi.fn((code?: number, reason?: string) => {
      mockWs.close(code, reason);
    }),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      (mockWs as any).addEventListener?.(event, handler);
    }),
  };
}