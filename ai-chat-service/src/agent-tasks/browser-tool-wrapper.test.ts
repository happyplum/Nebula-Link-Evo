import { describe, expect, it, vi } from 'vitest';
import { BrowserToolWrapper, type BrowserToolWrapperOptions } from './browser-tool-wrapper.js';

function operationResult(operationId: string, status: string, actual?: unknown) {
  return {
    schema: 'nebula.browser.operation-result/1.0',
    operationId,
    requestHash: 'hash-1',
    sessionId: 'session-1',
    leaseId: 'lease-1',
    leaseSequence: 7,
    tabId: 'tab-1',
    kind: 'act',
    operation: 'click',
    status,
    artifacts: [],
    ...(actual === undefined ? {} : { actual }),
  };
}

function createWrapper(
  callTool: ReturnType<typeof vi.fn>,
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
    mcpClient: { callTool },
    ...overrides,
  });
}

describe('BrowserToolWrapper', () => {
  it('projects a complete immutable Vision binding from a durable DOM snapshot', async () => {
    const callTool = vi.fn(
      async (_server: string, _tool: string, args: Record<string, unknown>) => ({
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
      return { parsed: operationResult(operationId, 'succeeded', { recovered: true }) };
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
      return { parsed: { invalid: true } };
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
        parsed: {
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
    const executeResolvers = new Map<string, (value: unknown) => void>();
    const cancelled: string[] = [];
    const callTool = vi.fn(async (_server: string, tool: string, args: Record<string, unknown>) => {
      if (tool.endsWith('operation_execute')) {
        const operationId = (args.request as { operationId: string }).operationId;
        return await new Promise((resolve) => executeResolvers.set(operationId, resolve));
      }
      const operationId = args.operationId as string;
      cancelled.push(operationId);
      if (cancelled.length === 1) throw new Error('cancel transport failed');
      return { parsed: operationResult(operationId, 'cancelled') };
    });
    const wrapper = createWrapper(callTool);
    const first = wrapper.execute({ stepId: 'login' }, 'pending-1');
    const second = wrapper.execute({ stepId: 'login' }, 'pending-2');
    await vi.waitFor(() => expect(executeResolvers.size).toBe(2));

    await expect(wrapper.cancelPending()).resolves.toBeUndefined();
    expect(cancelled).toHaveLength(2);

    for (const [operationId, resolve] of executeResolvers) {
      resolve({ parsed: operationResult(operationId, 'succeeded') });
    }
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('keeps cancel internal and injects credentials', async () => {
    const callTool = vi.fn(async () => ({ parsed: operationResult('op-1', 'cancelled') }));
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
