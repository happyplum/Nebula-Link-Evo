import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { CallId } from '@deepseek-ai/dsh-llm';
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp as buildProxyApp } from '../../../../proxy-adapter/src/server.js';
import { runCli } from '../../../browser-control-client/src/cli.js';
import { createDeepSeekBrowserPlugin } from '../../src/index.js';

describe('controlled CLI and DeepSeek Harness consumers', () => {
  const liveKitApiKey = process.env.LIVEKIT_API_KEY;
  const liveKitApiSecret = process.env.LIVEKIT_API_SECRET;
  let root: string;
  let proxyApp: Awaited<ReturnType<typeof buildProxyApp>>;
  let proxyUrl: string;
  let targetServer: Server;
  let targetUrl: string;

  beforeAll(async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    root = await mkdtemp(join(tmpdir(), 'nebula-controlled-consumers-'));
    proxyApp = await buildProxyApp({ dataDir: join(root, 'proxy'), skipBackups: true });
    proxyUrl = await proxyApp.listen({ host: '127.0.0.1', port: 0 });
    targetServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
        <html><head><title>Controlled consumer target</title></head>
        <body>
          <button id="submit" onclick="document.querySelector('#result').textContent='clicked'">Submit</button>
          <p id="result">idle</p>
        </body></html>`);
    });
    await new Promise<void>((resolve, reject) => {
      targetServer.once('error', reject);
      targetServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = targetServer.address();
    if (!address || typeof address === 'string') throw new Error('Target server did not bind');
    targetUrl = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await proxyApp.close();
    await new Promise<void>((resolve, reject) =>
      targetServer.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(root, { recursive: true, force: true });
    restoreEnvironment('LIVEKIT_API_KEY', liveKitApiKey);
    restoreEnvironment('LIVEKIT_API_SECRET', liveKitApiSecret);
  });

  it('runs CLI NDJSON through the real proxy and fails closed without --allow-act', async () => {
    const input = [
      { id: 'navigate', kind: 'act', operation: 'navigate', args: { url: targetUrl } },
      { id: 'click', kind: 'act', operation: 'click', target: target('Submit', 'button') },
      {
        id: 'read',
        kind: 'observe',
        operation: 'text',
        target: target('Result', undefined, '#result'),
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    const denied = cliIo(input);
    expect(
      await runCli(['--base-url', proxyUrl, 'run', '--input', '-'], denied.io, undefined)
    ).toBe(4);
    expect(denied.stdout).toEqual([]);
    expect(denied.stderr.join('\n')).toContain('permission_denied');

    const allowed = cliIo(input);
    expect(
      await runCli(
        ['--base-url', proxyUrl, 'run', '--input', '-', '--allow-act'],
        allowed.io,
        undefined
      )
    ).toBe(0);
    expect(allowed.stdout.map((line) => JSON.parse(line).id)).toEqual([
      'navigate',
      'click',
      'read',
    ]);
    expect(JSON.parse(allowed.stdout[2]!)).toMatchObject({
      ok: true,
      operation: { status: 'succeeded', actual: 'clicked' },
    });
    expect(`${allowed.stdout.join('\n')}\n${allowed.stderr.join('\n')}`).not.toMatch(
      /leaseToken|tokenHash|x-browser-lease-token/i
    );
  });

  it('uses real Cordis approval while hiding proxy bindings from model-visible tools', async () => {
    const ctx = new Context();
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolRuntime, { mode: 'native' });
    await ctx.plugin(ApprovalService, { policy: 'ask' });
    const outcomes: ApprovalOutcome[] = ['allowed-once', 'rejected'];
    const approvals: string[] = [];
    ctx.on('approval/request', async (request) => {
      approvals.push(request.toolName);
      return outcomes.shift() ?? 'rejected';
    });
    const pluginFiber = await ctx.plugin(createDeepSeekBrowserPlugin(), {
      baseUrl: proxyUrl,
      allowedObserveOperations: ['page_state', 'text'],
      allowedActOperations: ['navigate', 'click'],
    });
    const agent = createAgent(ctx, 'controlled-e2e-root');
    try {
      const observed = await execute(ctx, agent, 'nebula_browser_observe', 'observe-call', {
        operation: 'page_state',
      });
      expect(observed.isError, JSON.stringify(observed)).toBe(false);
      expect(approvals).toEqual([]);

      const navigated = await execute(ctx, agent, 'nebula_browser_act', 'navigate-call', {
        operation: 'navigate',
        args: { url: targetUrl },
      });
      expect(navigated.isError).toBe(false);
      expect(approvals).toEqual(['nebula_browser_act']);
      expect(JSON.stringify(navigated)).not.toMatch(
        /browserSessionId|tabId|leaseId|leaseToken|leaseSequence/i
      );

      const rejected = await execute(ctx, agent, 'nebula_browser_act', 'click-call', {
        operation: 'click',
        target: target('Submit', 'button'),
      });
      expect(rejected.isError).toBe(true);
      if (!rejected.isError) return;
      expect(rejected.error.info?.code).toBe('approval_denied');
      expect(approvals).toEqual(['nebula_browser_act', 'nebula_browser_act']);
    } finally {
      await pluginFiber.dispose();
      await ctx.fiber.dispose();
    }
  });
});

function cliIo(stdin: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
      readStdin: async () => stdin,
      env: {},
    },
    stdout,
    stderr,
  };
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function createAgent(ctx: Context, id: string): Agent {
  const sessionId = SessionId(id);
  const session = Session.create(sessionId);
  session.append('turn/start', { turn: 0 });
  const agent = {} as Agent;
  const agentCtx = ctx.extend({ agent });
  Object.assign(agent, {
    id: sessionId,
    options: {},
    session,
    inbox: {},
    status: 'running',
    ctx: agentCtx,
    cancel: async () => undefined,
    whenIdle: async () => undefined,
    runMaintenance: () => undefined,
    send: () => undefined,
    followup: () => undefined,
    steer: () => undefined,
    inject: () => undefined,
  });
  return agent;
}

async function execute(
  ctx: Context,
  agent: Agent,
  name: string,
  callId: string,
  args: unknown
): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    callId: CallId(callId),
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  });
}

function target(semantic: string, role?: string, css?: string) {
  return {
    semantic,
    candidates: [
      css ? { strategy: 'css', value: css } : { strategy: 'role', role, name: semantic },
    ],
    expected: { cardinality: 'exactly_one', visible: true },
  };
}
