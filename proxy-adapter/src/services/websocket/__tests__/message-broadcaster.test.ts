import { beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import {
  broadcast,
  broadcastToClients,
  broadcastToSession,
  respondToClient,
} from '../message-broadcaster.js';
import type { WebSocketMessage } from '../types.js';

interface MockClient {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
}

function createClient(readyState: number = WebSocket.OPEN): MockClient {
  return {
    readyState,
    send: vi.fn(),
  };
}

function asWebSocket(client: MockClient): WebSocket {
  return client as unknown as WebSocket;
}

describe('message-broadcaster', () => {
  let clients: Map<string, WebSocket>;
  const message: WebSocketMessage = {
    type: 'test',
    payload: { value: 42 },
  };

  beforeEach(() => {
    clients = new Map<string, WebSocket>();
    vi.clearAllMocks();
  });

  describe('respondToClient', () => {
    it('sends message to specific connected client', () => {
      const client = createClient();
      clients.set('client-1', asWebSocket(client));

      respondToClient(clients, 'client-1', message);

      expect(client.send).toHaveBeenCalledTimes(1);
      expect(client.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it('does not send when target client is disconnected', () => {
      const disconnectedClient = createClient(WebSocket.CLOSED);
      clients.set('client-1', asWebSocket(disconnectedClient));

      respondToClient(clients, 'client-1', message);

      expect(disconnectedClient.send).not.toHaveBeenCalled();
      expect(clients.has('client-1')).toBe(true);
    });

    it('propagates send errors from connected client', () => {
      const client = createClient();
      const sendError = new Error('send failed');
      client.send.mockImplementation(() => {
        throw sendError;
      });
      clients.set('client-1', asWebSocket(client));

      expect(() => respondToClient(clients, 'client-1', message)).toThrow(sendError);
    });
  });

  describe('broadcast', () => {
    it('sends serialized message to all connected clients', () => {
      const client1 = createClient();
      const client2 = createClient();
      clients.set('client-1', asWebSocket(client1));
      clients.set('client-2', asWebSocket(client2));

      broadcast(clients, message);

      const serialized = JSON.stringify(message);
      expect(client1.send).toHaveBeenCalledWith(serialized);
      expect(client2.send).toHaveBeenCalledWith(serialized);
    });

    it('removes disconnected clients while broadcasting', () => {
      const connectedClient = createClient();
      const disconnectedClient = createClient(WebSocket.CLOSED);
      clients.set('connected', asWebSocket(connectedClient));
      clients.set('disconnected', asWebSocket(disconnectedClient));

      broadcast(clients, message);

      expect(connectedClient.send).toHaveBeenCalledTimes(1);
      expect(disconnectedClient.send).not.toHaveBeenCalled();
      expect(clients.has('connected')).toBe(true);
      expect(clients.has('disconnected')).toBe(false);
    });

    it('propagates send errors from connected clients', () => {
      const client = createClient();
      const sendError = new Error('broadcast failed');
      client.send.mockImplementation(() => {
        throw sendError;
      });
      clients.set('client-1', asWebSocket(client));

      expect(() => broadcast(clients, message)).toThrow(sendError);
    });
  });

  describe('broadcastToClients', () => {
    it('sends only to requested clients', () => {
      const client1 = createClient();
      const client2 = createClient();
      const client3 = createClient();
      clients.set('client-1', asWebSocket(client1));
      clients.set('client-2', asWebSocket(client2));
      clients.set('client-3', asWebSocket(client3));

      broadcastToClients(clients, ['client-1', 'client-3'], message);

      const serialized = JSON.stringify(message);
      expect(client1.send).toHaveBeenCalledWith(serialized);
      expect(client2.send).not.toHaveBeenCalled();
      expect(client3.send).toHaveBeenCalledWith(serialized);
    });

    it('removes disconnected clients from requested list', () => {
      const connectedClient = createClient();
      const disconnectedClient = createClient(WebSocket.CLOSED);
      clients.set('client-1', asWebSocket(connectedClient));
      clients.set('client-2', asWebSocket(disconnectedClient));

      broadcastToClients(clients, ['client-1', 'client-2'], message);

      expect(connectedClient.send).toHaveBeenCalledTimes(1);
      expect(disconnectedClient.send).not.toHaveBeenCalled();
      expect(clients.has('client-1')).toBe(true);
      expect(clients.has('client-2')).toBe(false);
    });
  });

  describe('broadcastToSession', () => {
    it('sends to subscribed and connected clients only', () => {
      const client1 = createClient();
      const client2 = createClient(WebSocket.CLOSED);
      const client3 = createClient();
      clients.set('client-1', asWebSocket(client1));
      clients.set('client-2', asWebSocket(client2));
      clients.set('client-3', asWebSocket(client3));

      const sessionSubscriptions = new Map<string, Set<string>>();
      sessionSubscriptions.set('session-1', new Set(['client-1', 'client-2']));

      broadcastToSession(clients, sessionSubscriptions, 'session-1', message);

      const serialized = JSON.stringify(message);
      expect(client1.send).toHaveBeenCalledWith(serialized);
      expect(client2.send).not.toHaveBeenCalled();
      expect(client3.send).not.toHaveBeenCalled();
      expect(clients.has('client-2')).toBe(true);
    });

    it('returns early when session has no subscribers', () => {
      const client = createClient();
      clients.set('client-1', asWebSocket(client));

      const sessionSubscriptions = new Map<string, Set<string>>();

      broadcastToSession(clients, sessionSubscriptions, 'missing-session', message);

      expect(client.send).not.toHaveBeenCalled();
      expect(clients.has('client-1')).toBe(true);
    });
  });
});
