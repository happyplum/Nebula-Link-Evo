/**
 * Chat Routes - Unified entry point
 * Registers all chat sub-plugins with appropriate prefixes
 */
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import sessionRoutes from './sessions.js';
import messageRoutes from './messages.js';
import controlRoutes from './control.js';
import streamRoutes from './stream.js';
import connectivityTestRoutes from './connectivity-test.js';

const chatRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  // Register session routes at /sessions prefix
  // Routes: GET /, GET /:id, GET /:id/messages, POST /:id/messages
  await fastify.register(sessionRoutes, { prefix: '/sessions' });

  // Register legacy message route at /message prefix
  // Route: POST /
  await fastify.register(messageRoutes, { prefix: '/message' });

  // Register control routes at /sessions prefix (for /sessions/:id/{pause,resume,cancel,interrupt})
  // Routes: POST /:id/interrupt, POST /:id/cancel, POST /:id/pause, POST /:id/resume
  //         GET /:id/status, GET /:id/operations
  await fastify.register(controlRoutes, { prefix: '/sessions' });

  // Register stream routes at /sessions prefix (for /sessions/:id/stream)
  // Route: GET /:id/stream
  await fastify.register(streamRoutes, { prefix: '/sessions' });

  // Register connectivity test route (no prefix - direct at /connectivity-test)
  // Route: POST /connectivity-test
  await fastify.register(connectivityTestRoutes);
};

export default chatRoutes;