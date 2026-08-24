import { describe, expect, it, vi } from 'vitest';
import { BrowserToolWrapper } from './browser-tool-wrapper.js';

function createWrapper(callTool: ReturnType<typeof vi.fn>) {
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
  });
}

describe('BrowserToolWrapper', () => {
  it('injects hidden binding fields and uses a stable operationId', async () => {
    const callTool = vi.fn(
      async (_server: string, _tool: string, args: Record<string, unknown>) => ({
        parsed: {
          operationId: (args.request as { operationId: string }).operationId,
          status: 'succeeded',
          actual: { clicked: true },
        },
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

  it('queries the durable ledger after an ambiguous execute failure', async () => {
    let operationId = '';
    const callTool = vi.fn(async (_server: string, tool: string, args: Record<string, unknown>) => {
      if (tool.endsWith('operation_execute')) {
        operationId = (args.request as { operationId: string }).operationId;
        throw new Error('transport closed');
      }
      return { parsed: { operationId, status: 'succeeded', actual: { recovered: true } } };
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

  it('keeps cancel internal and injects credentials', async () => {
    const callTool = vi.fn(async () => ({ parsed: { operationId: 'op-1', status: 'cancelled' } }));
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
