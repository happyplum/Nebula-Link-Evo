import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import http from 'node:http';
import { DatabaseManager } from '../../../database/db.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import sseEmitterPlugin from '../../plugins/sse-emitter.js';
import eventsRoutes, { formatSSEEvent, formatSSEComment } from '../events.js';

const apps = new Set<FastifyInstance>();

function createApp(): FastifyInstance {
  const app = Fastify()
    .withTypeProvider<TypeBoxTypeProvider>();
  app.register(errorHandlerPlugin);
  app.register(sseEmitterPlugin);
  apps.add(app);
  return app;
}

beforeEach(() => {
  DatabaseManager.resetInstance();
});

afterEach(async () => {
  await Promise.all(Array.from(apps, async app => app.close()));
  apps.clear();
  DatabaseManager.resetInstance();
});

function seedProject(db: DatabaseManager, status = 'draft'): string {
  db.getProjectRepo().create({ name: 'Test Project', target_base_url: 'http://example.com', status });
  const projects = db.getProjectRepo().findAll();
  return projects[0].id;
}

async function startServer(app: FastifyInstance): Promise<number> {
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return Number(new URL(address).port);
}

function connectSSE(port: number, path: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
      },
      resolve,
    );
    req.on('error', reject);
    req.end();
  });
}

function collectData(response: http.IncomingMessage, durationMs: number): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => { data += chunk; });
    setTimeout(() => resolve(data), durationMs);
  });
}

describe('SSE Events endpoint', () => {
  describe('formatSSEEvent', () => {
    it('formats SSE event with type and JSON data', () => {
      const event = {
        type: 'project.status_changed' as const,
        timestamp: '2026-01-01T00:00:00.000Z',
        data: { projectId: 'p1', oldStatus: 'draft', newStatus: 'analyzing' },
      };
      const result = formatSSEEvent(event);
      expect(result).toBe(
        'event: project.status_changed\n'
        + 'data: {"type":"project.status_changed","timestamp":"2026-01-01T00:00:00.000Z","data":{"projectId":"p1","oldStatus":"draft","newStatus":"analyzing"}}\n'
        + '\n',
      );
    });

    it('formats complex event data', () => {
      const event = {
        type: 'execution.completed' as const,
        timestamp: '2026-06-01T12:00:00.000Z',
        data: {
          run: {
            id: 'run-1',
            script_id: 'script-1',
            run_number: 1,
            status: 'pass',
            started_at: '2026-06-01T12:00:00.000Z',
            created_at: '2026-06-01T12:00:00.000Z',
          },
        },
      };
      const result = formatSSEEvent(event);
      expect(result).toContain('event: execution.completed');
      expect(result).toContain('"run":');
      // Verify structure: event line, data line with JSON, trailing blank line
      const parts = result.split('\n');
      expect(parts[0]).toBe('event: execution.completed');
      expect(parts[1]).toMatch(/^data: /);
      expect(parts[2]).toBe('');
      expect(parts[3]).toBe('');
    });
  });

  describe('formatSSEComment', () => {
    it('formats SSE comment with colon prefix', () => {
      expect(formatSSEComment('heartbeat')).toBe(': heartbeat\n\n');
    });

    it('formats arbitrary comment text', () => {
      expect(formatSSEComment('ping 42')).toBe(': ping 42\n\n');
    });
  });

  describe('GET /', () => {
    it('returns 404 for non-existent project', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');

      const app = createApp();
      app.register(eventsRoutes, { prefix: '/api/projects/:id/events' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/projects/nonexistent/events',
      });

      expect(response.statusCode).toBe(404);
    });

    it('establishes SSE connection with correct headers', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const app = createApp();
      app.register(eventsRoutes, { prefix: '/api/projects/:id/events' });
      const port = await startServer(app);

      const response = await connectSSE(port, `/api/projects/${projectId}/events`);

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');

      response.destroy();
    });

    it('sends initial snapshot event on connect', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'analyzing');

      const app = createApp();
      app.register(eventsRoutes, { prefix: '/api/projects/:id/events' });
      const port = await startServer(app);

      const response = await connectSSE(port, `/api/projects/${projectId}/events`);
      const data = await collectData(response, 100);

      expect(data).toContain('event: project.status_changed');
      expect(data).toContain(`"projectId":"${projectId}"`);
      expect(data).toContain('"newStatus":"analyzing"');

      response.destroy();
    });

    it('broadcasts events to connected client', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const app = createApp();
      app.register(eventsRoutes, { prefix: '/api/projects/:id/events' });
      const port = await startServer(app);

      const response = await connectSSE(port, `/api/projects/${projectId}/events`);

      // Wait for initial snapshot to arrive
      await collectData(response, 50);

      // Emit an event
      app.sseEmitter.emit({
        type: 'prd.analysis_progress',
        data: { projectId, phase: 'parsing', progress: 50 },
      });

      const afterEmit = await collectData(response, 100);
      expect(afterEmit).toContain('event: prd.analysis_progress');
      expect(afterEmit).toContain('"progress":50');

      response.destroy();
    });

    it('cleans up client on disconnect', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const app = createApp();
      app.register(eventsRoutes, { prefix: '/api/projects/:id/events' });
      const port = await startServer(app);

      const response = await connectSSE(port, `/api/projects/${projectId}/events`);
      await collectData(response, 50);

      expect(app.sseEmitter.getClientCount()).toBe(1);

      response.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(app.sseEmitter.getClientCount()).toBe(0);
    });

    it('sets up heartbeat timer at correct interval', async () => {
      const spy = vi.spyOn(global, 'setInterval');

      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const app = createApp();
      app.register(eventsRoutes, { prefix: '/api/projects/:id/events' });
      const port = await startServer(app);

      const response = await connectSSE(port, `/api/projects/${projectId}/events`);
      await collectData(response, 50);

      // Verify setInterval was called with 15s interval
      const heartbeatCall = spy.mock.calls.find((call) => call[1] === 15_000);
      expect(heartbeatCall).toBeDefined();

      spy.mockRestore();
      response.destroy();
    });

    it('stops heartbeat timer on client disconnect', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const app = createApp();
      app.register(eventsRoutes, { prefix: '/api/projects/:id/events' });
      const port = await startServer(app);

      const response = await connectSSE(port, `/api/projects/${projectId}/events`);
      await collectData(response, 50);

      response.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });
  });
});
