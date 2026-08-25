import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp as buildProxyApp } from '../../src/server.js';
import { SemanticBrowserClient } from '../../../ai-e2e/src/infrastructure/semantic-browser-client.js';
import { BrowserControlClient } from '../../../integrations/browser-control-client/src/client.js';

describe('canonical cross-service control planes', () => {
  interface BrowserToolResult extends Record<string, unknown> {
    operationId: string;
    status: string;
    artifacts: Array<{ kind: string }>;
  }

  let root: string;
  let proxyUrl: string;
  let proxyApp: Awaited<ReturnType<typeof buildProxyApp>>;
  const targetApp = Fastify({ logger: false });
  const mcpClient = new Client({ name: 'canonical-control-plane-e2e', version: '1.0.0' });
  let mcpTransport: StreamableHTTPClientTransport;
  let targetUrl: string;
  let slowNavigationGate = Promise.resolve();
  let releaseSlowNavigation = (): void => undefined;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'nebula-control-plane-e2e-'));
    proxyApp = await buildProxyApp({ dataDir: join(root, 'proxy'), skipBackups: true });
    proxyUrl = await proxyApp.listen({ host: '127.0.0.1', port: 0 });
    targetApp.get('/', async (_request, reply) =>
      reply.type('text/html').send(`<!doctype html>
        <label for="username">User name</label>
        <input id="username" />
        <button type="button" onclick="document.querySelector('#result').textContent = 'Created ' + document.querySelector('#username').value">Add user</button>
        <p id="result"></p>`)
    );
    targetApp.get('/slow', async (_request, reply) => {
      await slowNavigationGate;
      return reply.type('text/html').send('<!doctype html><title>Slow operation completed</title>');
    });
    targetUrl = await targetApp.listen({ host: '127.0.0.1', port: 0 });
    mcpTransport = new StreamableHTTPClientTransport(new URL('/mcp', proxyUrl));
    await mcpClient.connect(mcpTransport);
  });

  afterAll(async () => {
    releaseSlowNavigation();
    await mcpTransport.close().catch(() => undefined);
    await Promise.all([proxyApp.close(), targetApp.close()]);
    await rm(root, { recursive: true, force: true });
  });

  it('uses the canonical proxy browser session and lease API with real Chromium', async () => {
    const client = new SemanticBrowserClient({ baseUrl: proxyUrl, timeoutMs: 30_000 });
    const capabilities = await client.getCapabilities();
    expect(capabilities).toMatchObject({
      service: 'proxy-adapter',
      protocols: { browserExecution: { major: 1 } },
    });

    const session = await client.createSession('cross-service-browser-session', {
      viewport: { width: 1024, height: 768 },
    });
    expect(session.status).toBe('active');
    expect(session.tabs).toHaveLength(1);

    const issued = await client.createLease(session.id, 'cross-service-browser-lease', {
      mode: 'control',
      ttlSeconds: 30,
    });
    expect(issued.tokenIssued).toBe(true);
    const leaseToken = requireValue(issued.token, 'Control lease must include its token');
    await client.revokeLease(
      session.id,
      issued.lease.id,
      leaseToken,
      'cross-service-browser-lease-revoke'
    );
    const closeLease = await client.createLease(session.id, 'cross-service-browser-close-lease', {
      mode: 'control',
      ttlSeconds: 30,
    });
    const closeLeaseToken = requireValue(
      closeLease.token,
      'Session close lease must include its token'
    );
    const closed = await client.closeSession(session.id, 'cross-service-browser-session-close', {
      leaseId: closeLease.lease.id,
      leaseToken: closeLeaseToken,
    });
    expect(closed.status).toBe('closed');

    const legacy = await fetch(`${proxyUrl}/api/capabilities`);
    expect(legacy.status).toBe(404);
  });

  it('executes canonical MCP browser operations against a real page', async () => {
    const client = new SemanticBrowserClient({ baseUrl: proxyUrl, timeoutMs: 30_000 });
    const session = await client.createSession('mcp-browser-session', {
      viewport: { width: 1024, height: 768 },
    });
    const issued = await client.createLease(session.id, 'mcp-browser-lease', {
      mode: 'control',
      ttlSeconds: 30,
    });
    const tab = requireValue(session.tabs[0], 'Browser session must expose its initial tab');
    const leaseToken = requireValue(issued.token, 'Control lease must include its token');
    const binding = {
      sessionId: session.id,
      leaseId: issued.lease.id,
      leaseToken,
      tabId: tab.id,
      leaseSequence: issued.lease.sequence,
    };

    await executeBrowserOperation(binding, {
      kind: 'act',
      operation: 'navigate',
      args: { url: targetUrl },
    });
    await executeBrowserOperation(binding, {
      kind: 'act',
      operation: 'fill',
      target: target('User name input', { strategy: 'label', value: 'User name', exact: true }),
      args: { value: 'alice' },
    });
    await executeBrowserOperation(binding, {
      kind: 'act',
      operation: 'click',
      target: target('Add user button', {
        strategy: 'role',
        role: 'button',
        name: 'Add user',
        exact: true,
      }),
    });
    const observed = await executeBrowserOperation(binding, {
      kind: 'observe',
      operation: 'text',
      target: target('Created user result', { strategy: 'css', value: '#result' }),
      capture: { afterScreenshot: true, domSnapshot: true },
    });

    expect(observed).toMatchObject({ status: 'succeeded', actual: 'Created alice' });
    expect(observed.artifacts.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
      'dom_snapshot',
    ]);
    const fetched = await callBrowserTool('browser-control.operation_get', {
      operationId: observed.operationId,
    });
    expect(fetched).toMatchObject({ operationId: observed.operationId, status: 'succeeded' });
    const cancelled = await mcpClient.callTool({
      name: 'browser-control.operation_cancel',
      arguments: {
        operationId: observed.operationId,
        sessionId: binding.sessionId,
        leaseId: binding.leaseId,
        leaseToken: binding.leaseToken,
      },
    });
    expect(cancelled).toMatchObject({ isError: true });

    slowNavigationGate = new Promise<void>((resolve) => {
      releaseSlowNavigation = resolve;
    });
    const runningClient = new BrowserControlClient({ baseUrl: proxyUrl });
    const queuedClient = new BrowserControlClient({ baseUrl: proxyUrl });
    const cancelClient = new BrowserControlClient({ baseUrl: proxyUrl });
    const runningOperationId = randomUUID();
    const running = runningClient.executeOperation(
      binding,
      binding.tabId,
      browserRequest({
        operationId: runningOperationId,
        leaseSequence: binding.leaseSequence,
        kind: 'act',
        operation: 'navigate',
        args: { url: new URL('/slow', targetUrl).toString() },
      })
    );
    let queued: Promise<BrowserToolResult> | undefined;
    try {
      await waitForOperationStatus(runningOperationId, 'running', runningClient);

      await expect(runningClient.getOperation(runningOperationId)).resolves.toMatchObject({
        operationId: runningOperationId,
        status: 'running',
      });
      await expect(readFirstSse(`${proxyUrl}/debug/api/stream`)).resolves.toMatchObject({
        event: 'debug.snapshot',
        data: { status: expect.objectContaining({ isOpen: true }) },
      });
      for (const blocked of [
        { method: 'POST', path: '/debug/api/playwright/navigate', body: { url: targetUrl } },
        { method: 'GET', path: '/debug/api/dom' },
      ]) {
        const response = await fetch(`${proxyUrl}${blocked.path}`, {
          method: blocked.method,
          headers: blocked.body ? { 'content-type': 'application/json' } : undefined,
          body: blocked.body ? JSON.stringify(blocked.body) : undefined,
        });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ code: 'browser_busy' });
      }
      await expect(cancelClient.cancelOperation(runningOperationId, binding)).rejects.toMatchObject(
        { code: 'state_conflict' }
      );

      const queuedOperationId = randomUUID();
      queued = queuedClient.executeOperation(
        binding,
        binding.tabId,
        browserRequest({
          operationId: queuedOperationId,
          leaseSequence: binding.leaseSequence,
          kind: 'observe',
          operation: 'title',
        })
      ) as Promise<BrowserToolResult>;
      await waitForOperationStatus(queuedOperationId, 'queued', queuedClient);
      await expect(cancelClient.cancelOperation(queuedOperationId, binding)).resolves.toMatchObject(
        {
          operationId: queuedOperationId,
          status: 'cancelled',
        }
      );
      releaseSlowNavigation();
      await expect(running).resolves.toMatchObject({
        operationId: runningOperationId,
        status: 'succeeded',
      });
      await expect(queued).resolves.toMatchObject({
        operationId: queuedOperationId,
        status: 'cancelled',
      });
    } finally {
      releaseSlowNavigation();
      await Promise.allSettled([running, ...(queued ? [queued] : [])]);
      await Promise.all([runningClient.close(), queuedClient.close(), cancelClient.close()]).catch(
        () => undefined
      );
    }

    const debugStatus = await fetch(`${proxyUrl}/debug/api/playwright/status`);
    expect(debugStatus.status).toBe(200);
    await expect(debugStatus.json()).resolves.toMatchObject({ success: true, isOpen: true });

    await client.closeSession(session.id, 'mcp-browser-session-close', {
      leaseId: binding.leaseId,
      leaseToken: binding.leaseToken,
    });
    const reopened = await fetch(`${proxyUrl}/debug/api/playwright/open`, { method: 'POST' });
    expect(reopened.status).toBe(200);
    await expect(reopened.json()).resolves.toMatchObject({ success: true });
    await fetch(`${proxyUrl}/debug/api/playwright/close`, { method: 'POST' });
  });

  async function executeBrowserOperation(
    binding: {
      sessionId: string;
      leaseId: string;
      leaseToken: string;
      tabId: string;
      leaseSequence: number;
    },
    operation: Record<string, unknown>
  ): Promise<BrowserToolResult> {
    return callBrowserTool('browser-control.operation_execute', {
      sessionId: binding.sessionId,
      leaseId: binding.leaseId,
      leaseToken: binding.leaseToken,
      tabId: binding.tabId,
      request: {
        schema: 'nebula.browser.operation/1.0',
        operationId: randomUUID(),
        leaseSequence: binding.leaseSequence,
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
        presentation: { animation: 'off' },
        ...operation,
      },
    });
  }

  async function callBrowserTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<BrowserToolResult> {
    const result = await mcpClient.callTool({ name, arguments: args });
    const text = result.content.find(
      (item): item is { type: 'text'; text: string } => item.type === 'text'
    );
    if (!text) throw new Error(`${name} returned no text result`);
    const parsed = JSON.parse(text.text) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error(`${name} returned invalid JSON`);
    return parsed as BrowserToolResult;
  }

  async function waitForOperationStatus(
    operationId: string,
    expected: string,
    client?: BrowserControlClient
  ): Promise<void> {
    await expect
      .poll(async () =>
        client
          ? (await client.getOperation(operationId)).status
          : (await callBrowserTool('browser-control.operation_get', { operationId })).status
      )
      .toBe(expected);
  }

  function browserRequest(
    operation: Record<string, unknown> & {
      operationId: string;
      leaseSequence: number;
      kind: 'act' | 'observe';
      operation: string;
    }
  ) {
    return {
      schema: 'nebula.browser.operation/1.0' as const,
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      presentation: { animation: 'off' as const },
      ...operation,
    };
  }

  async function readFirstSse(
    url: string
  ): Promise<{ event: string; data: Record<string, unknown> }> {
    const controller = new AbortController();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body)
      throw new Error(`SSE request failed with ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('SSE stream ended before its snapshot');
        buffer += decoder.decode(chunk.value, { stream: true });
        const end = buffer.indexOf('\n\n');
        if (end < 0) continue;
        const fields = Object.fromEntries(
          buffer
            .slice(0, end)
            .split('\n')
            .map((line) => {
              const separator = line.indexOf(':');
              return separator < 0
                ? [line, '']
                : [line.slice(0, separator), line.slice(separator + 1).trimStart()];
            })
        );
        return { event: fields.event ?? '', data: JSON.parse(fields.data ?? '{}') };
      }
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  }

  function target(semantic: string, candidate: Record<string, unknown>) {
    return {
      semantic,
      candidates: [candidate],
      expected: { cardinality: 'exactly_one', visible: true },
    };
  }

  function requireValue<T>(value: T | null | undefined, message: string): T {
    if (value === null || value === undefined) throw new Error(message);
    return value;
  }
});
