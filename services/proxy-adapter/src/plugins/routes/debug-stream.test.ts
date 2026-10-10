import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DebugPlaywrightState,
  DebugStreamEvent,
} from '@nebula-link-evo/shared/types/debug-events.js';
import { debugEventHub } from '../../services/debug-event-hub.js';
import debugStreamRoutes from './debug-stream.js';

function expectFrame(
  bytes: Uint8Array<ArrayBufferLike>,
  eventName: string,
  sequence: number
): DebugStreamEvent {
  const chunk = new TextDecoder().decode(bytes);
  const prefix = `event: ${eventName}\nid: ${sequence}\ndata: `;
  expect(chunk.startsWith(prefix)).toBe(true);
  expect(chunk.endsWith('\n\n')).toBe(true);
  const event = JSON.parse(chunk.slice(prefix.length, -2)) as DebugStreamEvent;
  expect(chunk).toBe(`${prefix}${JSON.stringify(event)}\n\n`);
  expect(event).toMatchObject({ type: eventName, seq: sequence });
  return event;
}

describe('debug stream SSE wire contract', () => {
  const app = Fastify();
  let address: string;

  beforeEach(async () => {
    debugEventHub.resetForTests();
    await app.register(debugStreamRoutes, { prefix: '/debug/api' });
    address = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterEach(async () => {
    vi.useRealTimers();
    debugEventHub.resetForTests();
    await app.close();
  });

  it('preserves snapshot, live-event, duplicate-event, and named-heartbeat bytes', async () => {
    const status: DebugPlaywrightState = {
      isOpen: true,
      url: 'https://example.test/',
      title: 'Example',
      status: 'ready',
      reason: 'navigate',
    };
    debugEventHub.publish({ type: 'debug.status', status, emittedAt: '2026-01-01T00:00:00.000Z' });

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const controller = new AbortController();
    const response = await fetch(`${address}/debug/api/stream`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('connection')).toBe('keep-alive');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    if (!response.body) throw new Error('debug stream SSE response must have a body');
    const reader = response.body.getReader();

    try {
      const snapshotChunk = await reader.read();
      if (!snapshotChunk.value) throw new Error('debug snapshot frame was not written');
      const snapshot = expectFrame(snapshotChunk.value, 'debug.snapshot', 0);
      expect(snapshot).toMatchObject({ type: 'debug.snapshot', status });

      const event: DebugStreamEvent = {
        type: 'debug.error',
        code: 'bridge_failure',
        message: 'baseline event',
        emittedAt: '2026-01-01T00:00:01.000Z',
      };
      debugEventHub.publish(event);
      const liveChunk = await reader.read();
      if (!liveChunk.value) throw new Error('debug event frame was not written');
      expect(expectFrame(liveChunk.value, 'debug.error', 2)).toMatchObject(event);

      debugEventHub.publish({ ...event, seq: 2 });
      const duplicateChunk = await reader.read();
      if (!duplicateChunk.value) throw new Error('duplicate debug event frame was not written');
      expect(expectFrame(duplicateChunk.value, 'debug.error', 2)).toMatchObject(event);

      const heartbeatRead = reader.read();
      await vi.advanceTimersByTimeAsync(15_000);
      const heartbeatChunk = await heartbeatRead;
      if (!heartbeatChunk.value) throw new Error('debug heartbeat frame was not written');
      expect(expectFrame(heartbeatChunk.value, 'debug.keepalive', 3)).toMatchObject({
        type: 'debug.keepalive',
      });
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  });
});
