import { WebSocket } from '@fastify/websocket';

export class WebSocketManager {
  private connections: Set<WebSocket> = new Set();

  add(ws: WebSocket) {
    this.connections.add(ws);
    ws.on('close', () => this.connections.delete(ws));
  }

  remove(ws: WebSocket) {
    this.connections.delete(ws);
  }

  broadcast(message: any) {
    const data = JSON.stringify(message);
    for (const ws of this.connections) {
      try {
        ws.send(data);
      } catch {
        this.connections.delete(ws);
      }
    }
  }

  get size(): number {
    return this.connections.size;
  }
}
