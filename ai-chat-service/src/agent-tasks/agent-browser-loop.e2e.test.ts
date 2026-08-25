import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticBrowserClient } from '../../../ai-e2e/src/infrastructure/semantic-browser-client.js';
import { AgentTaskModelExecutor } from './executor.js';
import type { AgentTaskExecutionContext, CreateAgentTaskRequest } from './types.js';
import { createHarnessRuntime } from '../harness/runtime.js';
import { ToolRegistry } from '../tools/registry.js';

const config = {
  version: '2.0',
  providers: { test: { enabled: true, apiKey: 'unused', models: {} } },
  defaults: { mode: 'unified', decision: { provider: 'test', model: 'decision' } },
  settings: {
    timeout: 30_000,
    maxRetries: 0,
    temperature: 0,
    maxTokens: 2_000,
    maxSteps: 5,
    contextWindowTokens: 10_000,
  },
  mcp: { enabled: false, servers: {} },
} as const;

class BrowserLoopAdapter extends LlmAdapter {
  private turn = 0;

  override providerInfo(provider: string) {
    return { id: provider, name: provider };
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const browserTurn = this.turn++ === 0;
    const id = CallId(browserTurn ? 'browser-call-1' : 'submit-call-1');
    const name = browserTurn ? 'nebula__browser_control__operation_execute' : 'submit_result';
    const args = JSON.stringify(
      browserTurn ? { stepId: 'navigate-target' } : { result: { status: 'navigated' } }
    );
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args };
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name, arguments: args },
    };
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}

it('drives real proxy Chromium through the DSH Agent task MCP loop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nebula-agent-browser-e2e-'));
  const targetApp = Fastify({ logger: false });
  const proxyPort = await availablePort();
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
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
  const adapter = new BrowserLoopAdapter();
  const runtime = await createHarnessRuntime({
    sessionRoot: join(root, 'sessions'),
    attachmentRoot: join(root, 'attachments'),
    persona: 'e2e',
    maxParallelToolCalls: 1,
    piAi: { providers: {} },
    decision: { provider: 'test', model: 'decision' },
    mcp: [],
    configure(ctx) {
      ctx.llm.registerAdapter(['test'], adapter);
    },
  });

  try {
    targetApp.get('/', async (_request, reply) =>
      reply.type('text/html').send('<!doctype html><title>Agent browser target</title><h1>Ready</h1>')
    );
    const targetUrl = await targetApp.listen({ host: '127.0.0.1', port: 0 });
    await waitForProxy(proxyUrl, proxyProcess);
    const browserClient = new SemanticBrowserClient({ baseUrl: proxyUrl, timeoutMs: 30_000 });
    const session = await browserClient.createSession('agent-loop-session');
    const issued = await browserClient.createLease(session.id, 'agent-loop-lease', {
      mode: 'control',
      ttlSeconds: 30,
    });
    const request: CreateAgentTaskRequest = {
      schema: 'nebula.ai.agent-task/1.0',
      clientTaskId: 'agent-browser-loop',
      modelRole: 'decision',
      input: { objective: 'Navigate the authorized browser to the target page' },
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
      budgets: { maxDurationMs: 30_000, maxModelTurns: 2, maxToolCalls: 1, maxTokens: 100 },
      browserBinding: {
        browserSessionId: session.id,
        tabId: session.tabs[0]!.id,
        browserLeaseId: issued.lease.id,
        browserLeaseToken: issued.token!,
        browserLeaseSequence: issued.lease.sequence,
        access: 'control',
      },
    };
    const mcpClient = {
      callTool: async (
        _serverName: string,
        toolName: string,
        args: Record<string, unknown> = {},
        options?: { signal?: AbortSignal }
      ) => {
        const response = await fetch(new URL('/mcp', proxyUrl), {
          method: 'POST',
          headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method: 'tools/call',
            params: { name: toolName, arguments: args },
          }),
          signal: options?.signal,
        });
        const envelope = (await response.json()) as { result?: unknown; error?: unknown };
        if (!response.ok || envelope.error) throw new Error(JSON.stringify(envelope.error));
        return envelope.result;
      },
    };
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      harness: runtime,
      toolRegistry: new ToolRegistry(),
      mcpClient,
    });
    const context: AgentTaskExecutionContext = {
      taskId: 'agent-browser-loop-task',
      request,
      deadlineAt: Date.now() + 30_000,
      signal: new AbortController().signal,
      harnessProjectedSeq: 0,
      beforeToolCall: vi.fn(),
      emitEvent: vi.fn(),
      persistPendingResult: vi.fn(),
    };

    const result = await executor.execute(context);

    expect(result).toMatchObject({
      output: { status: 'navigated' },
      usage: { modelTurns: 2, toolCalls: 1 },
      toolCalls: [
        {
          toolName: 'browser-control.operation_execute',
          operation: 'navigate',
          status: 'succeeded',
        },
      ],
    });
    const operationId = result.toolCalls[0]!.operationId!;
    const fetched = (await mcpClient.callTool('gateway', 'browser-control.operation_get', {
      operationId,
    })) as { content?: Array<{ type: string; text?: string }> };
    const operation = JSON.parse(fetched.content?.[0]?.text ?? '{}') as Record<string, unknown>;
    expect(operation).toMatchObject({ operationId, operation: 'navigate', status: 'succeeded' });

    await browserClient.closeSession(session.id, 'agent-loop-session-close', {
      leaseId: issued.lease.id,
      leaseToken: issued.token!,
    });
  } finally {
    await runtime.dispose();
    await Promise.all([stopChild(proxyProcess), targetApp.close()]);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error('Failed to allocate proxy E2E port');
  return port;
}

async function waitForProxy(url: string, child: ChildProcess): Promise<void> {
  let logs = '';
  child.stdout?.on('data', (chunk) => (logs += String(chunk)));
  child.stderr?.on('data', (chunk) => (logs += String(chunk)));
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`proxy-adapter exited early: ${logs}`);
    try {
      const response = await fetch(`${url}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`proxy-adapter did not become healthy: ${logs}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exited;
}
