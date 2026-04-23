import WebSocket from 'ws';
import { StreamBuffer } from './services/websocket/stream-buffer.js';
import { cleanupPersistence as cleanupWebSocketPersistence } from './services/websocket/persistence-singletons.js';
import { createWorkerLogger } from './services/logger.js';
import type { Logger } from 'pino';
import type { WebSocketMessage, StreamChunk } from './services/websocket/types.js';
interface ChatHandler {
  handleMessage(data: unknown, ws: WebSocket): void;
}
export function cleanupPersistence(): void {
  cleanupWebSocketPersistence();
}
export class ChatWebSocketManager {
  private clients: Map<string, WebSocket> = new Map();
  private static instance: ChatWebSocketManager;
  private chatHandler: ChatHandler | null = null;
  private statusInterval: NodeJS.Timeout | null = null;
  private sessionSubscriptions: Map<string, Set<string>> = new Map();
  private clientSessions: Map<string, string> = new Map();
  private streamBuffers: Map<string, StreamBuffer> = new Map();
  private logger: Logger;
  private constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('chat-websocket');
  }
  static getInstance(): ChatWebSocketManager {
    if (!ChatWebSocketManager.instance) {
      ChatWebSocketManager.instance = new ChatWebSocketManager();
    }
    return ChatWebSocketManager.instance;
  }
  handleConnection(ws: WebSocket, clientId: string): void {
    this.clients.set(clientId, ws);
    this.logger.info({ clientId, total: this.clients.size }, 'Client connected');

    ws.send(
      JSON.stringify({
        type: 'connected',
        clientId,
        timestamp: new Date().toISOString(),
      })
    );

    ws.on('message', (data: Buffer) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        this.handleClientMessage(clientId, message);
      } catch (error) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
            error: (error as Error).message,
          })
        );
      }
    });

    ws.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || 'unknown';
      this.logger.info({ clientId, code, reason: reasonStr, remaining: this.clients.size }, 'Client disconnected');
      this.unsubscribeFromSession(clientId);
      this.clients.delete(clientId);
      if (this.clients.size === 0 && this.statusInterval) {
        clearInterval(this.statusInterval);
        this.statusInterval = null;
      }
    });

    ws.on('error', (error: Error) => {
      this.logger.error({ err: error, clientId }, 'WebSocket error for client');
      this.clients.delete(clientId);
    });

    this.startStatusPush();
  }

  private startStatusPush(): void {
    if (this.statusInterval) return;
    setInterval(() => {
      this.broadcast({ type: 'ping', timestamp: Date.now() });
    }, 30000);
  }
  private handleClientMessage(clientId: string, message: WebSocketMessage): void {
    switch (message.type) {
      case 'ping':
        this.respondToClient(clientId, { type: 'pong' });
        break;
      case 'chat_send':
        if (this.chatHandler) {
          const ws = this.clients.get(clientId);
          if (ws) {
            this.chatHandler.handleMessage(message, ws);
          }
        }
        break;
      case 'subscribe_session': {
        const sessionId = message.sessionId as string;
        this.subscribeToSession(clientId, sessionId);

        const buffer = this.getStreamBuffer(sessionId);
        this.respondToClient(clientId, {
          type: 'session_buffer',
          sessionId,
          chunks: buffer ? buffer.getBuffer() : [],
          timestamp: new Date().toISOString(),
        });
        break;
      }
      default:
        this.respondToClient(clientId, {
          type: 'ack',
          receivedType: message.type,
          timestamp: new Date().toISOString(),
        });
    }
  }
  respondToClient(clientId: string, data: WebSocketMessage): void {
    const client = this.clients.get(clientId);
    if (client) client.send(JSON.stringify(data));
  }
  broadcast(data: WebSocketMessage): void {
    const message = JSON.stringify(data);
    for (const [clientId, client] of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        this.clients.delete(clientId);
      }
    }
  }
  broadcastToClients(clientIds: string[], data: WebSocketMessage): void {
    const message = JSON.stringify(data);
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        this.clients.delete(clientId);
      }
    }
  }
  setChatHandler(handler: ChatHandler): void {
    this.chatHandler = handler;
  }
  getClientCount(): number {
    return this.clients.size;
  }
  getClients(): string[] {
    return Array.from(this.clients.keys());
  }
  isClientConnected(clientId: string): boolean {
    const client = this.clients.get(clientId);
    return client !== undefined && client.readyState === WebSocket.OPEN;
  }
  subscribeToSession(clientId: string, sessionId: string): void {
    let subscribers = this.sessionSubscriptions.get(sessionId);
    if (!subscribers) {
      subscribers = new Set();
      this.sessionSubscriptions.set(sessionId, subscribers);
    }
    subscribers.add(clientId);
    this.clientSessions.set(clientId, sessionId);

    if (!this.streamBuffers.has(sessionId)) {
      this.streamBuffers.set(sessionId, new StreamBuffer(sessionId));
    }
  }
  unsubscribeFromSession(clientId: string): void {
    const sessionId = this.clientSessions.get(clientId);
    if (sessionId) {
      const subscribers = this.sessionSubscriptions.get(sessionId);
      if (subscribers) {
        subscribers.delete(clientId);
        if (subscribers.size === 0) {
          this.sessionSubscriptions.delete(sessionId);
          this.clearStreamBuffer(sessionId);
        }
      }
      this.clientSessions.delete(clientId);
    }
  }
  broadcastToSession(sessionId: string, data: WebSocketMessage): void {
    const subscribers = this.sessionSubscriptions.get(sessionId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const message = JSON.stringify(data);
    for (const clientId of subscribers) {
      const client = this.clients.get(clientId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
  getStreamBuffer(sessionId: string): StreamBuffer | undefined {
    return this.streamBuffers.get(sessionId);
  }
  async addStreamChunk(sessionId: string, chunk: StreamChunk): Promise<void> {
    const buffer = this.streamBuffers.get(sessionId);
    if (buffer) {
      await buffer.addChunk(chunk);
      this.broadcastToSession(sessionId, {
        type: 'stream_chunk',
        sessionId,
        chunk,
        timestamp: new Date().toISOString(),
      });
    }
  }
  clearStreamBuffer(sessionId: string): void {
    const buffer = this.streamBuffers.get(sessionId);
    if (!buffer) return;
    buffer.clear();
    this.streamBuffers.delete(sessionId);
  }
}
