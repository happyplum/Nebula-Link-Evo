import fp from './fastify-plugin.js';
import type { FastifyInstance } from 'fastify';
import type { SSEEvent } from '../../types/sse-events.js';

type SSEEmitter = FastifyInstance['sseEmitter'];
type SSEEventInput = Parameters<SSEEmitter['emit']>[0];

function normalizeEvent(event: SSEEventInput): SSEEvent {
  return {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  } as SSEEvent;
}

async function sseEmitterPlugin(fastify: FastifyInstance): Promise<void> {
  const clients = new Set<(event: SSEEvent) => void>();

  const sseEmitter: SSEEmitter = {
    emit(event) {
      const normalizedEvent = normalizeEvent(event);

      for (const client of clients) {
        client(normalizedEvent);
      }

      return normalizedEvent;
    },
    onClient(callback) {
      clients.add(callback);

      return () => {
        clients.delete(callback);
      };
    },
    removeClient(callback) {
      clients.delete(callback);
    },
    getClientCount() {
      return clients.size;
    },
  };

  fastify.decorate('sseEmitter', sseEmitter);
}

export default fp(sseEmitterPlugin, {
  fastify: '5.x',
  name: 'sse-emitter',
});
