import type { FastifyInstance } from 'fastify';
import { ChatWebSocketManager } from '../../../chat-websocket-manager.js';

export default async function (fastify: FastifyInstance) {
  const wsManager = ChatWebSocketManager.getInstance();

  fastify.get('/ws', { websocket: true }, (socket, req) => {
    const clientId = req.id;
    wsManager.handleConnection(socket, clientId);
  });
}
