import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { BrowserControlClient } from '../../../integrations/browser-control-client/src/client.js';

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
  let controlClient: BrowserControlClient | undefined;
  let visionRequests = 0;

  try {
    targetApp.get('/', async (_request, reply) =>
      reply
        .type('text/html')
        .send(
          '<!doctype html><title>Agent target</title><h1>Ready</h1><button data-testid="submit">Submit</button>'
        )
    );
    targetApp.post('/v1/chat/completions', async (request) => {
      visionRequests += 1;
      const prompt = collectStrings(request.body).join('\n');
      const elementId = /\[([^\]]+)\] <button> "Submit"/u.exec(prompt)?.[1];
      if (!elementId) throw new Error('Vision request did not contain the real Submit element');
      const content = prompt.includes('web page element matcher')
        ? prompt.includes('Ambiguous Submit button')
          ? {
              nebula_id: elementId,
              confidence: 0.9,
              ambiguous: true,
              reasoning: 'Two candidates appear plausible.',
            }
          : prompt.includes('Low confidence Submit button')
            ? {
                nebula_id: elementId,
                confidence: 0.4,
                ambiguous: false,
                reasoning: 'The visual evidence is weak.',
              }
            : {
                nebula_id: elementId,
                confidence: 0.98,
                ambiguous: false,
                reasoning: 'The labeled button text is Submit.',
              }
        : {
            summary: 'The fixture page is ready.',
            notable_elements: [
              { nebula_id: elementId, description: 'Submit button', confidence: 0.98 },
            ],
            risks: [],
            reasoning: 'The screenshot and DOM evidence agree.',
          };
      return {
        id: `vision-response-${visionRequests}`,
        object: 'chat.completion',
        created: 1,
        model: 'vision',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(content) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      };
    });
    const targetUrl = await targetApp.listen({ host: '127.0.0.1', port: 0 });
    await mkdir(dataDir, { recursive: true });
    await writeFile(configPath, JSON.stringify(testConfig(`${targetUrl}/v1`)), 'utf8');
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
    const tab = requireValue(session.tabs[0], 'Browser session must expose its initial tab');
    const leaseToken = requireValue(issued.token, 'Control lease must include its token');
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
        tabId: tab.id,
        browserLeaseId: issued.lease.id,
        browserLeaseToken: leaseToken,
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
    const toolCall = requireValue(
      completed.toolCalls[0],
      'Completed task must include a tool call'
    );
    const operationId = requireValue(
      toolCall.operationId,
      'Browser tool call must persist operationId'
    );
    await expect(browserClient.getOperation(operationId)).resolves.toMatchObject({
      operationId,
      operation: 'navigate',
      status: 'succeeded',
    });
    await expect(browserClient.getSession(session.id)).resolves.toMatchObject({
      tabs: [expect.objectContaining({ id: tab.id, url: new URL(targetUrl).toString() })],
    });

    controlClient = new BrowserControlClient({ baseUrl: proxyUrl, requestTimeoutMs: 30_000 });
    const captured = await controlClient.executeOperation(
      { sessionId: session.id, leaseId: issued.lease.id, leaseToken },
      tab.id,
      {
        schema: 'nebula.browser.operation/1.0',
        operationId: randomUUID(),
        leaseSequence: issued.lease.sequence,
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
        kind: 'observe',
        operation: 'dom_snapshot',
        args: {},
        presentation: { animation: 'off' },
      }
    );
    expect(captured).toMatchObject({
      status: 'succeeded',
      kind: 'observe',
      operation: 'dom_snapshot',
      sessionId: session.id,
      tabId: tab.id,
    });
    const domArtifact = requireValue(
      captured.artifacts.find((artifact) => artifact.kind === 'dom_snapshot'),
      'Real DOM snapshot operation must expose its immutable artifact'
    );
    const snapshotId = requireValue(
      domArtifact.snapshotId,
      'Real DOM snapshot artifact must expose snapshotId'
    );
    const binding = {
      schema: 'nebula.vision-snapshot-binding/1.0' as const,
      sessionId: captured.sessionId,
      tabId: requireValue(captured.tabId, 'DOM snapshot operation must preserve tabId'),
      operationId: captured.operationId,
      requestHash: captured.requestHash,
      leaseId: captured.leaseId,
      leaseSequence: captured.leaseSequence,
      snapshotId,
      status: 'succeeded' as const,
      domArtifact: {
        artifactId: domArtifact.id,
        sha256: domArtifact.sha256,
        mimeType: 'application/json' as const,
        sizeBytes: domArtifact.sizeBytes,
      },
    };
    const visionRequest = {
      schema: 'nebula.ai.agent-task/1.0' as const,
      clientTaskId: 'process-agent-vision-loop',
      modelRole: 'decision' as const,
      input: {
        objective: 'Analyze the real proxy snapshot and resolve the Submit button',
        binding,
      },
      responseSchema: {
        type: 'object',
        properties: { status: { type: 'string', const: 'vision-verified' } },
        required: ['status'],
        additionalProperties: false,
      },
      toolPolicy: { allow: ['vision.analyze_page', 'vision.resolve_target'] },
      skillPolicy: { allow: [] },
      budgets: { maxDurationMs: 30_000, maxModelTurns: 3, maxToolCalls: 2, maxTokens: 2_000 },
    };
    const visionCreated = await agentClient.createTask(
      visionRequest,
      'process-agent-vision-create'
    );
    const visionCompleted = await waitForTask(agentClient, visionCreated.taskId);
    if (visionCompleted.status !== 'completed') {
      throw new Error(`Vision task failed: ${JSON.stringify(visionCompleted)}`);
    }
    expect(visionCompleted).toMatchObject({
      status: 'completed',
      output: { status: 'vision-verified' },
      usage: { inputTokens: 15, outputTokens: 15, modelTurns: 3, toolCalls: 2 },
      toolCalls: [
        { toolName: 'vision.analyze_page', status: 'succeeded' },
        { toolName: 'vision.resolve_target', status: 'succeeded' },
      ],
    });
    expect(visionRequests).toBe(2);

    const rejectionCases = [
      {
        name: 'tampered-hash',
        expectedCode: 'VISION_SNAPSHOT_REJECTED',
        tool: 'vision.analyze_page',
        binding: {
          ...binding,
          domArtifact: { ...binding.domArtifact, sha256: '0'.repeat(64) },
        },
      },
      {
        name: 'tab-drift',
        expectedCode: 'VISION_SNAPSHOT_REJECTED',
        tool: 'vision.analyze_page',
        binding: { ...binding, tabId: randomUUID() },
      },
      {
        name: 'ambiguous-target',
        expectedCode: 'VISION_TARGET_AMBIGUOUS',
        tool: 'vision.resolve_target',
        binding,
      },
      {
        name: 'low-confidence-target',
        expectedCode: 'VISION_TARGET_LOW_CONFIDENCE',
        tool: 'vision.resolve_target',
        binding,
      },
    ] as const;
    for (const rejection of rejectionCases) {
      const rejected = await agentClient.createTask(
        {
          schema: 'nebula.ai.agent-task/1.0',
          clientTaskId: `process-agent-vision-${rejection.name}`,
          modelRole: 'decision',
          input: {
            objective: `Prove ${rejection.name} fails closed`,
            expectedCode: rejection.expectedCode,
            binding: rejection.binding,
          },
          responseSchema: {
            type: 'object',
            properties: { code: { type: 'string', const: rejection.expectedCode } },
            required: ['code'],
            additionalProperties: false,
          },
          toolPolicy: { allow: [rejection.tool] },
          skillPolicy: { allow: [] },
          budgets: {
            maxDurationMs: 30_000,
            maxModelTurns: 2,
            maxToolCalls: 1,
            maxTokens: 2_000,
          },
        },
        `process-agent-vision-${rejection.name}-create`
      );
      await expect(waitForTask(agentClient, rejected.taskId)).resolves.toMatchObject({
        status: 'completed',
        output: { code: rejection.expectedCode },
        usage: { inputTokens: 10, outputTokens: 10, modelTurns: 2, toolCalls: 1 },
        toolCalls: [{ toolName: rejection.tool, status: 'succeeded' }],
      });
    }
    expect(visionRequests).toBe(4);

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
      const visionProjection = repository.getHarnessProjection(visionCreated.taskId);
      expect(visionProjection.projectedDshSeq).toBeGreaterThan(0);
      expect(visionProjection.projectedDshSeq).toBe(visionProjection.durableDshSeq);
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
    await expect(restartedClient.getTask(visionCreated.taskId)).resolves.toMatchObject({
      taskId: visionCreated.taskId,
      status: 'completed',
      output: { status: 'vision-verified' },
      eventSeq: visionCompleted.eventSeq,
    });

    await browserClient.closeSession(session.id, 'process-agent-browser-close', {
      leaseId: issued.lease.id,
      leaseToken,
    });
  } finally {
    await controlClient?.close();
    if (aiChatProcess) await stopChild(aiChatProcess);
    await Promise.all([stopChild(proxyProcess), targetApp.close()]);
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

it('pauses and resumes Chat at a durable checkpoint through canonical HTTP and fresh SSE snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nebula-chat-control-process-e2e-'));
  const proxyPort = await availablePort();
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
  const dataDir = join(root, 'ai-chat');
  const chatStartedPath = join(root, 'chat-started.log');
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
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  let aiChatProcess: ChildProcess | undefined;

  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(chatStartedPath, '', 'utf8');
    await writeFile(configPath, JSON.stringify(testConfig()), 'utf8');
    await writeFile(trustedPluginLockPath, JSON.stringify(testPluginLock(proxyUrl)), 'utf8');
    await waitForHttp(`${proxyUrl}/api/v1/health`, proxyProcess, 'proxy-adapter');
    const started = await startAiChatProcess({
      root,
      dataDir,
      configPath,
      trustedPluginLockPath,
      proxyUrl,
      environment: {
        E2E_CHAT_DELAY_MS: '500',
        E2E_CHAT_STARTED_PATH: chatStartedPath,
      },
    });
    aiChatProcess = started.process;
    let currentUrl = started.url;
    let sessionUrl = await createChatSession(currentUrl, 'Chat control E2E');
    const initial = await readFirstSse(`${sessionUrl}/stream`);
    expect(initial).toMatchObject({
      event: 'session.snapshot',
      id: 0,
      data: { state: 'idle', messages: [] },
    });

    await postJson(`${sessionUrl}/messages`, { content: 'Pause after this response' }, 202);
    await waitForChatStatus(sessionUrl, 'running');
    await waitForChatStarts(chatStartedPath, 1);
    await postJson(`${sessionUrl}/pause`, {}, 200);
    await waitForChatStatus(sessionUrl, 'paused');

    const paused = await readFirstSse(`${sessionUrl}/stream`, { 'Last-Event-ID': '999999' });
    expect(paused).toMatchObject({
      event: 'session.snapshot',
      id: 0,
      data: {
        state: 'paused',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Pause after this response' }),
          expect.objectContaining({ role: 'assistant', content: 'E2E assistant response' }),
        ]),
      },
    });

    await forceStopChild(aiChatProcess);
    aiChatProcess = undefined;
    const restarted = await startAiChatProcess({
      root,
      dataDir,
      configPath,
      trustedPluginLockPath,
      proxyUrl,
      environment: {
        E2E_CHAT_DELAY_MS: '500',
        E2E_CHAT_STARTED_PATH: chatStartedPath,
      },
    });
    aiChatProcess = restarted.process;
    currentUrl = restarted.url;
    sessionUrl = sessionUrl.replace(started.url, currentUrl);
    await waitForChatStatus(sessionUrl, 'paused');

    await postJson(`${sessionUrl}/resume`, {}, 200);
    await waitForChatStatus(sessionUrl, 'idle');
    const resumed = await readFirstSse(`${sessionUrl}/stream`);
    expect(resumed).toMatchObject({
      event: 'session.snapshot',
      id: 0,
      data: {
        state: 'idle',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', content: 'E2E assistant response' }),
        ]),
      },
    });
    let expectedChatStarts = 2;
    for (const command of ['interrupt', 'cancel'] as const) {
      const controlledUrl = await createChatSession(currentUrl, `Chat ${command} E2E`);
      await postJson(`${controlledUrl}/messages`, { content: `${command} this response` }, 202);
      await waitForChatStatus(controlledUrl, 'running');
      expectedChatStarts += 1;
      await waitForChatStarts(chatStartedPath, expectedChatStarts);
      await postJson(`${controlledUrl}/${command}`, {}, 200);
      await waitForChatStatus(controlledUrl, 'completed');
      const operations = await getJson<Array<{ operation: string; status: string }>>(
        `${controlledUrl}/operations`
      );
      expect(operations).toEqual(
        expect.arrayContaining([expect.objectContaining({ operation: command, status: 'success' })])
      );
      const snapshot = await readFirstSse(`${controlledUrl}/stream`);
      const messages = snapshot.data.messages as Array<{ role: string; content: string }>;
      expect(messages).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', content: 'E2E assistant response' }),
        ])
      );
    }

    expect((await fetch(`${currentUrl}/api/chat/sessions/missing`)).status).toBe(404);
  } finally {
    if (aiChatProcess) await stopChild(aiChatProcess);
    await stopChild(proxyProcess);
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

function testConfig(visionBaseUrl?: string): Record<string, unknown> {
  return {
    version: '2.0',
    providers: {
      test: {
        enabled: true,
        apiKey: '{E2E_TEST_API_KEY}',
        baseUrl: visionBaseUrl ?? 'http://127.0.0.1:1/v1',
        models: {
          decision: { type: 'decision', capabilities: ['decision'], maxTokens: 2_000 },
          ...(visionBaseUrl
            ? { vision: { type: 'vision', capabilities: ['vision'], maxTokens: 2_000 } }
            : {}),
        },
      },
    },
    defaults: {
      mode: 'unified',
      decision: 'test/decision',
      ...(visionBaseUrl ? { vision: 'test/vision' } : {}),
    },
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

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectStrings);
}

async function waitForChatStarts(path: string, expectedCount: number): Promise<void> {
  await vi.waitFor(async () => {
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
    expect(lines).toHaveLength(expectedCount);
  });
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
  environment?: Record<string, string>;
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
        ...options.environment,
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
  url: string,
  headers?: Record<string, string>
): Promise<{ event: string; id: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
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

async function postJson<T = unknown>(
  url: string,
  body: unknown,
  expectedStatus: number
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function createChatSession(baseUrl: string, title: string): Promise<string> {
  const created = await postJson<{ session: { id: string } }>(
    `${baseUrl}/api/v1/chat/sessions`,
    { title, provider: 'test', model: 'decision' },
    201
  );
  return `${baseUrl}/api/v1/chat/sessions/${encodeURIComponent(created.session.id)}`;
}

async function waitForChatStatus(sessionUrl: string, expected: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastStatus = 'unknown';
  while (Date.now() < deadline) {
    const state = await getJson<{ status: string }>(`${sessionUrl}/status`);
    lastStatus = state.status;
    if (state.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Chat session did not reach ${expected}; last status was ${lastStatus}`);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json() as Promise<T>;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
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

async function forceStopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
}
