import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { encodeSseJsonFrame, SnapshotFirstSseWriter } from '@nebula-link-evo/shared';
import type {
  DebugPlaywrightState,
  DebugStreamEvent,
} from '@nebula-link-evo/shared/types/debug-events.js';
import { browserClient } from '../../browser-client.js';
import { debugEventHub } from '../../services/debug-event-hub.js';

function encodeDebugEvent(event: DebugStreamEvent): string {
  const eventId = event.seq !== undefined ? String(event.seq) : '';
  return encodeSseJsonFrame({ event: event.type, id: eventId, data: event });
}

function buildSnapshotEvent(
  status: DebugPlaywrightState
): Extract<DebugStreamEvent, { type: 'debug.snapshot' }> {
  return {
    type: 'debug.snapshot',
    seq: 0,
    status,
    emittedAt: new Date().toISOString(),
  };
}

async function buildSnapshotStatus(): Promise<DebugPlaywrightState> {
  const cachedStatus = debugEventHub.getLatestStatus();
  if (cachedStatus) {
    return cachedStatus;
  }

  const fallbackStatus = await browserClient.getStatus();
  return {
    isOpen: fallbackStatus.isOpen,
    url: fallbackStatus.url ?? null,
    title: fallbackStatus.title ?? null,
    viewport: fallbackStatus.viewport ?? null,
    status: fallbackStatus.isOpen ? 'ready' : 'unhealthy',
    reason: 'snapshot',
  };
}

const debugStreamRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/stream',
    {
      schema: {},
    },
    async (request, reply) => {
      const writer = new SnapshotFirstSseWriter({
        target: reply.raw,
        lifecycleTargets: [request.raw],
        statusCode: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
        getSnapshot: async () => buildSnapshotEvent(await buildSnapshotStatus()),
        getSnapshotSeq: (snapshot) => snapshot.seq,
        getEventSeq: (event) => event.seq,
        encodeSnapshot: encodeDebugEvent,
        encodeEvent: encodeDebugEvent,
        feed: { subscribe: (listener) => debugEventHub.subscribe(listener) },
        maxBufferedEvents: null,
        deduplicate: false,
        heartbeat: {
          intervalMs: 15_000,
          createChunk: () =>
            encodeDebugEvent({
              type: 'debug.keepalive',
              seq: debugEventHub.getNextSeq(),
              emittedAt: new Date().toISOString(),
            }),
        },
      });
      await writer.start();

      return new Promise<void>((resolve) => {
        request.raw.on('close', () => {
          writer.close();
          resolve();
        });
      });
    }
  );
};

export default debugStreamRoutes;
