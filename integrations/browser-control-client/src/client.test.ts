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

    await client.closeSession(
      'session-1',
      { sessionId: 'session-1', leaseId: 'lease-1', leaseToken: 'top-secret' },
      'idem-1'
    );

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
    });
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
