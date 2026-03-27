import WebSocket from 'ws';
import type { WebSocketMessage } from './types.js';

function trySend(client: WebSocket | undefined, message: string): boolean {
  if (!client || client.readyState !== WebSocket.OPEN) return false;
  client.send(message);
  return true;
}

function sendTo(clients: Map<string, WebSocket>, ids: Iterable<string>, msg: string, cleanup: boolean): void {
  for (const id of ids) if (!trySend(clients.get(id), msg) && cleanup) clients.delete(id);
}

export function respondToClient(clients: Map<string, WebSocket>, clientId: string, data: WebSocketMessage): void {
  trySend(clients.get(clientId), JSON.stringify(data));
}

export function broadcast(clients: Map<string, WebSocket>, data: WebSocketMessage): void {
  sendTo(clients, clients.keys(), JSON.stringify(data), true);
}

export function broadcastToClients(clients: Map<string, WebSocket>, clientIds: string[], data: WebSocketMessage): void {
  sendTo(clients, clientIds, JSON.stringify(data), true);
}

export function broadcastToSession(clients: Map<string, WebSocket>, sessionSubscriptions: Map<string, Set<string>>, sessionId: string, data: WebSocketMessage): void {
  const subs = sessionSubscriptions.get(sessionId);
  if (!subs?.size) return;
  for (const id of subs) trySend(clients.get(id), JSON.stringify(data));
}
