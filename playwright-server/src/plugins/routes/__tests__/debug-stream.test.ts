import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import http from 'node:http';
import debugStreamRoutes from '../debug-stream.js';
import { debugEventHub } from '../../../services/debug-event-hub.js';

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
  rawBody: string;
}> {
  const { timeoutMs = 1500, maxEvents = 1, headers: requestHeaders } = options;

  return new Promise((resolve, reject) => {
    const events: ParsedSSEEvent[] = [];
    const responseHeaders: Record<string, string> = {};
    const rawChunks: string[] = [];
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
        rawBody: rawChunks.join(''),
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
        const text = chunk.toString();
        rawChunks.push(text);
        buffer += text;

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

const { mockBrowserService } = vi.hoisted(() => ({
  mockBrowserService: {
    getDebugStatus: vi.fn(),
  },
}));

vi.mock('../../../services/browser-service.js', () => ({
  BrowserService: {
    getInstance: vi.fn(() => mockBrowserService),
  },
}));

describe('Debug Stream Routes', () => {
  let app: ReturnType<typeof Fastify>;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    delete process.env.NEBULA_INTERNAL_TOKEN;
    debugEventHub.resetForTests();
    mockBrowserService.getDebugStatus.mockResolvedValue({
      isOpen: false,
      url: null,
      title: null,
      status: 'unknown',
      viewport: null,
      reason: 'snapshot',
    });

    app = Fastify();
    await app.register(debugStreamRoutes);
    await app.ready();

    await new Promise<void>((resolve) => {
      server = app.server;
      server.listen(0, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Failed to resolve server address');
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await app.close();
    debugEventHub.resetForTests();
  });

  it('returns 401 for invalid internal token', async () => {
    process.env.NEBULA_INTERNAL_TOKEN = 'secret';

    const response = await app.inject({
      method: 'GET',
      url: '/stream',
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload)).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('sends snapshot first with SSE headers', async () => {
    const response = await collectSSEEvents(`${baseUrl}/stream`, { maxEvents: 1 });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.events[0]?.event).toBe('debug.snapshot');
    expect(response.events[0]?.id).toBe('0');
    expect(JSON.parse(response.events[0]!.data).seq).toBe(0);
  });

  it('forwards published events after snapshot bootstrap', async () => {
    const streamPromise = collectSSEEvents(`${baseUrl}/stream`, {
      maxEvents: 2,
      timeoutMs: 2000,
    });

    setTimeout(() => {
      debugEventHub.publish({
        type: 'debug.status',
        status: {
          isOpen: true,
          url: 'https://example.com',
          title: 'Example',
          status: 'ready',
          viewport: { width: 1280, height: 720 },
          reason: 'navigate',
        },
        emittedAt: '2026-05-02T00:00:01.000Z',
      });
    }, 20);

    const response = await streamPromise;

    expect(response.events.map((event) => event.event)).toEqual(['debug.snapshot', 'debug.status']);
    expect(JSON.parse(response.events[1]!.data).status.reason).toBe('navigate');
  });

  it('emits debug.keepalive heartbeat events', async () => {
    const intervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation((callback: TimerHandler) => {
        if (typeof callback === 'function') {
          setTimeout(() => callback(), 0);
        }

        return 1 as unknown as NodeJS.Timeout;
      });

    const response = await collectSSEEvents(`${baseUrl}/stream`, {
      maxEvents: 2,
      timeoutMs: 2000,
    });

    intervalSpy.mockRestore();
    expect(response.events[1]?.event).toBe('debug.keepalive');
  });

  it('cleans up subscribers on disconnect', async () => {
    await collectSSEEvents(`${baseUrl}/stream`, { maxEvents: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(debugEventHub.getSubscriberCount()).toBe(0);
  });
});
