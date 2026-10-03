import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserExecutionCapabilities,
  BrowserOperationRecord,
  BrowserSessionView,
  IssuedBrowserLease,
} from '@nebula-link-evo/shared/types/browser-execution';
import { SemanticBrowserClient } from '../semantic-browser-client.js';
import { IntegrationClientError } from '../integration-client-error.js';

vi.mock('axios', () => ({
  default: {
    create: () => {
      throw new Error('browser transport must use BrowserControlClient');
    },
  },
}));

const now = '2026-10-03T00:00:00.000Z';
const capabilities: BrowserExecutionCapabilities = {
  schema: 'nebula.service-capabilities/1.0',
  service: 'proxy-adapter',
  serviceVersion: '2.0.0',
  protocols: { browserExecution: { major: 1, minor: 0 } },
  features: {},
  limits: {},
  generatedAt: now,
};
const session: BrowserSessionView = {
  id: 'session/a',
  status: 'active',
  processEpoch: 3,
  cdpPort: 9222,
  tabs: [{ id: 'tab-1', url: 'about:blank', title: '', isActive: true }],
  activeLeases: [],
  liveView: { available: true, controlAllowed: false },
  viewport: { width: 1920, height: 1080 },
  createdAt: now,
};
const issued: IssuedBrowserLease = {
  lease: {
    id: 'lease-1',
    sessionId: session.id,
    mode: 'control',
    sequence: 1,
    processEpoch: 3,
    status: 'active',
    policy: { tabIds: ['tab-1'], operations: ['page_state'] },
    expiresAt: now,
    createdAt: now,
  },
  token: 'test-opaque-token',
  tokenIssued: true,
};
const operation: BrowserOperationRecord = {
  schema: 'nebula.browser.operation-result/1.0',
  operationId: 'op/a',
  requestHash: 'hash',
  sessionId: session.id,
  leaseId: 'lease-1',
  leaseSequence: 1,
  tabId: 'tab-1',
  kind: 'observe',
  operation: 'text',
  status: 'failed',
  queueSequence: 12,
  acceptedAt: now,
  startedAt: now,
  completedAt: now,
  resolvedTarget: { semantic: '标题', strategy: 'text', candidateIndex: 1, matchedCount: 1 },
  actual: { nested: ['text'] },
  artifacts: [
    {
      id: 'artifact/a',
      kind: 'screenshot',
      sha256: 'hash',
      mimeType: 'image/png',
      sizeBytes: 4,
      snapshotId: 'snapshot-1',
    },
  ],
  error: {
    code: 'target_unavailable',
    message: 'missing',
    retryable: false,
    correlationId: 'corr-op',
    details: { candidate: { index: 1 } },
  },
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function envelope(data: unknown) {
  return json({ data, meta: { requestId: 'r1' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('SemanticBrowserClient shared HTTP adapter', () => {
  it('delegates canonical DTOs without dropping operation/session/event fields', async () => {
    const events = [
      {
        id: 'event-7',
        sessionId: session.id,
        seq: 7,
        type: 'browser.operation.failed',
        entityType: 'operation',
        entityId: operation.operationId,
        correlationId: 'corr-event',
        causationId: 'cause-1',
        stateVersion: 3,
        payload: { nested: true },
        occurredAt: now,
        createdAt: now,
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(capabilities))
      .mockResolvedValueOnce(envelope(session))
      .mockResolvedValueOnce(envelope(session))
      .mockResolvedValueOnce(envelope(events))
      .mockResolvedValueOnce(envelope(issued))
      .mockResolvedValueOnce(envelope({ ...issued.lease, status: 'revoked' }))
      .mockResolvedValueOnce(envelope(operation))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 255, 128, 42])))
      .mockResolvedValueOnce(envelope({ ...session, status: 'closed' }))
      .mockResolvedValueOnce(envelope({ ...session, status: 'closed' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SemanticBrowserClient({ baseUrl: 'http://127.0.0.1:3000' });
    await expect(client.getCapabilities()).resolves.toEqual(capabilities);
    await expect(client.createSession('session-create', { headless: false })).resolves.toEqual(
      session
    );
    await expect(client.getSession(session.id)).resolves.toEqual(session);
    await expect(client.listSessionEvents(session.id, 6, 25)).resolves.toEqual(events);
    await expect(
      client.createLease(session.id, 'lease-create', {
        mode: 'control',
        operations: ['page_state'],
      })
    ).resolves.toEqual(issued);
    await expect(
      client.revokeLease(session.id, issued.lease.id, issued.token!, 'lease-revoke')
    ).resolves.toEqual({ ...issued.lease, status: 'revoked' });
    await expect(client.getOperation(operation.operationId)).resolves.toEqual(operation);
    await expect(client.downloadArtifact(session.id, 'artifact/a')).resolves.toEqual(
      Buffer.from([0, 255, 128, 42])
    );
    await client.closeSession(session.id, 'close-active', {
      leaseId: issued.lease.id,
      leaseToken: issued.token!,
    });
    await client.closeSession(session.id, 'close-inactive');
    expect(String(fetchMock.mock.calls[3][0])).toContain(
      '/sessions/session%2Fa/event-log?afterSeq=6&limit=25'
    );
    expect(String(fetchMock.mock.calls[6][0])).toContain('/operations/op%2Fa');
    for (const [index, key] of [
      [1, 'session-create'],
      [4, 'lease-create'],
      [5, 'lease-revoke'],
      [8, 'close-active'],
      [9, 'close-inactive'],
    ] as const) {
      expect(new Headers(fetchMock.mock.calls[index][1].headers).get('Idempotency-Key')).toBe(key);
    }
    for (const index of [5, 8]) {
      const headers = new Headers(fetchMock.mock.calls[index][1].headers);
      expect(headers.get('Authorization')).toBe('Bearer test-opaque-token');
      expect(headers.get('X-Browser-Lease-ID')).toBe('lease-1');
      expect(fetchMock.mock.calls[index][1].body).toBeUndefined();
    }
    expect(new Headers(fetchMock.mock.calls[9][1].headers).has('Authorization')).toBe(false);
  });

  it.each(['getSession', 'downloadArtifact'] as const)(
    'preserves complete standard HTTP problem for %s',
    async (method) => {
      const problem = {
        code: 'artifact_not_found',
        message: 'missing',
        retryable: false,
        correlationId: 'corr-404',
        details: { nested: { artifactId: 'a' } },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => json(problem, 404))
      );
      const client = new SemanticBrowserClient();
      const promise =
        method === 'getSession' ? client.getSession('s') : client.downloadArtifact('s', 'a');
      await expect(promise).rejects.toBeInstanceOf(IntegrationClientError);
      await expect(promise).rejects.toMatchObject({
        service: 'proxy-adapter',
        ...problem,
        statusCode: 404,
      });
    }
  );

  it('maps unknown HTTP problems and malformed JSON to the shared fallback', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>failure</html>', { status: 503 }))
      .mockResolvedValueOnce(new Response('broken-json'))
      .mockResolvedValueOnce(envelope(undefined));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SemanticBrowserClient();
    await expect(client.getSession('s')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      statusCode: 503,
      retryable: true,
    });
    await expect(client.getSession('s')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      retryable: true,
    });
    await expect(client.getSession('s')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      retryable: true,
    });
  });

  it('preserves the network cause and configurable timeout', async () => {
    const cause = new TypeError('network failed');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw cause;
      })
    );
    await expect(new SemanticBrowserClient().getSession('s')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      retryable: true,
      cause,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
          })
      )
    );
    await expect(new SemanticBrowserClient({ timeoutMs: 5 }).getSession('s')).rejects.toMatchObject(
      {
        code: 'dependency_unavailable',
        retryable: true,
        cause: expect.objectContaining({ name: 'TimeoutError' }),
      }
    );
  });

  it('keeps explicit/env/default URL priority, blank config rejection and loopback boundary', async () => {
    const fetchMock = vi.fn(async (_url: URL) => envelope(session));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PROXY_ADAPTER_URL', 'http://localhost:4000');
    await new SemanticBrowserClient({ baseUrl: 'http://127.0.0.1:5000' }).getSession('s');
    await new SemanticBrowserClient().getSession('s');
    vi.unstubAllEnvs();
    await new SemanticBrowserClient().getSession('s');
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).origin)).toEqual([
      'http://127.0.0.1:5000',
      'http://localhost:4000',
      'http://127.0.0.1:3000',
    ]);
    expect(() => new SemanticBrowserClient({ baseUrl: ' ' })).toThrowError(
      expect.objectContaining({ code: 'dependency_unavailable' })
    );
    expect(() => new SemanticBrowserClient({ baseUrl: 'https://example.com' })).toThrowError(
      expect.objectContaining({ service: 'proxy-adapter', code: 'validation_failed' })
    );
  });
});
