import type { FastifyInstance } from 'fastify';

export default async function debugSocketRoutes(fastify: FastifyInstance) {
  const wsManager = (fastify as any).wsManager;

  fastify.get('/debug', { websocket: true }, (connection, _req) => {
    const clientId = crypto.randomUUID();
    wsManager.handleConnection(connection, clientId);
    console.log(`[WS-DEBUG] Client connected: ${clientId} (Total: ${wsManager.getClientCount()})`);
  });
}
