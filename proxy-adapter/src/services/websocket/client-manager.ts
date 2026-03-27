import WebSocket from 'ws';
import type { WebSocketMessage } from './types.js';

export type MetricsBroadcaster = (sessionId: string, metrics: unknown) => void;
export class ClientManager {
  private clients = new Map<string, WebSocket>();
  private sessionSubscriptions = new Map<string, Set<string>>();
  private clientSessions = new Map<string, string>();
  private metricsBroadcaster: MetricsBroadcaster | null = null;

  register(ws: WebSocket): string {
    const clientId = crypto.randomUUID();
    this.clients.set(clientId, ws);
    return clientId;
  }

  registerWithId(clientId: string, ws: WebSocket): void { this.clients.set(clientId, ws); }

  unregister(clientId: string): void {
    this.clearClientSession(clientId);
    this.clients.delete(clientId);
  }

  subscribe(sessionId: string, clientId: string): void {
    let subscribers = this.sessionSubscriptions.get(sessionId);
    if (!subscribers) {
      subscribers = new Set();
      this.sessionSubscriptions.set(sessionId, subscribers);
    }
    subscribers.add(clientId);
    this.clientSessions.set(clientId, sessionId);
  }

  unsubscribe(sessionId: string, clientId: string): void {
    this.removeFromSession(sessionId, clientId);
    if (this.clientSessions.get(clientId) === sessionId) this.clientSessions.delete(clientId);
  }

  private clearClientSession(clientId: string): void {
    const sessionId = this.clientSessions.get(clientId);
    if (!sessionId) return;
    this.removeFromSession(sessionId, clientId);
    this.clientSessions.delete(clientId);
  }

  private removeFromSession(sessionId: string, clientId: string): void {
    const subscribers = this.sessionSubscriptions.get(sessionId);
    if (!subscribers) return;
    subscribers.delete(clientId);
    if (subscribers.size === 0) this.sessionSubscriptions.delete(sessionId);
  }

  broadcast(sessionId: string, message: WebSocketMessage): void {
    const subscribers = this.sessionSubscriptions.get(sessionId);
    if (!subscribers || subscribers.size === 0) return;
    const serialized = JSON.stringify(message);
    for (const clientId of subscribers) this.sendToClient(clientId, serialized);
  }

  sendToClient(clientId: string, message: WebSocketMessage | string): void {
    const client = this.clients.get(clientId);
    if (!client || client.readyState !== WebSocket.OPEN) return;
    client.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  getClientInfo(clientId: string): { socket: WebSocket; isConnected: boolean } | undefined {
    const socket = this.clients.get(clientId);
    if (!socket) return undefined;
    return { socket, isConnected: socket.readyState === WebSocket.OPEN };
  }

  getSessionSubscribers(sessionId: string): Set<string> | undefined { return this.sessionSubscriptions.get(sessionId); }

  getClientSession(clientId: string): string | undefined { return this.clientSessions.get(clientId); }

  getStats(): { clients: number; sessions: number; clientIds: string[] } {
    return { clients: this.clients.size, sessions: this.sessionSubscriptions.size, clientIds: [...this.clients.keys()] };
  }

  setMetricsBroadcaster(broadcaster: MetricsBroadcaster): void { this.metricsBroadcaster = broadcaster; }

  getMetricsBroadcaster(): MetricsBroadcaster | null { return this.metricsBroadcaster; }

  broadcastMetrics(sessionId: string, metrics: unknown): void { this.metricsBroadcaster?.(sessionId, metrics); }

  clearSession(sessionId: string): void {
    const subscribers = this.sessionSubscriptions.get(sessionId);
    if (!subscribers) return;
    for (const clientId of subscribers) this.clientSessions.delete(clientId);
    this.sessionSubscriptions.delete(sessionId);
  }

  clearAll(): void {
    this.clients.clear();
    this.sessionSubscriptions.clear();
    this.clientSessions.clear();
  }
}
