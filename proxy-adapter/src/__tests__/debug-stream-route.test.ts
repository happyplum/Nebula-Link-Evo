import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import http from 'node:http';
import { browserClient } from '../browser-client.js';
import debugStreamRoutes from '../plugins/routes/debug/stream.js';
import debugRoutes from '../plugins/routes/debug/index.js';
import { debugEventHub } from '../services/debug-event-hub.js';
import type { DebugPlaywrightState, DebugStreamEvent } from '@nebula-link-evo/shared/types/debug-events.js';

interface ParsedSSEEvent {
  event: string;
  id?: string;
  data: string;
}

async function collectSSEEvents(
  url: string,
  options: {
    timeoutMs?: number;
    maxEvents?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  events: ParsedSSEEvent[];
}> {
  const { timeoutMs = 1500, maxEvents = 1, headers: requestHeaders } = options;

  return new Promise((resolve, reject) => {
    const events: ParsedSSEEvent[] = [];
    const responseHeaders: Record<string, string> = {};
    let buffer = '';
    let currentEvent: ParsedSSEEvent | null = null;
    let statusCode = 0;
    let settled = false;
    let responseClosed = false;

    const finalize = (req: http.ClientRequest) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      if (!responseClosed) {
        req.destroy();
      }

      resolve({
        statusCode,
        headers: responseHeaders,
        events,
      });
    };

    const req = http.request(url, { method: 'GET', headers: requestHeaders }, (res) => {
      statusCode = res.statusCode ?? 0;

      for (const [key, value] of Object.entries(res.headers)) {
        if (typeof value === 'string') {
          responseHeaders[key] = value;
        } else if (Array.isArray(value)) {
          responseHeaders[key] = value.join(', ');
        }
      }

      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith(':')) {
            continue;
          }

          if (line.startsWith('event:')) {
            currentEvent = { event: line.slice(6).trim(), data: '' };
            continue;
          }

          if (line.startsWith('id:')) {
            if (currentEvent) {
              currentEvent.id = line.slice(3).trim();
            }
            continue;
          }

          if (line.startsWith('data:')) {
            if (currentEvent) {
              currentEvent.data += line.slice(5).trim();
            }
            continue;
          }

          if (line.trim() === '' && currentEvent) {
            events.push(currentEvent);
            currentEvent = null;
            if (events.length >= maxEvents) {
              finalize(req);
              return;
            }
          }
        }
      });

      res.on('end', () => {
        responseClosed = true;
        finalize(req);
      });

      res.on('close', () => {
        responseClosed = true;
        finalize(req);
      });

      res.on('error', (error) => {
        responseClosed = true;
        if (!settled) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      if (!settled) {
        reject(error);
      }
    });

    const timer = setTimeout(() => {
      finalize(req);
    }, timeoutMs);

    req.end();
  });
}

