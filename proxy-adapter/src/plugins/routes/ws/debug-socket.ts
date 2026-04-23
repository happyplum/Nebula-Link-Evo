import type { FastifyInstance } from 'fastify';
import { createWorkerLogger } from '../../../services/logger.js';

const logger = createWorkerLogger('ws-debug');

export default async function debugSocketRoutes(fastify: FastifyInstance) {
  const wsManager = fastify.wsManager;

  fastify.get('/debug', { websocket: true }, (connection, _req) => {
    const clientId = crypto.randomUUID();
    wsManager.handleConnection(connection, clientId);
    logger.info({ clientId, total: wsManager.getClientCount() }, 'Client connected');
  });
}
