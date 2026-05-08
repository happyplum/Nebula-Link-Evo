import 'fastify';
import type { SSEEvent } from '../types/sse-events.js';

export type SSEEventInput = Omit<SSEEvent, 'timestamp'> & {
  timestamp?: string;
};

export interface SSEEmitter {
  emit(event: SSEEventInput): SSEEvent;
  onClient(callback: (event: SSEEvent) => void): () => void;
  removeClient(callback: (event: SSEEvent) => void): void;
  getClientCount(): number;
}

declare module 'fastify' {
  interface FastifyInstance {
    sseEmitter: SSEEmitter;
  }
}
