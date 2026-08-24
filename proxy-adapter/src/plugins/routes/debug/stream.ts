import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type {
  DebugPlaywrightState,
  DebugStreamEvent,
} from '@nebula-link-evo/shared/types/debug-events.js';
import { eventToSSEFormat } from '@nebula-link-evo/shared/types/sse-events';
import { browserClient } from '../../../browser-client.js';
import { debugEventHub } from '../../../services/debug-event-hub.js';

function writeDebugEvent(
  reply: { raw: { write: (chunk: string) => void } },
  event: DebugStreamEvent
): void {
  const eventId = event.seq !== undefined ? String(event.seq) : '';
  const formatted = eventToSSEFormat(event, eventId);
  reply.raw.write(`event: ${formatted.event}\nid: ${eventId}\ndata: ${formatted.data}\n\n`);
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
      const bufferedEvents: DebugStreamEvent[] = [];
      let bootstrapComplete = false;

      const unsubscribe = debugEventHub.subscribe((event) => {
        try {
          if (!bootstrapComplete) {
            bufferedEvents.push(event);
            return;
          }

          writeDebugEvent(reply, event);
        } catch {
          // Ignore disconnect/write failures.
        }
      });

      try {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        writeDebugEvent(reply, buildSnapshotEvent(await buildSnapshotStatus()));

        bootstrapComplete = true;
        for (const event of bufferedEvents) {
          writeDebugEvent(reply, event);
        }
      } catch (error) {
        unsubscribe();
        throw error;
      }

      const heartbeatInterval = setInterval(() => {
        try {
          writeDebugEvent(reply, {
            type: 'debug.keepalive',
            seq: debugEventHub.getNextSeq(),
            emittedAt: new Date().toISOString(),
          });
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15000);

      return new Promise<void>((resolve) => {
        request.raw.on('close', () => {
          clearInterval(heartbeatInterval);
          unsubscribe();
          resolve();
        });
      });
    }
  );
};

export default debugStreamRoutes;
