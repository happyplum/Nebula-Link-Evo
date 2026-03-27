import WebSocket from 'ws';
import { browserClient } from './browser-client.js';
import type { ChatHandler, ChatMessageData } from './conversation/chat-handler.js';
import { StreamBuffer } from './services/websocket/stream-buffer.js';
export { cleanupPersistence } from './services/websocket/persistence-singletons.js';
import type { WebSocketMessage, StreamChunk } from './services/websocket/types.js';

interface ServiceStatus {
  playwright: {
    isOpen: boolean;
    url?: string;
    title?: string;
    status: 'healthy' | 'unhealthy';
  };
  mcp?: {
    enabled: boolean;
    servers: Array<{
      name: string;
      running: boolean;
      toolsCount: number;
    }>;
  };
}

export class DebugWebSocketManager {
  private clients: Map<string, WebSocket> = new Map();
  private static instance: DebugWebSocketManager;
  private taskCommandHandler: ((message: WebSocketMessage) => void) | null = null;
  private chatHandler: ChatHandler | null = null;
  private statusInterval: NodeJS.Timeout | null = null;
  private mcpStatusProvider: (() => ServiceStatus['mcp']) | null = null;
  private sessionSubscriptions: Map<string, Set<string>> = new Map();
  private clientSessions: Map<string, string> = new Map();
  private streamBuffers: Map<string, StreamBuffer> = new Map();
  private constructor() {}

  static getInstance(): DebugWebSocketManager {
    if (!DebugWebSocketManager.instance) {
      DebugWebSocketManager.instance = new DebugWebSocketManager();
    }
    return DebugWebSocketManager.instance;
  }

  handleConnection(ws: WebSocket, clientId: string): void {
    this.clients.set(clientId, ws);
    console.log(`[WebSocket] Client ${clientId} connected (${this.clients.size} total)`);

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
      console.log(
        `[WebSocket] Client ${clientId} disconnected: code=${code}, reason=${reasonStr} (${this.clients.size} remaining)`
      );
      this.unsubscribeFromSession(clientId);
      this.clients.delete(clientId);
      if (this.clients.size === 0 && this.statusInterval) {
        clearInterval(this.statusInterval);
        this.statusInterval = null;
      }
    });

    ws.on('error', (error: Error) => {
      console.error(`[WebSocket] Error for client ${clientId}:`, error.message);
      this.clients.delete(clientId);
    });

    this.startStatusPush();
    this.pushInitialStatus(clientId);
  }

  private startStatusPush(): void {
    if (this.statusInterval) return;

    // ✅ Add heartbeat ping (every 30 seconds)
    setInterval(() => {
      this.broadcast({ type: 'ping', timestamp: Date.now() });
    }, 30000);

    this.statusInterval = setInterval(() => {
      this.broadcastServiceStatus();
    }, 3000);
  }

  private async pushInitialStatus(clientId: string): Promise<void> {
    const status = await this.fetchServiceStatus();
    this.respondToClient(clientId, {
      type: 'service_status',
      services: status,
      timestamp: new Date().toISOString(),
    });
  }

  private async broadcastServiceStatus(): Promise<void> {
    if (this.clients.size === 0) return;
    const status = await this.fetchServiceStatus();
    this.broadcast({
      type: 'service_status',
      services: status,
      timestamp: new Date().toISOString(),
    });
  }

  private async fetchServiceStatus(): Promise<ServiceStatus> {
    const playwrightStatus = await this.fetchPlaywrightStatus();
    let mcpStatus: ServiceStatus['mcp'] = { enabled: false, servers: [] };

    if (this.mcpStatusProvider) {
      try {
        mcpStatus = this.mcpStatusProvider() || mcpStatus;
      } catch (error) {
        console.warn(
          '[DebugWebSocketManager] Failed to get MCP status from provider, using fallback',
          error
        );
      }
    }
    return {
      playwright: playwrightStatus,
      mcp: mcpStatus,
    };
  }

  private async fetchPlaywrightStatus(): Promise<ServiceStatus['playwright']> {
    try {
      const status = await browserClient.getStatus();
      return {
        isOpen: status.isOpen,
        url: status.url,
        title: status.title,
        status: status.isOpen ? 'healthy' : 'unhealthy',
      };
    } catch {
      return { isOpen: false, status: 'unhealthy' };
    }
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
            this.chatHandler.handleMessage(
              message as unknown as ChatMessageData,
              ws
            );
          }
        }
        break;
      case 'subscribe':
        this.respondToClient(clientId, {
          type: 'subscribed',
          channels: message.channels || [],
        });
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
      case 'pause':
      case 'resume':
      case 'modify':
      case 'manual_action':
        this.respondToClient(clientId, {
          type: 'ack',
          receivedType: message.type,
          timestamp: new Date().toISOString(),
        });
        break;
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
    if (client) {
      client.send(JSON.stringify(data));
    }
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

  setTaskCommandHandler(handler: (message: WebSocketMessage) => void): void {
    this.taskCommandHandler = handler;
  }

  setMCPStatusProvider(provider: () => ServiceStatus['mcp']): void {
    this.mcpStatusProvider = provider;
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
    if (!this.sessionSubscriptions.has(sessionId)) {
      this.sessionSubscriptions.set(sessionId, new Set());
    }
    this.sessionSubscriptions.get(sessionId)!.add(clientId);
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
    if (buffer) {
      buffer.clear();
      this.streamBuffers.delete(sessionId);
    }
  }
}
