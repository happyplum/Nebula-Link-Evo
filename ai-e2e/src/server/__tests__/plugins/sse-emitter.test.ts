import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SSEEvent } from '../../../types/sse-events.js';
import sseEmitterPlugin from '../../plugins/sse-emitter.js';

const apps = new Set<FastifyInstance>();

afterEach(async () => {
  await Promise.all(Array.from(apps, async app => app.close()));
  apps.clear();
});

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify();
  apps.add(app);
  await app.register(sseEmitterPlugin);
  await app.ready();
  return app;
}

describe('sse-emitter plugin', () => {
  it('emits events to all registered clients', async () => {
    const app = await createApp();
    const firstClient = vi.fn();
    const secondClient = vi.fn();

    app.sseEmitter.onClient(firstClient);
    app.sseEmitter.onClient(secondClient);

    const event: SSEEvent = {
      type: 'error',
      timestamp: '2026-05-09T00:00:00.000Z',
      data: { message: 'boom' },
    };

    app.sseEmitter.emit(event);

    expect(firstClient).toHaveBeenCalledTimes(1);
    expect(secondClient).toHaveBeenCalledTimes(1);
    expect(firstClient).toHaveBeenCalledWith(event);
    expect(secondClient).toHaveBeenCalledWith(event);
  });

  it('returns an unsubscribe function from onClient', async () => {
    const app = await createApp();
    const client = vi.fn();

    const unsubscribe = app.sseEmitter.onClient(client);

    expect(app.sseEmitter.getClientCount()).toBe(1);

    unsubscribe();

    expect(app.sseEmitter.getClientCount()).toBe(0);
  });

  it('can remove a specific client explicitly', async () => {
    const app = await createApp();
    const firstClient = vi.fn();
    const secondClient = vi.fn();

    app.sseEmitter.onClient(firstClient);
    app.sseEmitter.onClient(secondClient);
    app.sseEmitter.removeClient(firstClient);

    expect(app.sseEmitter.getClientCount()).toBe(1);
  });

  it('adds a timestamp when missing from the event payload', async () => {
    const app = await createApp();
    const client = vi.fn();
    app.sseEmitter.onClient(client);

    app.sseEmitter.emit({
      type: 'error',
      data: { message: 'missing timestamp' },
    });

    expect(client).toHaveBeenCalledTimes(1);

    const emittedEvent = client.mock.calls[0]?.[0];
    expect(emittedEvent.type).toBe('error');
    expect(emittedEvent.data).toEqual({ message: 'missing timestamp' });
    expect(typeof emittedEvent.timestamp).toBe('string');
  });
});
