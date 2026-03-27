import type { FastifyInstance } from 'fastify';
import { ChatWebSocketManager } from '../../../chat-websocket-manager.js';

export default async function chatSocketRoutes(fastify: FastifyInstance) {
  const wsManager = ChatWebSocketManager.getInstance();

  fastify.get('/chat', { websocket: true }, (connection, req) => {
    const clientId = req.id;
    wsManager.handleConnection(connection, clientId);
  });
}