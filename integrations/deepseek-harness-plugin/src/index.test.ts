import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { CallId } from '@deepseek-ai/dsh-llm';
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ApprovalService, {
  type ApprovalOutcome,
  type ApprovalPolicy,
} from '@deepseek-ai/dsh-user-approval';
import { stableUuid, type ControlledOperationInput } from '@nebula-link-evo/browser-control-client';
import type { BrowserOperationRecord } from '@nebula-link-evo/shared/types/browser-execution';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeepSeekBrowserPlugin } from './index.js';

const roots: Context[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((ctx) => ctx.fiber.dispose()));
});

describe('DeepSeek Harness browser plugin', () => {
  it('registers only the two controlled model-visible tools and unregisters on unload', async () => {
    const harness = await createHarness();

    expect(
      harness.ctx.tools
        .schemas()
        .map((schema) => schema.name)
        .sort()
    ).toEqual(['nebula_browser_act', 'nebula_browser_observe']);

    await harness.pluginFiber.dispose();
    expect(harness.ctx.tools.schemas()).toEqual([]);
  });

  it('passes observe through without approval and keeps the operation id stable', async () => {
    const harness = await createHarness();
    const first = await execute(harness.ctx, harness.agent, 'nebula_browser_observe', 'call-1', {
      operation: 'page_state',
    });
    const second = await execute(harness.ctx, harness.agent, 'nebula_browser_observe', 'call-1', {
      operation: 'page_state',
    });

    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    if (first.isError || second.isError) return;
    expect(first.value.operationId).toBe(second.value.operationId);
    expect(harness.approvalRequests).toEqual([]);
    expect(harness.executeSession).toHaveBeenCalledTimes(2);
  });

  it('executes an act only after one allowed-once decision', async () => {
    const harness = await createHarness({ outcomes: ['allowed-once'] });

    const result = await execute(harness.ctx, harness.agent, 'nebula_browser_act', 'call-act', {
      operation: 'navigate',
      args: { url: 'https://example.test' },
    });

    expect(result.isError).toBe(false);
    expect(harness.approvalRequests).toEqual(['nebula_browser_act']);
    expect(harness.executeSession).toHaveBeenCalledOnce();
    const [input, authorize, signal] = harness.executeSession.mock.calls[0]!;
    expect(input.key).toBe('root-1:call-act:nebula_browser_act');
    expect(await authorize?.()).toBe(true);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it.each<ApprovalOutcome>(['rejected', 'cancelled', 'unavailable'])(
    'fails closed when approval returns %s',
    async (outcome) => {
      const harness = await createHarness({ outcomes: [outcome] });

      const result = await execute(harness.ctx, harness.agent, 'nebula_browser_act', 'call-deny', {
        operation: 'click',
        target: target('Submit'),
      });

      expect(result.isError).toBe(true);
      if (!result.isError) return;
      expect(result.error.info?.code).toBe('approval_denied');
      expect(harness.executeSession).not.toHaveBeenCalled();
    }
  );

  it('respects the real ApprovalService never policy', async () => {
    const harness = await createHarness({ policy: 'never', outcomes: ['allowed-once'] });

    const result = await execute(harness.ctx, harness.agent, 'nebula_browser_act', 'call-never', {
      operation: 'click',
      target: target('Submit'),
    });

    expect(result.isError).toBe(true);
    if (!result.isError) return;
    expect(result.error.info?.code).toBe('approval_denied');
    expect(harness.approvalRequests).toEqual([]);
  });

  it('rejects another Harness session instead of sharing the hidden binding', async () => {
    const harness = await createHarness();
    const otherAgent = createAgent(harness.ctx, 'root-2');
    await execute(harness.ctx, harness.agent, 'nebula_browser_observe', 'owner-call', {
      operation: 'title',
    });

    const result = await execute(harness.ctx, otherAgent, 'nebula_browser_observe', 'other-call', {
      operation: 'title',
    });

    expect(result.isError).toBe(true);
    if (!result.isError) return;
    expect(result.error.info?.code).toBe('browser_busy');
    expect(harness.createSession).toHaveBeenCalledOnce();
  });

  it('rejects secret and coordinate arguments before approval without tracing their values', async () => {
    const harness = await createHarness({ outcomes: ['allowed-once'] });

    const result = await execute(harness.ctx, harness.agent, 'nebula_browser_act', 'secret-call', {
      operation: 'fill',
      target: target('Password'),
      args: { token: 'must-not-appear' },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('must-not-appear');
    expect(harness.approvalRequests).toEqual([]);
    expect(harness.executeSession).not.toHaveBeenCalled();
  });

  it('redacts hidden credentials from tool values and closes the session on HMR/unload', async () => {
    const harness = await createHarness({ includeSecretInActual: true });

    const result = await execute(
      harness.ctx,
      harness.agent,
      'nebula_browser_observe',
      'redact-call',
      {
        operation: 'page_state',
      }
    );

    expect(JSON.stringify(result)).not.toContain('lease-secret');
    await harness.pluginFiber.restart();
    expect(harness.closeSession).toHaveBeenCalledOnce();
    expect(
      harness.ctx.tools
        .schemas()
        .map((schema) => schema.name)
        .sort()
    ).toEqual(['nebula_browser_act', 'nebula_browser_observe']);
    await harness.pluginFiber.dispose();
    expect(harness.closeSession).toHaveBeenCalledOnce();
  });
});

async function createHarness(options?: {
  outcomes?: ApprovalOutcome[];
  policy?: ApprovalPolicy;
  includeSecretInActual?: boolean;
}) {
  const ctx = new Context();
  roots.push(ctx);
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime, { mode: 'native' });
  await ctx.plugin(ApprovalService, { policy: options?.policy ?? 'ask' });

  const approvalRequests: string[] = [];
  const outcomes = [...(options?.outcomes ?? [])];
  ctx.on('approval/request', async (request, next) => {
    approvalRequests.push(request.toolName);
    return outcomes.shift() ?? next();
  });

  const closeSession = vi.fn(async () => undefined);
  const executeSession = vi.fn(
    async (input: ControlledOperationInput): Promise<BrowserOperationRecord> =>
      operationRecord(input, options?.includeSecretInActual)
  );
  const createSession = vi.fn(() => ({ execute: executeSession, close: closeSession }));
  const pluginFiber = await ctx.plugin(createDeepSeekBrowserPlugin({ createSession }), {});
  const agent = createAgent(ctx, 'root-1');
  return {
    ctx,
    agent,
    pluginFiber,
    approvalRequests,
    createSession,
    executeSession,
    closeSession,
  };
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
    cancel: vi.fn(),
    whenIdle: vi.fn(async () => undefined),
    runMaintenance: vi.fn(),
    send: vi.fn(),
    followup: vi.fn(),
    steer: vi.fn(),
    inject: vi.fn(),
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

function operationRecord(
  input: ControlledOperationInput,
  includeSecretInActual = false
): BrowserOperationRecord {
  const now = new Date().toISOString();
  return {
    schema: 'nebula.browser.operation-result/1.0',
    operationId: stableUuid('deepseek-harness:root-1', input.key, input.kind, input.operation),
    requestHash: 'hash',
    sessionId: 'browser-session-secret',
    leaseId: 'lease-id-secret',
    leaseSequence: 1,
    tabId: 'tab-secret',
    kind: input.kind,
    operation: input.operation,
    status: 'succeeded',
    queueSequence: 1,
    acceptedAt: now,
    startedAt: now,
    completedAt: now,
    actual: includeSecretInActual
      ? { leaseToken: 'lease-secret', nested: { tokenHash: 'lease-secret' }, value: 'ok' }
      : { value: 'ok' },
    artifacts: [],
  };
}

function target(semantic: string) {
  return {
    semantic,
    candidates: [{ strategy: 'role', role: 'button', name: semantic }],
    expected: { cardinality: 'exactly_one', visible: true },
  };
}