const { mockAppService } = vi.hoisted(() => ({
  mockAppService: {
    getConfig: vi.fn(() => ({ providers: {} })),
    getMCPSDKClient: vi.fn(() => ({
      callTool: vi.fn().mockResolvedValue({ ok: true }),
    })),
    getMCPStatus: vi.fn(() => ({ enabled: true, servers: [] })),
    getMCPTools: vi.fn(() => []),
    testAIConnectivity: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../services/index.js', () => ({
  AppService: {
    getInstance: vi.fn(() => mockAppService),
  },
  appService: mockAppService,
}));

function createStatus(reason: DebugPlaywrightState['reason'] = 'snapshot'): DebugPlaywrightState {
  return {
    isOpen: true,
    url: 'https://example.com',
    title: 'Example',
    status: 'ready',
    viewport: { width: 1440, height: 900 },
    reason,
  };
}

describe('debug stream route', () => {
  beforeEach(() => {
    debugEventHub.resetForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    debugEventHub.resetForTests();
  });

  it('sends snapshot first with cached hub status and SSE headers', async () => {
    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await app.register(debugStreamRoutes);
    await app.ready();

    debugEventHub.publish({
      type: 'debug.status',
      status: createStatus('navigate'),
      emittedAt: '2026-05-02T00:00:00.000Z',
    });

    await new Promise<void>((resolve, reject) => {
      app.server.listen(0, async () => {
        try {
          const address = app.server.address();
          if (!address || typeof address === 'string') {
            throw new Error('Missing address');
          }

          const response = await collectSSEEvents(`http://127.0.0.1:${address.port}/stream`, { maxEvents: 1 });
          expect(response.statusCode).toBe(200);
          expect(response.headers['content-type']).toBe('text/event-stream');
          expect(response.headers['cache-control']).toBe('no-cache');
          expect(response.events[0]?.event).toBe('debug.snapshot');
          expect(response.events[0]?.id).toBe('0');

          const payload = JSON.parse(response.events[0]!.data) as Extract<DebugStreamEvent, { type: 'debug.snapshot' }>;
          expect(payload.seq).toBe(0);
          expect(payload.status.reason).toBe('navigate');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    await app.close();
  });

  it('falls back to browserClient.getStatus when hub cache is empty', async () => {
    vi.spyOn(browserClient, 'getStatus').mockResolvedValue({
      isOpen: false,
      url: undefined,
      title: undefined,
      viewport: undefined,
    });

    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await app.register(debugStreamRoutes);
    await app.ready();

    const response = await new Promise<Awaited<ReturnType<typeof collectSSEEvents>>>(async (resolve, reject) => {
      app.server.listen(0, async () => {
        try {
          const address = app.server.address();
          if (!address || typeof address === 'string') {
            throw new Error('Missing address');
          }

          resolve(await collectSSEEvents(`http://127.0.0.1:${address.port}/stream`, { maxEvents: 1 }));
        } catch (error) {
          reject(error);
        }
      });
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.events[0]?.event).toBe('debug.snapshot');
    expect(response.events[0]?.data).toContain('"isOpen":false');

    await app.close();
  });

  it('forwards local debug.error events after bootstrap', async () => {
    vi.spyOn(browserClient, 'getStatus').mockResolvedValue({ isOpen: false });

    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await app.register(debugStreamRoutes);
    await app.ready();

    const responsePromise = new Promise<ParsedSSEEvent[]>(async (resolve, reject) => {
      app.server.listen(0, async () => {
        try {
          const address = app.server.address();
          if (!address || typeof address === 'string') {
            throw new Error('Missing address');
          }

          const streamPromise = collectSSEEvents(`http://127.0.0.1:${address.port}/stream`, {
            maxEvents: 2,
            timeoutMs: 2000,
          });

          setTimeout(() => {
            debugEventHub.publish({
              type: 'debug.error',
              code: 'bridge_failure',
              message: 'bridge degraded',
              emittedAt: '2026-05-02T00:00:01.000Z',
            });
          }, 20);

          resolve((await streamPromise).events);
        } catch (error) {
          reject(error);
        }
      });
    });

    const events = await responsePromise;
    expect(events.map((event) => event.event)).toEqual(['debug.snapshot', 'debug.error']);
    expect(JSON.parse(events[1]!.data).code).toBe('bridge_failure');

    await app.close();
  });

  it('emits debug.keepalive heartbeat events', async () => {
    vi.spyOn(browserClient, 'getStatus').mockResolvedValue({ isOpen: false });
    const intervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation((callback: TimerHandler) => {
        if (typeof callback === 'function') {
          setTimeout(() => callback(), 0);
        }

        return 1 as unknown as NodeJS.Timeout;
      });

    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await app.register(debugStreamRoutes);
    await app.ready();

    const events = await new Promise<ParsedSSEEvent[]>(async (resolve, reject) => {
      app.server.listen(0, async () => {
        try {
          const address = app.server.address();
          if (!address || typeof address === 'string') {
            throw new Error('Missing address');
          }

          resolve((await collectSSEEvents(`http://127.0.0.1:${address.port}/stream`, {
            maxEvents: 2,
            timeoutMs: 2000,
          })).events);
        } catch (error) {
          reject(error);
        }
      });
    });

    expect(events.map((event) => event.event)).toEqual(['debug.snapshot', 'debug.keepalive']);
    expect(JSON.parse(events[1]!.data).seq).toBeGreaterThan(0);

    intervalSpy.mockRestore();
    await app.close();
  });

  it('publishes debug.mcp_invalidated before returning a successful MCP call response', async () => {
    vi.spyOn(browserClient, 'getStatus').mockResolvedValue({ isOpen: false });
    mockAppService.getMCPSDKClient.mockReturnValue({
      callTool: vi.fn().mockResolvedValue({ ok: true, value: 1 }),
    });

    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await app.register(debugRoutes, { prefix: '/debug' });
    await app.ready();

    const eventsPromise = new Promise<ParsedSSEEvent[]>(async (resolve, reject) => {
      app.server.listen(0, async () => {
        try {
          const address = app.server.address();
          if (!address || typeof address === 'string') {
            throw new Error('Missing address');
          }

          const baseUrl = `http://127.0.0.1:${address.port}`;
          const streamPromise = collectSSEEvents(`${baseUrl}/debug/api/stream`, {
            maxEvents: 2,
            timeoutMs: 2000,
          });

          setTimeout(() => {
            http.request(
              `${baseUrl}/debug/api/mcp/call`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
              },
              (res) => {
                res.resume();
              }
            ).end(JSON.stringify({ server: 'test', tool: 'ping', args: { value: 1 } }));
          }, 20);

          resolve((await streamPromise).events);
        } catch (error) {
          reject(error);
        }
      });
    });

    const events = await eventsPromise;
    expect(events.map((event) => event.event)).toEqual(['debug.snapshot', 'debug.mcp_invalidated']);

    const invalidatedPayload = JSON.parse(events[1]!.data) as Extract<DebugStreamEvent, { type: 'debug.mcp_invalidated' }>;
    expect(invalidatedPayload.scope).toBe('all');
    expect(invalidatedPayload.reason).toBe('tool_call');

    await app.close();
  });
});
