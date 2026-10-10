import type { BrowserOperationStatus } from '@nebula-link-evo/shared/types/browser-operation-result';
import { describe, expect, it, vi } from 'vitest';
import type { McpResult } from '@deepseek-ai/dsh-mcp-client';
import type { HarnessMcpCaller } from '../harness/types.js';
import { BrowserToolWrapper, type BrowserToolWrapperOptions } from './browser-tool-wrapper.js';

function operationResult(
  operationId: string,
  status: BrowserOperationStatus,
  actual?: McpResult['structuredContent']
) {
  return {
    schema: 'nebula.browser.operation-result/1.0' as const,
    operationId,
    requestHash: 'hash-1',
    sessionId: 'session-1',
    leaseId: 'lease-1',
    leaseSequence: 7,
    tabId: 'tab-1',
    kind: 'act' as const,
    operation: 'click' as const,
    status,
    queueSequence: 1,
    acceptedAt: '2026-10-03T00:00:00.000Z',
    artifacts: [],
    ...(actual === undefined ? {} : { actual }),
  };
}

function createWrapper(
  callTool: (server: string, tool: string, args: Record<string, unknown>) => Promise<McpResult>,
  overrides: Partial<BrowserToolWrapperOptions> = {}
) {
  return new BrowserToolWrapper({
    taskId: 'task-1',
    binding: {
      browserSessionId: 'session-1',
      tabId: 'tab-1',
      browserLeaseId: 'lease-1',
      browserLeaseToken: 'top-secret',
      browserLeaseSequence: 7,
      access: 'control',
    },
    steps: new Map([
      [
        'login',
        {
          stepId: 'login',
          kind: 'act',
          operation: 'click',
          target: {
            semantic: '登录按钮',
            candidates: [{ strategy: 'role', role: 'button', name: '登录', exact: true }],
            expected: { cardinality: 'exactly_one', visible: true, enabled: true },
          },
          effectId: 'effect-login',
          capture: { beforeScreenshot: true, afterScreenshot: true, domSnapshot: true },
        },
      ],
    ]),
    deadlineAt: Date.now() + 60_000,
    maxToolCalls: 2,
    authorizationSnapshot: {},
    mcpClient: { callTool: callTool as HarnessMcpCaller['callTool'] },
    ...overrides,
  });
}

