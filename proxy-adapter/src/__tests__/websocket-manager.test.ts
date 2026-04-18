import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DebugWebSocketManager } from '../websocket-manager.js';
import WebSocket from 'ws';
import { browserClient } from '../browser-client.js';

vi.mock('../browser-client.js', () => ({
  browserClient: {
    getStatus: vi
      .fn()
      .mockResolvedValue({ isOpen: true, url: 'https://example.com', title: 'Test' }),
  },
}));

vi.mock('ws', () => ({
  default: Object.assign(vi.fn(), { OPEN: 1 }),
}));

// Preserve original NODE_ENV
const originalNodeEnv = process.env.NODE_ENV;

describe('DebugWebSocketManager', () => {
  let manager: DebugWebSocketManager;

  beforeEach(() => {
    (DebugWebSocketManager as any).instance = null;
    manager = DebugWebSocketManager.getInstance();
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = DebugWebSocketManager.getInstance();
      const instance2 = DebugWebSocketManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('handleConnection', () => {
    it('should send connected message to client', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const clientId = 'client-123';
      manager.handleConnection(mockWs as any, clientId);
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"type":"connected"'));
    });

    it('should handle client disconnect', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const clientId = 'client-123';
      manager.handleConnection(mockWs as any, clientId);
      // close handler is the second call to on (after 'message')
      const closeHandler = mockWs.on.mock.calls[1][1];
      closeHandler();
      expect(manager.getClientCount()).toBe(0);
    });

    it('should handle client error', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const clientId = 'client-123';
      manager.handleConnection(mockWs as any, clientId);
      // error handler is the third call to on (after 'message' and 'close')
      const errorHandler = mockWs.on.mock.calls[2][1];
      errorHandler(new Error('Test error'));
      expect(manager.getClientCount()).toBe(0);
    });
  });

  describe('respondToClient', () => {
    it('should send message to specific client', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const clientId = 'client-123';
      manager.handleConnection(mockWs as any, clientId);
      mockWs.send.mockClear();
      const message = { type: 'test', data: 'test data' };
      manager.respondToClient(clientId, message);
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it('should not send to non-existent client', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const clientId = 'client-123';
      manager.handleConnection(mockWs as any, clientId);
      const message = { type: 'test', data: 'test data' };
      manager.respondToClient('non-existent', message);
      // Only the 'connected' message from handleConnection should be sent
      expect(mockWs.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('broadcast', () => {
    it('should broadcast message to all connected clients', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const mockWs2 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      manager.handleConnection(mockWs as any, 'client-1');
      manager.handleConnection(mockWs2 as any, 'client-2');
      mockWs.send.mockClear();
      mockWs2.send.mockClear();
      const message = { type: 'test_broadcast', data: 'test' };
      manager.broadcast(message);
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(message));
      expect(mockWs2.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it('should not send to closed connections', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const mockWs2 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 3,
      };
      manager.handleConnection(mockWs as any, 'client-1');
      manager.handleConnection(mockWs2 as any, 'client-2');
      mockWs.send.mockClear();
      mockWs2.send.mockClear();
      const message = { type: 'test_broadcast', data: 'test' };
      manager.broadcast(message);
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(message));
      expect(mockWs2.send).not.toHaveBeenCalled();
      expect(manager.getClientCount()).toBe(1);
    });
  });

  describe('broadcastToClients', () => {
    it('should broadcast to specified clients only', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const mockWs2 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const mockWs3 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      manager.handleConnection(mockWs as any, 'client-1');
      manager.handleConnection(mockWs2 as any, 'client-2');
      manager.handleConnection(mockWs3 as any, 'client-3');
      mockWs.send.mockClear();
      mockWs2.send.mockClear();
      mockWs3.send.mockClear();
      const message = { type: 'test', data: 'test' };
      manager.broadcastToClients(['client-1', 'client-3'], message);
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(message));
      expect(mockWs2.send).not.toHaveBeenCalled();
      expect(mockWs3.send).toHaveBeenCalledWith(JSON.stringify(message));
    });
  });

  describe('setTaskCommandHandler', () => {
    it('should set task command handler', () => {
      const handler = vi.fn();
      manager.setTaskCommandHandler(handler);
      expect(manager['taskCommandHandler']).toBe(handler);
    });
  });

  describe('setMCPStatusProvider', () => {
    it('should set MCP status provider', () => {
      const provider = vi.fn().mockReturnValue({
        enabled: true,
        servers: [{ name: 'test-server', running: true, toolsCount: 5 }],
      });
      manager.setMCPStatusProvider(provider);
      expect(manager['mcpStatusProvider']).toBe(provider);
    });
  });

  describe('setChatHandler', () => {
    it('should set chat handler', () => {
      const mockChatHandler = {
        handleMessage: vi.fn(),
      };
      manager.setChatHandler(mockChatHandler as any);
      expect(manager['chatHandler']).toBe(mockChatHandler);
    });
  });

  describe('getClientCount', () => {
    it('should return 0 for no clients', () => {
      expect(manager.getClientCount()).toBe(0);
    });

    it('should return correct count for multiple clients', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const mockWs2 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const mockWs3 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      manager.handleConnection(mockWs as any, 'client-1');
      manager.handleConnection(mockWs2 as any, 'client-2');
      manager.handleConnection(mockWs3 as any, 'client-3');
      expect(manager.getClientCount()).toBe(3);
    });
  });

  describe('getClients', () => {
    it('should return empty array for no clients', () => {
      const clients = manager.getClients();
      expect(clients).toEqual([]);
    });

    it('should return all connected client IDs', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const mockWs2 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      manager.handleConnection(mockWs as any, 'client-1');
      manager.handleConnection(mockWs2 as any, 'client-2');
      const clients = manager.getClients();
      expect(clients).toHaveLength(2);
      expect(clients).toContain('client-1');
      expect(clients).toContain('client-2');
    });
  });

  describe('isClientConnected', () => {
    it('should return false for non-existent client', () => {
      expect(manager.isClientConnected('non-existent')).toBe(false);
    });

    it('should return true for connected client', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const clientId = 'client-123';
      manager.handleConnection(mockWs as any, clientId);
      expect(manager.isClientConnected(clientId)).toBe(true);
    });

    it('should return false for disconnected client', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 3,
      };
      const clientId = 'client-123';
      manager.handleConnection(mockWs as any, clientId);
      expect(manager.isClientConnected(clientId)).toBe(false);
    });
  });

  describe('Session Subscriptions', () => {
    it('should subscribe client to session', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const clientId = 'client-123';
      const sessionId = 'session-abc';
      manager.handleConnection(mockWs as any, clientId);

      manager.subscribeToSession(clientId, sessionId);

      const buffer = manager.getStreamBuffer(sessionId);
      expect(buffer).toBeDefined();
    });

    it('should broadcast to all subscribers of a session', () => {
      const mockWs1 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const mockWs2 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const sessionId = 'test-session';
      manager.handleConnection(mockWs1 as any, 'client-1');
      manager.handleConnection(mockWs2 as any, 'client-2');

      manager.subscribeToSession('client-1', sessionId);
      manager.subscribeToSession('client-2', sessionId);

      manager.broadcastToSession(sessionId, { type: 'test', data: 'hello' });

      expect(mockWs1.send).toHaveBeenCalledWith(expect.stringContaining('"type":"test"'));
      expect(mockWs2.send).toHaveBeenCalledWith(expect.stringContaining('"type":"test"'));
    });

    it('should handle subscribe_session message type', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const clientId = 'client-123';
      const sessionId = 'session-xyz';
      manager.handleConnection(mockWs as any, clientId);

      mockWs.send.mockClear();

      const message = { type: 'subscribe_session', sessionId };
      manager['handleClientMessage'](clientId, message);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"type":"session_buffer"'));
    });

    it('should unsubscribe client from session', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const clientId = 'client-123';
      const sessionId = 'session-abc';
      manager.handleConnection(mockWs as any, clientId);

      manager.subscribeToSession(clientId, sessionId);
      manager.unsubscribeFromSession(clientId);

      const buffer = manager.getStreamBuffer(sessionId);
      expect(buffer).toBeUndefined();
    });

    it('should cleanup session buffer when last subscriber leaves', () => {
      const mockWs1 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const mockWs2 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const sessionId = 'test-session';
      manager.handleConnection(mockWs1 as any, 'client-1');
      manager.handleConnection(mockWs2 as any, 'client-2');

      manager.subscribeToSession('client-1', sessionId);
      manager.subscribeToSession('client-2', sessionId);

      manager.unsubscribeFromSession('client-1');
      let buffer = manager.getStreamBuffer(sessionId);
      expect(buffer).toBeDefined();

      manager.unsubscribeFromSession('client-2');
      buffer = manager.getStreamBuffer(sessionId);
      expect(buffer).toBeUndefined();
    });

    it('should add stream chunks and broadcast to subscribers', () => {
      const mockWs1 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const mockWs2 = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const sessionId = 'test-session';
      manager.handleConnection(mockWs1 as any, 'client-1');
      manager.handleConnection(mockWs2 as any, 'client-2');

      manager.subscribeToSession('client-1', sessionId);
      manager.subscribeToSession('client-2', sessionId);

      const chunk = { type: 'text', content: 'test content', timestamp: new Date().toISOString() };
      manager.addStreamChunk(sessionId, chunk);

      const buffer = manager.getStreamBuffer(sessionId);
      expect(buffer?.getBuffer()).toHaveLength(1);
      expect(buffer?.getBuffer()[0]).toEqual(chunk);
    });

    it('should unsubscribe on client disconnect', () => {
      const mockWs = {
        send: vi.fn(),
        on: vi.fn(),
        readyState: 1,
      };
      const clientId = 'client-123';
      const sessionId = 'session-abc';
      manager.handleConnection(mockWs as any, clientId);

      manager.subscribeToSession(clientId, sessionId);

      const closeHandler = mockWs.on.mock.calls[1][1];
      closeHandler();

      const buffer = manager.getStreamBuffer(sessionId);
      expect(buffer).toBeUndefined();
    });
  });

  describe('debug_toggle', () => {
    function connectClient(clientId: string) {
      const mockWs = { send: vi.fn(), on: vi.fn(), readyState: 1 };
      manager.handleConnection(mockWs as any, clientId);
      return mockWs;
    }

    it('should enable debug and create counter when toggled on (non-production)', () => {
      process.env.NODE_ENV = 'development';
      const ws = connectClient('dbg-1');
      ws.send.mockClear();

      manager['handleClientMessage']('dbg-1', { type: 'debug_toggle', enabled: true });

      expect(manager.isDebugEnabled()).toBe(true);
      expect(manager.getDebugCounter()).not.toBeNull();
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"debug_status"'));
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"enabled":true'));

      // Cleanup interval
      manager['handleClientMessage']('dbg-1', { type: 'debug_toggle', enabled: false });
    });

    it('should destroy counter and clear interval when toggled off', () => {
      process.env.NODE_ENV = 'development';
      const ws = connectClient('dbg-2');
      manager['handleClientMessage']('dbg-2', { type: 'debug_toggle', enabled: true });
      expect(manager.getDebugCounter()).not.toBeNull();

      ws.send.mockClear();
      manager['handleClientMessage']('dbg-2', { type: 'debug_toggle', enabled: false });

      expect(manager.isDebugEnabled()).toBe(false);
      expect(manager.getDebugCounter()).toBeNull();
      expect(manager['debugSummaryInterval']).toBeNull();
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"enabled":false'));
    });

    it('should NOT create counter in production', () => {
      process.env.NODE_ENV = 'production';
      const ws = connectClient('dbg-3');
      ws.send.mockClear();

      manager['handleClientMessage']('dbg-3', { type: 'debug_toggle', enabled: true });

      // Flag is set but no counter allocated
      expect(manager.isDebugEnabled()).toBe(true);
      expect(manager.getDebugCounter()).toBeNull();

      // Reset
      manager['handleClientMessage']('dbg-3', { type: 'debug_toggle', enabled: false });
    });

    it('should default to debug disabled', () => {
      expect(manager.isDebugEnabled()).toBe(false);
      expect(manager.getDebugCounter()).toBeNull();
    });

    it('counter should record frames, drops, and bytes', () => {
      process.env.NODE_ENV = 'development';
      connectClient('dbg-4');
      manager['handleClientMessage']('dbg-4', { type: 'debug_toggle', enabled: true });

      const counter = manager.getDebugCounter()!;
      counter.recordFrame();
      counter.recordFrame();
      counter.recordBytes(1024);
      counter.recordDrop('relay_backpressure');

      const summary = counter.getSummary();
      expect(summary.totalFrames).toBe(2);
      expect(summary.totalDrops).toBe(1);
      expect(summary.dropReasons['relay_backpressure']).toBe(1);

      // Cleanup
      manager['handleClientMessage']('dbg-4', { type: 'debug_toggle', enabled: false });
    });

    it('should log final summary when toggled off with active counter', () => {
      process.env.NODE_ENV = 'development';
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      connectClient('dbg-5');

      manager['handleClientMessage']('dbg-5', { type: 'debug_toggle', enabled: true });
      const counter = manager.getDebugCounter()!;
      counter.recordFrame();
      counter.recordBytes(512);

      logSpy.mockClear();
      manager['handleClientMessage']('dbg-5', { type: 'debug_toggle', enabled: false });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[NLE-Debug] relay fps=1'));

      logSpy.mockRestore();
    });
  });
});
