import { FastifyPluginAsync } from 'fastify';
import websocketRoutes from './websocket.js';
import messagesRoutes from './messages.js';

const chatRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(websocketRoutes);
  await fastify.register(messagesRoutes, { prefix: '/messages' });
};

export default chatRoutes;
