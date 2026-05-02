import type { FastifyPluginAsync } from 'fastify';
import type { DebugPlaywrightState, DebugStreamEvent } from '@nebula-link-evo/shared/types/debug-events.js';
import { eventToSSEFormat } from '@nebula-link-evo/shared/types/sse-events';
import { BrowserService } from '../../services/browser-service.js';
import { debugEventHub } from '../../services/debug-event-hub.js';

function writeDebugEvent(
  reply: { raw: { write: (chunk: string) => void } },
  event: DebugStreamEvent
): void {
  const eventId = event.seq !== undefined ? String(event.seq) : '';
  const formatted = eventToSSEFormat(event, eventId);
  reply.raw.write(`event: ${formatted.event}\nid: ${eventId}\ndata: ${formatted.data}\n\n`);
}

function buildSnapshotEvent(status: DebugPlaywrightState): DebugStreamEvent {
  return {
    type: 'debug.snapshot',
    seq: 0,
    status,
    emittedAt: new Date().toISOString(),
  };
}

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/stream',
    {
      preHandler: async (request, reply) => {
        const expectedToken = process.env.NEBULA_INTERNAL_TOKEN;
        const providedToken = request.headers['x-nebula-internal-token'];

        if (expectedToken && providedToken !== expectedToken) {
          return reply.code(401).send({ success: false, error: 'Unauthorized' });
        }

        return undefined;
      },
    },
    async (request, reply) => {
      const browserService = BrowserService.getInstance();
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

        const snapshotStatus =
          debugEventHub.getLatestStatus() ?? (await browserService.getDebugStatus('snapshot'));
        writeDebugEvent(reply, buildSnapshotEvent(snapshotStatus));

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

export default routes;