describe('BrowserToolWrapper', () => {
  it.each(['parsed', 'text', 'content', 'raw', 'malformed structuredContent'])(
    'rejects %s results without using JSON text as a fallback',
    async (source) => {
      const operation = operationResult('op-1', 'cancelled');
      const text = JSON.stringify(operation);
      const content = [{ type: 'text', text }];
      const result =
        source === 'parsed'
          ? { parsed: operation }
          : source === 'text'
            ? { text }
            : source === 'content'
              ? { content }
              : source === 'raw'
                ? operation
                : { content, structuredContent: { ...operation, queueSequence: 'invalid' } };
      const wrapper = createWrapper(vi.fn(async () => result as unknown as McpResult));
      await expect(wrapper.cancel('op-1')).rejects.toMatchObject({
        code: 'dependency_unavailable',
      });
    }
  );

  it('marks an unrecoverable legacy-only execute result outcome_unknown', async () => {
    const callTool = vi.fn(
      async (_server: string, _tool: string, args: Record<string, unknown>) => {
        const operationId =
          args.operationId ?? (args.request as { operationId: string }).operationId;
        return {
          parsed: operationResult(operationId as string, 'succeeded'),
        } as unknown as McpResult;
      }
    );
    const wrapper = createWrapper(callTool);
    await expect(wrapper.execute({ stepId: 'login' }, 'legacy-call')).rejects.toMatchObject({
      code: 'outcome_unknown',
    });
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it.each([
    { operationId: 'other-operation' },
    { sessionId: 'other-session' },
    { leaseId: 'other-lease' },
    { leaseSequence: 8 },
    { tabId: 'other-tab' },
    { requestHash: '' },
  ])('rejects binding drift %j after structural admission', async (fields) => {
    const callTool = vi.fn(async () => ({
      content: [],
      structuredContent: {
        ...operationResult('op-1', 'cancelled'),
        ...fields,
      },
    }));
    await expect(createWrapper(callTool).cancel('op-1')).rejects.toMatchObject({
      code: 'dependency_unavailable',
    });
  });

  it('rejects operation-name drift even when execute and recovery records agree', async () => {
    const callTool = vi.fn(
      async (_server: string, _tool: string, args: Record<string, unknown>) => {
        const operationId =
          args.operationId ?? (args.request as { operationId: string }).operationId;
        return {
          content: [],
          structuredContent: {
            ...operationResult(operationId as string, 'succeeded'),
            operation: 'fill',
          },
        };
      }
    );
    await expect(
      createWrapper(callTool).execute({ stepId: 'login' }, 'name-drift')
    ).rejects.toMatchObject({ code: 'outcome_unknown' });
  });

  it('projects a complete immutable Vision binding from a durable DOM snapshot', async () => {
    const callTool = vi.fn(
      async (_server: string, _tool: string, args: Record<string, unknown>) => ({
        content: [],
        structuredContent: {
          ...operationResult((args.request as { operationId: string }).operationId, 'succeeded'),
          kind: 'observe',
          operation: 'dom_snapshot',
          artifacts: [
            {
              id: 'dom-1',
              kind: 'dom_snapshot',
              sha256: 'a'.repeat(64),
              mimeType: 'application/json',
              sizeBytes: 123,
              snapshotId: 'snapshot-1',
            },
          ],
        },
      })
    );
    const wrapper = new BrowserToolWrapper({
      taskId: 'task-vision',
      binding: {
        browserSessionId: 'session-1',
        tabId: 'tab-1',
        browserLeaseId: 'lease-1',
        browserLeaseToken: 'secret',
        browserLeaseSequence: 7,
        access: 'observe',
      },
      steps: new Map([
        ['observe', { stepId: 'observe', kind: 'observe', operation: 'dom_snapshot' }],
      ]),
      deadlineAt: Date.now() + 60_000,
      maxToolCalls: 1,
      authorizationSnapshot: {},
      mcpClient: { callTool },
    });

    await expect(wrapper.execute({ stepId: 'observe' }, 'vision-call')).resolves.toMatchObject({
      visionSnapshotBinding: {
        schema: 'nebula.vision-snapshot-binding/1.0',
        sessionId: 'session-1',
        tabId: 'tab-1',
        snapshotId: 'snapshot-1',
        domArtifact: { artifactId: 'dom-1', sizeBytes: 123 },
      },
    });
  });

  it('injects hidden binding fields and uses a stable operationId', async () => {
    const callTool = vi.fn(
      async (_server: string, _tool: string, args: Record<string, unknown>) => ({
        content: [],
        structuredContent: operationResult(
          (args.request as { operationId: string }).operationId,
          'succeeded',
          { clicked: true }
        ),
      })
    );
    const wrapper = createWrapper(callTool);

    const first = await wrapper.execute({ stepId: 'login' }, 'call-1');
    const second = await wrapper.execute({ stepId: 'login' }, 'call-1');

    expect(first.operationId).toBe(second.operationId);
    const envelope = callTool.mock.calls.at(0)?.[2] as Record<string, unknown> | undefined;
    expect(envelope).toBeDefined();
    if (!envelope) throw new Error('Expected a dispatched operation envelope');
    expect(envelope).toMatchObject({
      sessionId: 'session-1',
      tabId: 'tab-1',
      leaseId: 'lease-1',
      leaseToken: 'top-secret',
    });
    expect(envelope.request).toMatchObject({
      leaseSequence: 7,
      operation: 'click',
      target: { semantic: '登录按钮' },
      capture: { beforeScreenshot: true, afterScreenshot: true, domSnapshot: true },
      presentation: { animation: 'off' },
    });
    expect(wrapper.summaries[0]).not.toHaveProperty('args');
  });

  it('rejects model attempts to replace frozen target or args', async () => {
    const callTool = vi.fn();
    const wrapper = createWrapper(callTool);

    await expect(
      wrapper.execute({ stepId: 'login', target: { semantic: '替换目标' } }, 'call-replace')
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('rejects missing call identity, unknown steps and exhausted budgets before dispatch', async () => {
    const callTool = vi.fn();
    const wrapper = createWrapper(callTool, { maxToolCalls: 1 });
    const tool = wrapper.createTool();

    await expect(tool.execute({ stepId: 'login' }, undefined)).rejects.toMatchObject({
      code: 'execution_failed',
    });
    await expect(wrapper.execute({ stepId: 'unknown' }, 'call-unknown')).rejects.toMatchObject({
      code: 'tool_not_allowed',
    });
    await expect(wrapper.execute({ stepId: 'login' }, 'call-over-budget')).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('queries the durable ledger after an ambiguous execute failure', async () => {
    let operationId = '';
    const callTool = vi.fn(async (_server: string, tool: string, args: Record<string, unknown>) => {
      if (tool.endsWith('operation_execute')) {
        operationId = (args.request as { operationId: string }).operationId;
        throw new Error('transport closed');
      }
      return {
        content: [],
        structuredContent: operationResult(operationId, 'succeeded', { recovered: true }),
      };
    });
    const wrapper = createWrapper(callTool);

    await expect(wrapper.execute({ stepId: 'login' }, 'call-2')).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(callTool.mock.calls.map((call) => call[1])).toEqual([
      'browser-control.operation_execute',
      'browser-control.operation_get',
    ]);
  });

  it('records outcome_unknown when the durable ledger cannot prove a terminal result', async () => {
    const callTool = vi.fn(async (_server: string, tool: string) => {
      if (tool.endsWith('operation_execute')) throw new Error('transport closed');
      return { content: [], structuredContent: { invalid: true } };
    });
    const wrapper = createWrapper(callTool);

    await expect(wrapper.execute({ stepId: 'login' }, 'call-3')).rejects.toMatchObject({
      code: 'outcome_unknown',
    });
    expect(wrapper.summaries).toMatchObject([
      { toolCallId: 'call-3', status: 'outcome_unknown', errorCode: 'outcome_unknown' },
    ]);
  });

  it('rejects a proxy result whose durable identity does not match the injected binding', async () => {
    const callTool = vi.fn(
      async (_server: string, _tool: string, args: Record<string, unknown>) => ({
        content: [],
        structuredContent: {
          ...operationResult((args.request as { operationId: string }).operationId, 'succeeded'),
          sessionId: 'other-session',
        },
      })
    );
    const wrapper = createWrapper(callTool);

    await expect(wrapper.execute({ stepId: 'login' }, 'call-drift')).rejects.toMatchObject({
      code: 'outcome_unknown',
    });
  });

  it('does not query the ledger after a deterministic proxy rejection', async () => {
    const callTool = vi.fn(async () => {
      throw new Error(
        JSON.stringify({
          code: 'lease_expired',
          message: 'expired',
          retryable: false,
          correlationId: 'c-1',
        })
      );
    });
    const wrapper = createWrapper(callTool);

    await expect(wrapper.execute({ stepId: 'login' }, 'call-denied')).rejects.toMatchObject({
      code: 'tool_not_allowed',
      details: { proxyCode: 'lease_expired', correlationId: 'c-1' },
    });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['permission_denied', 'tool_not_allowed'],
    ['idempotency_conflict', 'conflict'],
    ['browser_busy', 'conflict'],
    ['dependency_unavailable', 'dependency_unavailable'],
  ])('maps deterministic proxy code %s to %s without unsafe recovery', async (proxyCode, code) => {
    const callTool = vi.fn(async () => {
      throw new Error(JSON.stringify({ code: proxyCode, message: proxyCode, retryable: false }));
    });
    const wrapper = createWrapper(callTool);

    await expect(wrapper.execute({ stepId: 'login' }, `call-${proxyCode}`)).rejects.toMatchObject({
      code,
      details: { proxyCode },
    });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('attempts every pending cancellation even when one proxy cancellation fails', async () => {
    const executeResolvers = new Map<string, (value: McpResult) => void>();
    const cancelled: string[] = [];
    const callTool = vi.fn(async (_server: string, tool: string, args: Record<string, unknown>) => {
      if (tool.endsWith('operation_execute')) {
        const operationId = (args.request as { operationId: string }).operationId;
        return await new Promise<McpResult>((resolve) =>
          executeResolvers.set(operationId, resolve)
        );
      }
      const operationId = args.operationId as string;
      cancelled.push(operationId);
      if (cancelled.length === 1) throw new Error('cancel transport failed');
      return { content: [], structuredContent: operationResult(operationId, 'cancelled') };
    });
    const wrapper = createWrapper(callTool);
    const first = wrapper.execute({ stepId: 'login' }, 'pending-1');
    const second = wrapper.execute({ stepId: 'login' }, 'pending-2');
    await vi.waitFor(() => expect(executeResolvers.size).toBe(2));

    await expect(wrapper.cancelPending()).resolves.toBeUndefined();
    expect(cancelled).toHaveLength(2);

    for (const [operationId, resolve] of executeResolvers) {
      resolve({ content: [], structuredContent: operationResult(operationId, 'succeeded') });
    }
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('keeps cancel internal and injects credentials', async () => {
    const callTool = vi.fn(async () => ({
      content: [],
      structuredContent: operationResult('op-1', 'cancelled'),
    }));
    const wrapper = createWrapper(callTool);

    await wrapper.cancel('op-1');

    expect(callTool).toHaveBeenCalledWith('gateway', 'browser-control.operation_cancel', {
      operationId: 'op-1',
      sessionId: 'session-1',
      leaseId: 'lease-1',
      leaseToken: 'top-secret',
    });
  });
});
