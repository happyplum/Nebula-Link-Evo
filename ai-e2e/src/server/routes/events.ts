/**
 * SSE Events Route
 *
 * Server-Sent Events endpoint for streaming real-time project events
 * to connected clients. Uses the existing sseEmitter plugin infrastructure.
 */

import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import fp from '../plugins/fastify-plugin.js';
import { DatabaseManager } from '../../database/db.js';
import { ServiceError } from '../../services/service-error.js';
import type { SSEEvent } from '../../types/sse-events.js';
import type { ProjectStatus } from '../../types/project.js';

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Format an SSE event as per the spec: `event: {type}\ndata: {JSON}\n\n`
 */
export function formatSSEEvent(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Format an SSE comment line: `: {comment}\n\n`
 */
export function formatSSEComment(comment: string): string {
  return `: ${comment}\n\n`;
}

/**
 * Build an initial snapshot event representing the current project state.
 * Uses `project.status_changed` with oldStatus === newStatus to signal
 * the initial state on connect.
 */
function buildSnapshotEvent(projectId: string): SSEEvent {
  const db = DatabaseManager.getInstance();
  const project = db.getProjectRepo().findById(projectId);
  // Project existence already validated before this call
  const status = project!.status as ProjectStatus;
  return {
    type: 'project.status_changed',
    timestamp: new Date().toISOString(),
    data: {
      projectId,
      oldStatus: status,
      newStatus: status,
    },
  };
}

const eventsRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get('/', {
    schema: {
      description: 'SSE endpoint for real-time project events',
      tags: ['Events'],
      params: Type.Object({
        id: Type.String({ description: 'Project ID' }),
      }),
    },
  }, async (request, reply) => {
    const { id: projectId } = request.params as { id: string };
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().findById(projectId);
    if (!project) {
      throw ServiceError.notFound(`Project '${projectId}' not found`);
    }

    // Take over the raw response for SSE streaming
    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send initial snapshot
    const snapshot = buildSnapshotEvent(projectId);
    reply.raw.write(formatSSEEvent(snapshot));

    // Subscribe to future events — filter by projectId
    const unsubscribe = fastify.sseEmitter.onClient((event: SSEEvent) => {
      const eventData = event.data as Record<string, unknown> | undefined;
      if (eventData && eventData.projectId === projectId) {
        reply.raw.write(formatSSEEvent(event));
      }
    });

    // Heartbeat to keep connection alive
    const heartbeatTimer = setInterval(() => {
      reply.raw.write(formatSSEComment('heartbeat'));
    }, HEARTBEAT_INTERVAL_MS);

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      unsubscribe();
      clearInterval(heartbeatTimer);
    });
  });
};

export default fp(eventsRoutes, { fastify: '5.x', name: 'events-routes', encapsulate: true });
