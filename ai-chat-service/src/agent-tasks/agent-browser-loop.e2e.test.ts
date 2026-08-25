import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgentTaskClient,
  type AgentTaskView,
} from '../../../ai-e2e/src/infrastructure/agent-task-client.js';
import { SemanticBrowserClient } from '../../../ai-e2e/src/infrastructure/semantic-browser-client.js';
import { AgentTaskRepository } from './repository.js';

const TERMINAL_TASK_STATUSES = new Set([
  'completed',
  'failed',
  'interrupted',
  'cancelled',
  'blocked',
]);

interface FullAgentTaskView extends AgentTaskView {
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    modelTurns: number;
    toolCalls: number;
  };
}

it('drives real proxy Chromium through the complete ai-chat-service HTTP Harness lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nebula-agent-browser-process-e2e-'));
  const targetApp = Fastify({ logger: false });
  const proxyPort = await availablePort();
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
  const dataDir = join(root, 'ai-chat');
  const configPath = join(root, 'config.json');
  const trustedPluginLockPath = join(root, 'trusted-harness-plugins.lock.json');
  const proxyProcess = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../../proxy-adapter/dist/server.js', import.meta.url))],
    {
      cwd: root,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PROXY_PORT: String(proxyPort),
        TEST_MODE: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  let aiChatProcess: ChildProcess | undefined;

  try {
    targetApp.get('/', async (_request, reply) =>
      reply.type('text/html').send('<!doctype html><title>Agent target</title><h1>Ready</h1>')
    );
    const targetUrl = await targetApp.listen({ host: '127.0.0.1', port: 0 });
    await mkdir(dataDir, { recursive: true });
    await writeFile(configPath, JSON.stringify(testConfig()), 'utf8');
    await writeFile(trustedPluginLockPath, JSON.stringify(testPluginLock(proxyUrl)), 'utf8');
    await waitForHttp(`${proxyUrl}/api/v1/health`, proxyProcess, 'proxy-adapter');

    const firstStart = await startAiChatProcess({
      root,
      dataDir,
      configPath,
      trustedPluginLockPath,
      proxyUrl,
    });
    aiChatProcess = firstStart.process;
    const aiChatUrl = firstStart.url;
    const agentClient = new AgentTaskClient({ baseUrl: aiChatUrl, timeoutMs: 30_000 });
    const browserClient = new SemanticBrowserClient({ baseUrl: proxyUrl, timeoutMs: 30_000 });

    await expect(agentClient.getCapabilities()).resolves.toMatchObject({
      service: 'ai-chat-service',
      protocols: { 'nebula.ai.agent-task': { major: 1 } },
    });
    const session = await browserClient.createSession('process-agent-browser-session');
    const issued = await browserClient.createLease(session.id, 'process-agent-browser-lease', {
      mode: 'control',
      ttlSeconds: 60,
    });
    const request = {
      schema: 'nebula.ai.agent-task/1.0' as const,
      clientTaskId: 'process-agent-browser-loop',
      modelRole: 'decision' as const,
      input: { objective: 'Navigate the authorized browser to the fixture page' },
      responseSchema: {
        type: 'object',
        properties: { status: { type: 'string', const: 'navigated' } },
        required: ['status'],
        additionalProperties: false,
      },
      toolPolicy: {
        allow: ['browser-control.operation_execute'],
        constraints: {
          'browser-control.operation_execute': {
            steps: [
              {
                stepId: 'navigate-target',
                kind: 'act',
                operation: 'navigate',
                args: { url: targetUrl },
              },
            ],
          },
        },
      },
      skillPolicy: { allow: [] },
      budgets: { maxDurationMs: 30_000, maxModelTurns: 2, maxToolCalls: 1, maxTokens: 2_000 },
      browserBinding: {
        browserSessionId: session.id,
        tabId: session.tabs[0]!.id,
        browserLeaseId: issued.lease.id,
        browserLeaseToken: issued.token!,
        browserLeaseSequence: issued.lease.sequence,
        access: 'control' as const,
      },
    };

    const created = await agentClient.createTask(request, 'process-agent-task-create');
    const snapshot = await readFirstSse(
      `${aiChatUrl}/api/v1/agent-tasks/${encodeURIComponent(created.taskId)}/events`
    );
    expect(snapshot).toMatchObject({
      event: 'agent_task.snapshot',
      data: { type: 'agent_task.snapshot', task: { taskId: created.taskId } },
    });

    const completed = await waitForTask(agentClient, created.taskId);
    if (completed.status !== 'completed') {
      const failedEvents = await getJson<unknown>(
        `${aiChatUrl}/api/v1/agent-tasks/${encodeURIComponent(created.taskId)}/event-log`
      );
      throw new Error(
        `Agent task failed: ${JSON.stringify({ task: completed, events: failedEvents, serviceLogs: firstStart.logs() })}`
      );
    }
    expect(completed).toMatchObject({
      status: 'completed',
      output: { status: 'navigated' },
      usage: { inputTokens: 10, outputTokens: 10, modelTurns: 2, toolCalls: 1 },
      toolCalls: [
        {
          toolName: 'browser-control.operation_execute',
          operation: 'navigate',
          status: 'succeeded',
        },
      ],
    });
    const operationId = completed.toolCalls[0]!.operationId!;
    await expect(browserClient.getOperation(operationId)).resolves.toMatchObject({
      operationId,
      operation: 'navigate',
      status: 'succeeded',
    });
    await expect(browserClient.getSession(session.id)).resolves.toMatchObject({
      tabs: [
        expect.objectContaining({ id: session.tabs[0]!.id, url: new URL(targetUrl).toString() }),
      ],
    });

    const eventLog = await getJson<Array<{ seq: number; type: string }>>(
      `${aiChatUrl}/api/v1/agent-tasks/${encodeURIComponent(created.taskId)}/event-log`
    );
    expect(eventLog.map((event) => event.seq)).toEqual(eventLog.map((_, index) => index + 1));
    expect(eventLog.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'agent_task.created',
        'agent_task.model_turn',
        'agent_task.tool_call',
        'agent_task.state_changed',
      ])
    );
    await expect(
      agentClient.createTask(request, 'process-agent-task-create')
    ).resolves.toMatchObject({
      taskId: created.taskId,
      status: 'completed',
    });
    expect((await fetch(`${aiChatUrl}/api/agent-tasks/${created.taskId}`)).status).toBe(404);

    await stopChild(aiChatProcess);
    aiChatProcess = undefined;
    const repository = new AgentTaskRepository(join(dataDir, 'agent-tasks.sqlite'));
    try {
      const projection = repository.getHarnessProjection(created.taskId);
      expect(projection.projectedDshSeq).toBeGreaterThan(0);
      expect(projection.projectedDshSeq).toBe(projection.durableDshSeq);
    } finally {
      repository.close();
    }

    const secondStart = await startAiChatProcess({
      root,
      dataDir,
      configPath,
      trustedPluginLockPath,
      proxyUrl,
    });
    aiChatProcess = secondStart.process;
    const restartedClient = new AgentTaskClient({ baseUrl: secondStart.url, timeoutMs: 30_000 });
    await expect(restartedClient.getTask(created.taskId)).resolves.toMatchObject({
      taskId: created.taskId,
      status: 'completed',
      output: { status: 'navigated' },
      eventSeq: completed.eventSeq,
    });
    const restartedSnapshot = await readFirstSse(
      `${secondStart.url}/api/v1/agent-tasks/${encodeURIComponent(created.taskId)}/events`
    );
    expect(restartedSnapshot).toMatchObject({
      event: 'agent_task.snapshot',
      id: completed.eventSeq,
      data: { task: { status: 'completed', output: { status: 'navigated' } } },
    });

    await browserClient.closeSession(session.id, 'process-agent-browser-close', {
      leaseId: issued.lease.id,
      leaseToken: issued.token!,
    });
  } finally {
    if (aiChatProcess) await stopChild(aiChatProcess);
    await Promise.all([stopChild(proxyProcess), targetApp.close()]);
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

function testConfig(): Record<string, unknown> {
  return {
    version: '2.0',
    providers: {
      test: {
        enabled: true,
        apiKey: '{E2E_TEST_API_KEY}',
        baseUrl: 'http://127.0.0.1:1/v1',
        models: {
          decision: { type: 'decision', capabilities: ['decision'], maxTokens: 2_000 },
        },
      },
    },
    defaults: { mode: 'unified', decision: 'test/decision' },
    settings: {
      timeout: 30_000,
      maxRetries: 1,
      temperature: 0,
      maxTokens: 2_000,
      maxSteps: 5,
      contextWindowTokens: 10_000,
    },
    mcp: { enabled: false, servers: {} },
  };
}

function testPluginLock(proxyUrl: string): Record<string, unknown> {
  return {
    schema: 'nebula.ai.trusted-harness-plugins/1.0',
    abi: { cordis: '4.0.1', deepseekHarness: '0.1.1-rc.2' },
    plugins: [],
    mcp: [
      {
        transport: 'streamable-http',
        serverName: 'gateway',
        url: new URL('/mcp', proxyUrl).toString(),
        headers: {},
      },
    ],
  };
}

async function startAiChatProcess(options: {
  root: string;
  dataDir: string;
  configPath: string;
  trustedPluginLockPath: string;
  proxyUrl: string;
}): Promise<{ process: ChildProcess; url: string; logs: () => string }> {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../tests/e2e/ai-chat-service-process.mjs', import.meta.url))],
    {
      cwd: options.root,
      env: {
        ...process.env,
        AI_CHAT_E2E_CONFIG_PATH: options.configPath,
        AI_CHAT_E2E_DATA_DIR: options.dataDir,
        AI_CHAT_E2E_PLUGIN_LOCK_PATH: options.trustedPluginLockPath,
        PROXY_ADAPTER_URL: options.proxyUrl,
        E2E_TEST_API_KEY: 'deterministic-test-key',
        TEST_MODE: 'true',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  const ready = await waitForReady(child, 'E2E_AI_CHAT_READY ');
  return { process: child, url: String(ready.data.url), logs: ready.logs };
}

async function waitForReady(
  child: ChildProcess,
  prefix: string
): Promise<{ data: Record<string, unknown>; logs: () => string }> {
  let logs = '';
  let stdout = '';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Service did not become ready: ${logs}`)),
      30_000
    );
    const fail = () => {
      clearTimeout(timeout);
      reject(new Error(`Service exited before ready: ${logs}`));
    };
    child.once('exit', fail);
    child.stderr?.on('data', (chunk) => (logs += String(chunk)));
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      logs += text;
      stdout += text;
      for (const line of stdout.split(/\r?\n/u)) {
        if (!line.startsWith(prefix)) continue;
        clearTimeout(timeout);
        child.off('exit', fail);
        resolve({
          data: JSON.parse(line.slice(prefix.length)) as Record<string, unknown>,
          logs: () => logs,
        });
        return;
      }
      stdout = stdout.slice(Math.max(0, stdout.lastIndexOf('\n') + 1));
    });
  });
}

async function waitForTask(client: AgentTaskClient, taskId: string): Promise<FullAgentTaskView> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const task = (await client.getTask(taskId)) as FullAgentTaskView;
    if (TERMINAL_TASK_STATUSES.has(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent task ${taskId} did not reach a terminal state`);
}

async function readFirstSse(
  url: string
): Promise<{ event: string; id: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`SSE request failed with ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('SSE stream ended before the snapshot');
      buffer += decoder.decode(chunk.value, { stream: true });
      const boundary = buffer.indexOf('\n\n');
      if (boundary < 0) continue;
      const lines = buffer.slice(0, boundary).split('\n');
      const event = lines
        .find((line) => line.startsWith('event:'))
        ?.slice(6)
        .trim();
      const id = Number(
        lines
          .find((line) => line.startsWith('id:'))
          ?.slice(3)
          .trim()
      );
      const data = lines
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim();
      if (!event || !Number.isSafeInteger(id) || !data) throw new Error('Invalid SSE snapshot');
      return { event, id, data: JSON.parse(data) as Record<string, unknown> };
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json() as Promise<T>;
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
  if (!port) throw new Error('Failed to allocate proxy E2E port');
  return port;
}

async function waitForHttp(url: string, child: ChildProcess, name: string): Promise<void> {
  let logs = '';
  child.stdout?.on('data', (chunk) => (logs += String(chunk)));
  child.stderr?.on('data', (chunk) => (logs += String(chunk)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited early: ${logs}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${name} did not become healthy: ${logs}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exited;
}
