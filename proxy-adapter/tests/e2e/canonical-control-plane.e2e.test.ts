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
    targetUrl = await targetApp.listen({ host: '127.0.0.1', port: 0 });
    mcpTransport = new StreamableHTTPClientTransport(new URL('/mcp', proxyUrl));
    await mcpClient.connect(mcpTransport);
  });

  afterAll(async () => {
    await mcpTransport.close();
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

    await client.closeSession(session.id, 'mcp-browser-session-close', {
      leaseId: binding.leaseId,
      leaseToken: binding.leaseToken,
    });
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
