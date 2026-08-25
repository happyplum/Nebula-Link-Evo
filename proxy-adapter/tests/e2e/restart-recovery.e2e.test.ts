import Fastify from 'fastify';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { BrowserControlClient } from '../../../integrations/browser-control-client/src/client.js';
import { SemanticBrowserClient } from '../../../ai-e2e/src/infrastructure/semantic-browser-client.js';

it('recovers a killed running browser operation without replaying its side effect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nebula-proxy-recovery-e2e-'));
  const targetApp = Fastify({ logger: false });
  let releaseNavigation = (): void => undefined;
  const navigationGate = new Promise<void>((resolve) => {
    releaseNavigation = resolve;
  });
  let firstProcess: ChildProcess | undefined;
  let secondProcess: ChildProcess | undefined;
  let firstControl: BrowserControlClient | undefined;
  let secondControl: BrowserControlClient | undefined;

  try {
    targetApp.get('/slow', async (_request, reply) => {
      await navigationGate;
      return reply.type('text/html').send('<!doctype html><title>Recovered target</title>');
    });
    const targetUrl = await targetApp.listen({ host: '127.0.0.1', port: 0 });
    const firstPort = await availablePort();
    const firstUrl = `http://127.0.0.1:${firstPort}`;
    firstProcess = startProxy(root, firstPort);
    await waitForHttp(`${firstUrl}/api/v1/health`, firstProcess);

    const browser = new SemanticBrowserClient({ baseUrl: firstUrl, timeoutMs: 15_000 });
    firstControl = new BrowserControlClient({ baseUrl: firstUrl, requestTimeoutMs: 15_000 });
    const session = await browser.createSession('restart-recovery-session', {
      viewport: { width: 1024, height: 768 },
    });
    const tab = requireValue(session.tabs[0], 'Recovery session must expose its initial tab');
    const issued = await browser.createLease(session.id, 'restart-recovery-lease', {
      mode: 'control',
      ttlSeconds: 60,
    });
    const credentials = {
      sessionId: session.id,
      leaseId: issued.lease.id,
      leaseToken: requireValue(issued.token, 'Recovery lease must include its token'),
    };
    const operationId = randomUUID();
    const execution = firstControl
      .executeOperation(credentials, tab.id, {
        schema: 'nebula.browser.operation/1.0',
        operationId,
        leaseSequence: issued.lease.sequence,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        kind: 'act',
        operation: 'navigate',
        args: { url: new URL('/slow', targetUrl).toString() },
        presentation: { animation: 'off' },
      })
      .then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error })
      );
    await waitForOperation(firstControl, operationId, 'running');

    await forceStopChild(firstProcess);
    firstProcess = undefined;
    releaseNavigation();
    await expect(execution).resolves.toMatchObject({
      value: undefined,
      error: { code: 'dependency_unavailable' },
    });
    await firstControl.close().catch(() => undefined);
    firstControl = undefined;

    const secondPort = await availablePort();
    const secondUrl = `http://127.0.0.1:${secondPort}`;
    secondProcess = startProxy(root, secondPort);
    await waitForHttp(`${secondUrl}/api/v1/health`, secondProcess);
    secondControl = new BrowserControlClient({ baseUrl: secondUrl, requestTimeoutMs: 15_000 });
    const recoveredBrowser = new SemanticBrowserClient({ baseUrl: secondUrl, timeoutMs: 15_000 });

    await expect(secondControl.getOperation(operationId)).resolves.toMatchObject({
      operationId,
      status: 'outcome_unknown',
      error: { code: 'outcome_unknown', retryable: false },
    });
    await expect(recoveredBrowser.getSession(session.id)).resolves.toMatchObject({
      id: session.id,
      status: 'interrupted',
      activeLeases: [],
      liveView: { available: false, controlAllowed: false },
    });
    await expect(secondControl.cancelOperation(operationId, credentials)).rejects.toMatchObject({
      code: 'state_conflict',
    });
  } finally {
    releaseNavigation();
    await firstControl?.close().catch(() => undefined);
    await secondControl?.close().catch(() => undefined);
    if (firstProcess) await forceStopChild(firstProcess);
    if (secondProcess) await stopChild(secondProcess);
    await targetApp.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

function startProxy(root: string, port: number): ChildProcess {
  return spawn(
    process.execPath,
    [fileURLToPath(new URL('../../dist/server.js', import.meta.url))],
    {
      cwd: root,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PROXY_PORT: String(port),
        TEST_MODE: 'true',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
}

async function waitForOperation(
  client: BrowserControlClient,
  operationId: string,
  expected: string
): Promise<void> {
  await expect.poll(async () => (await client.getOperation(operationId)).status).toBe(expected);
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  if (!port) throw new Error('Failed to allocate a proxy recovery E2E port');
  return port;
}

async function waitForHttp(url: string, child: ChildProcess): Promise<void> {
  let logs = '';
  child.stdout?.on('data', (chunk) => (logs += String(chunk)));
  child.stderr?.on('data', (chunk) => (logs += String(chunk)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`proxy-adapter exited early: ${logs}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`proxy-adapter did not become ready: ${logs}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exited;
}

async function forceStopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
