import { beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { ClientManager } from '../client-manager.js';

interface MockSocket {
  ws: WebSocket;
  send: ReturnType<typeof vi.fn>;
}

function createMockSocket(readyState: number = WebSocket.OPEN): MockSocket {
  const send = vi.fn();
  const ws = {
    send,
    readyState,
  } as unknown as WebSocket;

  return { ws, send };
}

describe('ClientManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('register() stores client and returns generated UUID', () => {
    const manager = new ClientManager();
    const { ws } = createMockSocket();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-1111-1111-111111111111');

    const clientId = manager.register(ws);

    expect(clientId).toBe('11111111-1111-1111-1111-111111111111');
    expect(manager.getClientInfo(clientId)?.socket).toBe(ws);
    expect(manager.getStats().clients).toBe(1);
  });

  it('registerWithId() stores client with provided clientId', () => {
    const manager = new ClientManager();
    const { ws } = createMockSocket();

    manager.registerWithId('fixed-client', ws);

    expect(manager.getClientInfo('fixed-client')?.socket).toBe(ws);
    expect(manager.getStats().clients).toBe(1);
  });

  it('subscribe() adds client to session subscriptions and client session map', () => {
    const manager = new ClientManager();
    const { ws } = createMockSocket();
    manager.registerWithId('client-a', ws);

    manager.subscribe('session-1', 'client-a');

    expect(manager.getClientSession('client-a')).toBe('session-1');
    expect(manager.getSessionSubscribers('session-1')).toEqual(new Set(['client-a']));
  });

  it('unsubscribe() removes client from session and deletes empty session', () => {
    const manager = new ClientManager();
    const { ws } = createMockSocket();
    manager.registerWithId('client-a', ws);
    manager.subscribe('session-1', 'client-a');

    manager.unsubscribe('session-1', 'client-a');

    expect(manager.getClientSession('client-a')).toBeUndefined();
    expect(manager.getSessionSubscribers('session-1')).toBeUndefined();
  });

  it('broadcast() sends serialized message to all subscribers in session', () => {
    const manager = new ClientManager();
    const openA = createMockSocket();
    const openB = createMockSocket();
    const other = createMockSocket();

    manager.registerWithId('client-a', openA.ws);
    manager.registerWithId('client-b', openB.ws);
    manager.registerWithId('client-c', other.ws);
    manager.subscribe('session-1', 'client-a');
    manager.subscribe('session-1', 'client-b');
    manager.subscribe('session-2', 'client-c');

    const payload = { type: 'stream', chunk: 'hello' };
    manager.broadcast('session-1', payload);

    expect(openA.send).toHaveBeenCalledWith(JSON.stringify(payload));
    expect(openB.send).toHaveBeenCalledWith(JSON.stringify(payload));
    expect(other.send).not.toHaveBeenCalled();
  });

  it('broadcast() skips subscribers that are not open', () => {
    const manager = new ClientManager();
    const openSocket = createMockSocket(WebSocket.OPEN);
    const closedSocket = createMockSocket(WebSocket.CLOSED);

    manager.registerWithId('client-open', openSocket.ws);
    manager.registerWithId('client-closed', closedSocket.ws);
    manager.subscribe('session-1', 'client-open');
    manager.subscribe('session-1', 'client-closed');

    const payload = { type: 'stream', chunk: 'hello' };
    manager.broadcast('session-1', payload);

    expect(openSocket.send).toHaveBeenCalledWith(JSON.stringify(payload));
    expect(closedSocket.send).not.toHaveBeenCalled();
  });

  it('broadcast() is a no-op when session has no subscribers', () => {
    const manager = new ClientManager();
    const openSocket = createMockSocket(WebSocket.OPEN);
    manager.registerWithId('client-open', openSocket.ws);

    manager.broadcast('missing-session', { type: 'stream', chunk: 'noop' });

    expect(openSocket.send).not.toHaveBeenCalled();
  });

  it('isClientConnected() reports connection status based on readyState', () => {
    const manager = new ClientManager();
    const openSocket = createMockSocket(WebSocket.OPEN);
    const closedSocket = createMockSocket(WebSocket.CLOSED);
    manager.registerWithId('client-open', openSocket.ws);
    manager.registerWithId('client-closed', closedSocket.ws);

    expect(manager.getClientInfo('client-open')?.isConnected).toBe(true);
    expect(manager.getClientInfo('client-closed')?.isConnected).toBe(false);
    expect(manager.getClientInfo('missing')).toBeUndefined();
  });

  it('getSessionSubscribers() returns subscriber set for a session', () => {
    const manager = new ClientManager();
    const first = createMockSocket();
    const second = createMockSocket();

    manager.registerWithId('client-a', first.ws);
    manager.registerWithId('client-b', second.ws);
    manager.subscribe('session-1', 'client-a');
    manager.subscribe('session-1', 'client-b');

    expect(manager.getSessionSubscribers('session-1')).toEqual(new Set(['client-a', 'client-b']));
  });

  it('getClientCount() tracks registration and unregister', () => {
    const manager = new ClientManager();
    const first = createMockSocket();
    const second = createMockSocket();

    manager.registerWithId('client-a', first.ws);
    manager.registerWithId('client-b', second.ws);
    expect(manager.getStats().clients).toBe(2);

    manager.unregister('client-a');
    expect(manager.getStats().clients).toBe(1);
    expect(manager.getClientInfo('client-a')).toBeUndefined();
  });

  it('unregister() removes client from subscriptions', () => {
    const manager = new ClientManager();
    const first = createMockSocket();

    manager.registerWithId('client-a', first.ws);
    manager.subscribe('session-1', 'client-a');
    expect(manager.getClientSession('client-a')).toBe('session-1');

    manager.unregister('client-a');

    expect(manager.getClientSession('client-a')).toBeUndefined();
    expect(manager.getSessionSubscribers('session-1')).toBeUndefined();
  });

  it('getClientIds() returns all registered client IDs', () => {
    const manager = new ClientManager();
    manager.registerWithId('client-a', createMockSocket().ws);
    manager.registerWithId('client-b', createMockSocket().ws);

    expect(manager.getStats().clientIds).toEqual(['client-a', 'client-b']);
  });

  it('getSessionCount() returns active session count', () => {
    const manager = new ClientManager();
    manager.registerWithId('client-a', createMockSocket().ws);
    manager.registerWithId('client-b', createMockSocket().ws);
    manager.subscribe('session-1', 'client-a');
    manager.subscribe('session-2', 'client-b');

    expect(manager.getStats().sessions).toBe(2);
  });

  it('setMetricsBroadcaster()/getMetricsBroadcaster() and broadcastMetrics() work together', () => {
    const manager = new ClientManager();
    const broadcaster = vi.fn();

    expect(manager.getMetricsBroadcaster()).toBeNull();

    manager.setMetricsBroadcaster(broadcaster);
    manager.broadcastMetrics('session-1', { tokens: 123 });

    expect(manager.getMetricsBroadcaster()).toBe(broadcaster);
    expect(broadcaster).toHaveBeenCalledWith('session-1', { tokens: 123 });
  });

  it('broadcastMetrics() is a no-op when broadcaster is unset', () => {
    const manager = new ClientManager();

    expect(() => manager.broadcastMetrics('session-1', { tokens: 123 })).not.toThrow();
  });

  it('clearSession() removes subscribers and client session mappings', () => {
    const manager = new ClientManager();
    manager.registerWithId('client-a', createMockSocket().ws);
    manager.registerWithId('client-b', createMockSocket().ws);
    manager.subscribe('session-1', 'client-a');
    manager.subscribe('session-1', 'client-b');

    manager.clearSession('session-1');

    expect(manager.getSessionSubscribers('session-1')).toBeUndefined();
    expect(manager.getClientSession('client-a')).toBeUndefined();
    expect(manager.getClientSession('client-b')).toBeUndefined();
  });

  it('clearAll() removes all clients and subscriptions', () => {
    const manager = new ClientManager();
    manager.registerWithId('client-a', createMockSocket().ws);
    manager.registerWithId('client-b', createMockSocket().ws);
    manager.subscribe('session-1', 'client-a');
    manager.subscribe('session-2', 'client-b');

    manager.clearAll();

    expect(manager.getStats().clients).toBe(0);
    expect(manager.getStats().sessions).toBe(0);
    expect(manager.getClientSession('client-a')).toBeUndefined();
    expect(manager.getClientSession('client-b')).toBeUndefined();
  });
});
