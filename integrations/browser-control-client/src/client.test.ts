import { describe, expect, it, vi } from 'vitest';
import { BrowserControlClient } from './client.js';
import { BrowserControlError } from './errors.js';
import type { McpToolCaller } from './mcp-tool-caller.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('BrowserControlClient', () => {
  it('rejects non-loopback control endpoints', () => {
    expect(() => new BrowserControlClient({ baseUrl: 'https://example.com' })).toThrowError(
      expect.objectContaining({ code: 'validation_failed' })
    );
  });

  it('maps HTTP envelopes and sends idempotency plus hidden credentials', async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Idempotency-Key')).toBe('idem-1');
      expect(headers.get('X-Browser-Lease-ID')).toBe('lease-1');
      expect(headers.get('Authorization')).toBe('Bearer top-secret');
      return jsonResponse({
        data: { id: 'session-1', status: 'closed', tabs: [], activeLeases: [] },
        meta: { requestId: 'request-1' },
      });
    });
    const client = new BrowserControlClient({
      fetch: fetchMock as typeof fetch,
      mcpToolCaller: { callTool: vi.fn(), close: vi.fn() },
    });

    await client.closeSession('session-1', 'idem-1', {
      leaseId: 'lease-1',
      leaseToken: 'top-secret',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('maps proxy problems to typed client errors', async () => {
    const client = new BrowserControlClient({
      fetch: vi.fn(async () =>
        jsonResponse(
          {
            code: 'browser_busy',
            message: 'busy',
            retryable: true,
            correlationId: 'corr-1',
            details: { nested: { attempt: 2 } },
          },
          409
        )
      ) as typeof fetch,
      mcpToolCaller: { callTool: vi.fn(), close: vi.fn() },
    });

    await expect(client.getSession('session-1')).rejects.toMatchObject({
      code: 'browser_busy',
      retryable: true,
      correlationId: 'corr-1',
      statusCode: 409,
      details: { nested: { attempt: 2 } },
    });
  });

  it('reads encoded session event-log with explicit and default cursors', async () => {
    const events = [
      { id: 'event-7', seq: 7, correlationId: 'corr-event', payload: { nested: true } },
    ];
    const fetchMock = vi.fn(async (_url: URL) => jsonResponse({ data: events, meta: {} }));
    const client = new BrowserControlClient({ fetch: fetchMock as typeof fetch });
    await expect(client.listSessionEvents('session/a b', 6, 25)).resolves.toEqual(events);
    await client.listSessionEvents('session/a b');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://127.0.0.1:3000/api/v1/browser-execution/sessions/session%2Fa%20b/event-log?afterSeq=6&limit=25'
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('?afterSeq=0&limit=500');
  });

  it('closes inactive sessions without credentials and retains idempotency and correlation headers', async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Idempotency-Key')).toBe('close-inactive');
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has('X-Browser-Lease-ID')).toBe(false);
      expect(headers.get('X-Correlation-ID')).toMatch(/^[a-f0-9-]{36}$/);
      expect(headers.has('X-Request-ID')).toBe(false);
      expect(init?.method).toBe('DELETE');
      return jsonResponse({ data: { id: 'session-1', status: 'closed' }, meta: {} });
    });
    const client = new BrowserControlClient({ fetch: fetchMock as typeof fetch });
    await expect(client.closeSession('session-1', 'close-inactive')).resolves.toMatchObject({
      status: 'closed',
    });
  });

  it('downloads artifact bytes and preserves standard artifact 404 problems', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 255, 128, 42])))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: 'artifact_not_found',
            message: 'missing',
            retryable: false,
            correlationId: 'corr-404',
            details: { artifactId: 'artifact/a' },
          },
          404
        )
      );
    const client = new BrowserControlClient({ fetch: fetchMock as typeof fetch });
    await expect(client.downloadArtifact('session/a', 'artifact/a')).resolves.toEqual(
      new Uint8Array([0, 255, 128, 42])
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/sessions/session%2Fa/artifacts/artifact%2Fa'
    );
    await expect(client.downloadArtifact('session/a', 'artifact/a')).rejects.toMatchObject({
      code: 'artifact_not_found',
      message: 'missing',
      statusCode: 404,
      retryable: false,
      correlationId: 'corr-404',
      details: { artifactId: 'artifact/a' },
    });
  });

  it.each([400, 503])('keeps HTTP %s for a nonstandard malformed problem', async (status) => {
    const client = new BrowserControlClient({
      fetch: vi.fn(async () => new Response('broken-json', { status })) as typeof fetch,
    });
    await expect(client.getSession('session-1')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      statusCode: status,
      retryable: status >= 500,
    });
  });

  it('maps invalid success JSON and envelopes to dependency_unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('broken-json'))
      .mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    const client = new BrowserControlClient({ fetch: fetchMock as typeof fetch });
    await expect(client.getSession('session-1')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      retryable: true,
    });
    await expect(client.getSession('session-1')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      retryable: true,
    });
  });

  it('preserves network cause and composes caller cancellation with timeout', async () => {
    const cause = new TypeError('network down');
    const client = new BrowserControlClient({
      fetch: vi.fn(async () => {
        throw cause;
      }) as typeof fetch,
    });
    await expect(client.getSession('session-1')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      retryable: true,
      cause,
    });
    const fetchMock = vi.fn(
      async (_url: URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error('request did not carry an abort signal');
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
    );
    const timed = new BrowserControlClient({
      fetch: fetchMock as typeof fetch,
      requestTimeoutMs: 5,
    });
    await expect(timed.getSession('session-1')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      retryable: true,
      cause: expect.objectContaining({ name: 'TimeoutError' }),
    });
    const controller = new AbortController();
    controller.abort(new Error('caller cancelled'));
    await expect(
      timed.listSessionEvents('session-1', 0, 500, controller.signal)
    ).rejects.toMatchObject({ code: 'dependency_unavailable', cause: controller.signal.reason });
  });

  it('calls the controlled MCP tool and parses its JSON result', async () => {
    const callTool = vi.fn(async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ operationId: 'op-1', status: 'succeeded' }),
        },
      ],
    }));
    const caller: McpToolCaller = { callTool, close: vi.fn() };
    const client = new BrowserControlClient({ mcpToolCaller: caller });

    await expect(
      client.executeOperation(
        { sessionId: 'session-1', leaseId: 'lease-1', leaseToken: 'top-secret' },
        'tab-1',
        {
          schema: 'nebula.browser.operation/1.0',
          operationId: 'op-1',
          leaseSequence: 1,
          deadlineAt: new Date().toISOString(),
          kind: 'observe',
          operation: 'url',
        }
      )
    ).resolves.toMatchObject({ operationId: 'op-1', status: 'succeeded' });
    expect(callTool).toHaveBeenCalledWith(
      'browser-control.operation_execute',
      expect.objectContaining({ leaseToken: 'top-secret', tabId: 'tab-1' }),
      undefined
    );
  });

  it('rejects non-JSON MCP results instead of treating prose as success', async () => {
    const client = new BrowserControlClient({
      mcpToolCaller: {
        callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'permission denied' }] })),
        close: vi.fn(),
      },
    });

    await expect(
      client.cancelOperation('op-1', {
        sessionId: 'session-1',
        leaseId: 'lease-1',
        leaseToken: 'secret',
      })
    ).rejects.toBeInstanceOf(BrowserControlError);
  });

  it('maps structured MCP operation problems to domain errors', async () => {
    const client = new BrowserControlClient({
      mcpToolCaller: {
        callTool: vi.fn(async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                code: 'lease_expired',
                message: 'expired',
                retryable: false,
                correlationId: 'corr-mcp',
              }),
            },
          ],
        })),
        close: vi.fn(),
      },
    });

    await expect(
      client.cancelOperation('op-1', {
        sessionId: 'session-1',
        leaseId: 'lease-1',
        leaseToken: 'secret',
      })
    ).rejects.toMatchObject({ code: 'lease_expired', correlationId: 'corr-mcp' });
  });
});
