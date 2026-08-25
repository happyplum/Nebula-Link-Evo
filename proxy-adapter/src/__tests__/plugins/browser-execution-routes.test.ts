import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalBrowserArtifactStore } from '../../browser-execution/artifact-store.js';
import { BrowserExecutionRepository } from '../../browser-execution/repository.js';
import {
  BrowserExecutionService,
  type BrowserExecutionBrowser,
} from '../../browser-execution/service.js';
import type {
  BrowserOperationExecutionResult,
  BrowserTabSummary,
  ExecuteBrowserOperationInput,
} from '../../browser-execution/types.js';
import browserExecutionRoutes from '../../plugins/routes/browser-execution.js';
import capabilitiesRoutes from '../../plugins/routes/capabilities.js';
import debugRoutes from '../../plugins/routes/debug/index.js';

class RouteTestBrowser implements BrowserExecutionBrowser {
  readonly open = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly getTabs = vi.fn(
    async (): Promise<BrowserTabSummary[]> => [
      { id: '52d25db9-d44f-497a-9ec6-580aab5a4905', url: 'about:blank', title: '', isActive: true },
    ]
  );
  readonly execute = vi.fn(
    async (_input: ExecuteBrowserOperationInput): Promise<BrowserOperationExecutionResult> => ({
      actual: 'about:blank',
    })
  );
  readonly captureScreenshot = vi.fn(async () => ({
    kind: 'screenshot' as const,
    mimeType: 'image/png' as const,
    bytes: Buffer.from('route-png'),
  }));
  readonly captureDomSnapshot = vi.fn(async () => ({
    kind: 'dom_snapshot' as const,
    mimeType: 'application/json' as const,
    bytes: Buffer.from(JSON.stringify({ snapshot_id: 'route-snapshot' })),
    snapshotId: 'route-snapshot',
  }));
}

describe('browser execution HTTP contract', () => {
  let app: ReturnType<typeof Fastify>;
  let service: BrowserExecutionService;
  let artifactDirectory: string;

  beforeEach(async () => {
    app = Fastify();
    artifactDirectory = mkdtempSync(join(tmpdir(), 'nebula-browser-route-artifacts-'));
    service = new BrowserExecutionService({
      repository: new BrowserExecutionRepository(':memory:'),
      browser: new RouteTestBrowser(),
      artifactStore: new LocalBrowserArtifactStore(artifactDirectory),
    });
    service.initialize();
    await app.register(capabilitiesRoutes, {
      prefix: '/api/v1',
      browserExecutionService: service,
    });
    await app.register(browserExecutionRoutes, {
      prefix: '/api/v1/browser-execution',
      browserExecutionService: service,
    });
    await app.register(debugRoutes, {
      prefix: '/debug',
      browserExecutionService: service,
    });
    await app.ready();
  });

  afterEach(async () => {
    service.close();
    await app.close();
    rmSync(artifactDirectory, { recursive: true, force: true });
  });

  it('advertises the single-session visual browser and durable ledger capabilities', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schema: 'nebula.service-capabilities/1.0',
      service: 'proxy-adapter',
      protocols: {
        browserExecution: { major: 1, minor: 0 },
        browserOperation: { major: 1, minor: 0 },
      },
      features: {
        persistentOperationLedger: true,
        visibleBrowser: true,
        liveView: true,
        storageStateSwitching: false,
        operationCaptureArtifacts: true,
        browserSessionEvents: true,
        artifactDownload: true,
        supportedObservations: expect.stringContaining('dom_snapshot'),
      },
      limits: {
        maxActiveBrowserSessions: 1,
        maxBrowserContextsPerSession: 1,
      },
    });
  });

  it('requires Idempotency-Key for session creation and returns ApiProblem', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/browser-execution/sessions',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_failed',
      retryable: false,
    });
    expect(response.json().correlationId).toEqual(expect.any(String));
  });

  it('creates, reads, leases, and closes a session through the versioned API', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/browser-execution/sessions',
      headers: {
        'idempotency-key': 'create-session-1',
        'x-correlation-id': 'contract-test',
      },
      payload: { viewport: { width: 1440, height: 900 } },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();
    expect(created.meta.correlationId).toBe('contract-test');
    expect(created.data).toMatchObject({
      status: 'active',
      viewport: { width: 1440, height: 900 },
      tabs: [{ id: '52d25db9-d44f-497a-9ec6-580aab5a4905', isActive: true }],
    });
    const sessionId = created.data.id as string;

    const leaseResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/browser-execution/sessions/${sessionId}/leases`,
      headers: { 'idempotency-key': 'create-lease-1' },
      payload: { mode: 'control' },
    });
    expect(leaseResponse.statusCode).toBe(201);
    const issued = leaseResponse.json().data;
    expect(issued.tokenIssued).toBe(true);
    expect(issued.token).toEqual(expect.any(String));
    expect(issued.lease).not.toHaveProperty('tokenHash');

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/browser-execution/sessions/${sessionId}`,
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().data.activeLeases).toHaveLength(1);
    expect(JSON.stringify(getResponse.json())).not.toContain(issued.token);

    const deniedClose = await app.inject({
      method: 'DELETE',
      url: `/api/v1/browser-execution/sessions/${sessionId}`,
      headers: { 'idempotency-key': 'close-session-denied' },
    });
    expect(deniedClose.statusCode).toBe(403);
    expect(deniedClose.json().code).toBe('permission_denied');

    const closeResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/browser-execution/sessions/${sessionId}`,
      headers: {
        'idempotency-key': 'close-session-1',
        'x-browser-lease-id': issued.lease.id,
        authorization: `Bearer ${issued.token}`,
      },
    });
    expect(closeResponse.statusCode).toBe(200);
    expect(closeResponse.json().data.status).toBe('closed');
    expect(closeResponse.json().data.activeLeases).toEqual([]);
  });

  it('returns a submitted operation from the durable query route', async () => {
    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/browser-execution/sessions',
      headers: { 'idempotency-key': 'create-session-op' },
      payload: {},
    });
    const sessionId = sessionResponse.json().data.id as string;
    const leaseResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/browser-execution/sessions/${sessionId}/leases`,
      headers: { 'idempotency-key': 'create-lease-op' },
      payload: { mode: 'observe' },
    });
    const issued = leaseResponse.json().data;
    const operationId = '594bcf93-a8e6-4b4e-8640-060214f05aa0';
    await service.executeOperation({
      sessionId,
      leaseId: issued.lease.id,
      leaseToken: issued.token,
      tabId: '52d25db9-d44f-497a-9ec6-580aab5a4905',
      request: {
        schema: 'nebula.browser.operation/1.0',
        operationId,
        leaseSequence: issued.lease.sequence,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        kind: 'observe',
        operation: 'url',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/browser-execution/operations/${operationId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      schema: 'nebula.browser.operation-result/1.0',
      operationId,
      status: 'succeeded',
      actual: 'about:blank',
    });
  });

  it('downloads captured evidence and queries the durable event log', async () => {
    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/browser-execution/sessions',
      headers: { 'idempotency-key': 'create-session-artifact' },
      payload: {},
    });
    const sessionId = sessionResponse.json().data.id as string;
    const leaseResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/browser-execution/sessions/${sessionId}/leases`,
      headers: { 'idempotency-key': 'create-lease-artifact' },
      payload: { mode: 'observe' },
    });
    const issued = leaseResponse.json().data;
    const operation = await service.executeOperation({
      sessionId,
      leaseId: issued.lease.id,
      leaseToken: issued.token,
      tabId: '52d25db9-d44f-497a-9ec6-580aab5a4905',
      request: {
        schema: 'nebula.browser.operation/1.0',
        operationId: 'b879376e-c6e7-4987-99ff-e1b28fcc687e',
        leaseSequence: issued.lease.sequence,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        kind: 'observe',
        operation: 'dom_snapshot',
      },
    });

    const artifactResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/browser-execution/sessions/${sessionId}/artifacts/${operation.artifacts[0]!.id}`,
    });
    expect(artifactResponse.statusCode).toBe(200);
    expect(artifactResponse.headers['content-type']).toContain('application/json');
    expect(JSON.parse(artifactResponse.body)).toMatchObject({ snapshot_id: 'route-snapshot' });

    const eventLogResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/browser-execution/sessions/${sessionId}/event-log?afterSeq=0&limit=100`,
    });
    expect(eventLogResponse.statusCode).toBe(200);
    expect(eventLogResponse.json().data.map((event: { type: string }) => event.type)).toContain(
      'artifact.created'
    );
  });

  it('boots the session event stream from a fresh snapshot', async () => {
    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/browser-execution/sessions',
      headers: { 'idempotency-key': 'create-session-stream' },
      payload: {},
    });
    const sessionId = sessionResponse.json().data.id as string;
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const response = await fetch(
      `${address}/api/v1/browser-execution/sessions/${sessionId}/events`,
      { signal: controller.signal }
    );
    const reader = response.body!.getReader();
    const firstChunk = await reader.read();
    controller.abort();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(new TextDecoder().decode(firstChunk.value)).toContain('event: browser_session.snapshot');
  });

  it('returns browser_busy when direct debug mutation or capture would bypass a controlled session', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/browser-execution/sessions',
      headers: { 'idempotency-key': 'create-session-debug-gate' },
      payload: {},
    });

    const navigate = await app.inject({
      method: 'POST',
      url: '/debug/api/playwright/navigate',
      payload: { url: 'https://example.test' },
    });
    const dom = await app.inject({ method: 'GET', url: '/debug/api/dom' });
    const status = await app.inject({ method: 'GET', url: '/debug/api/playwright/status' });

    expect(navigate.statusCode).toBe(409);
    expect(navigate.json().code).toBe('browser_busy');
    expect(dom.statusCode).toBe(409);
    expect(dom.json().code).toBe('browser_busy');
    expect(status.statusCode).toBe(200);
  });

  it.each([
    ['/debug/api/playwright/navigate', {}, { url: {} }],
    [
      '/debug/api/playwright/type',
      { selector: '#name' },
      { selector: '#name', text: {} },
    ],
    [
      '/debug/api/playwright/action',
      { selector: '#save' },
      { selector: '#save', action: {} },
    ],
    ['/debug/api/playwright/scroll', { x: 1 }, { x: {}, y: 2 }],
  ])('rejects malformed bodies before handling %s', async (url, missing, wrongType) => {
    for (const payload of [missing, wrongType]) {
      const response = await app.inject({ method: 'POST', url, payload });

      expect(response.statusCode).toBe(400);
    }
  });
});
