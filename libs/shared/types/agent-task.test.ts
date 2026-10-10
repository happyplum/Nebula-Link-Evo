import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  AGENT_TASK_SCHEMA,
  AGENT_TASK_STATUSES,
  AgentTaskStatusSchema,
  CreateAgentTaskRequestSchema,
  PersistedAgentTaskRequestSchema,
  AgentTaskCommandRequestSchema,
  AgentTaskViewSchema,
  AgentTaskBrowserStepSchema,
  AgentTaskSideEffectAuthorizationSchema,
  type CreateAgentTaskRequest,
} from './agent-task.js';
import { BrowserTargetRefV1Schema } from './browser-target.js';

function request() {
  return {
    schema: AGENT_TASK_SCHEMA,
    clientTaskId: 'client-1',
    modelRole: 'decision',
    input: {},
    responseSchema: { type: 'object' },
    toolPolicy: { allow: [] },
    skillPolicy: { allow: [] },
    budgets: { maxDurationMs: 5000, maxModelTurns: 1, maxToolCalls: 0 },
    browserBinding: {
      browserSessionId: 'session-1',
      tabId: 'tab-1',
      browserLeaseId: 'lease-1',
      browserLeaseToken: 'test-lease-token',
      browserLeaseSequence: 1,
      access: 'control',
    },
  } satisfies CreateAgentTaskRequest;
}

describe('Agent Task public schema', () => {
  it.each([
    { grantId: '', valid: true },
    { grantId: 'x'.repeat(300), valid: true },
    { grantId: 1, valid: false },
  ])('preserves the existing grant ID string contract: %j', ({ grantId, valid }) => {
    const authorization = {
      contextType: 'run',
      contextId: 'run-1',
      environment: 'staging',
      policyVersion: '1',
      policyEvaluationId: 'evaluation-1',
      policyResult: 'approval_required',
      projectionSha256: 'a'.repeat(64),
      effects: [
        {
          stepId: 'step-1',
          effectId: 'effect-1',
          kind: 'delete',
          maxAffectedItems: 1,
          reversibility: 'irreversible',
        },
      ],
      grant: { grantId, status: 'active', approvedProjectionSha256: 'a'.repeat(64) },
    };
    expect(Value.Check(AgentTaskSideEffectAuthorizationSchema, authorization)).toBe(valid);
  });

  it('separates capability-bearing creation from persisted/public requests', () => {
    const created = request();
    expect(Value.Check(CreateAgentTaskRequestSchema, created)).toBe(true);
    expect(Value.Check(PersistedAgentTaskRequestSchema, created)).toBe(false);
    const { browserLeaseToken: _token, ...safeBinding } = created.browserBinding;
    const persisted = { ...created, browserBinding: safeBinding };
    expect(Value.Check(PersistedAgentTaskRequestSchema, persisted)).toBe(true);
    expect(Value.Check(CreateAgentTaskRequestSchema, persisted)).toBe(false);
    const view = {
      schema: AGENT_TASK_SCHEMA,
      taskId: 'task-1',
      clientTaskId: created.clientTaskId,
      status: 'created',
      stateVersion: 1,
      eventSeq: 0,
      modelRole: 'decision',
      request: persisted,
      toolCalls: [],
      createdAt: 'now',
      updatedAt: 'now',
    };
    expect(Value.Check(AgentTaskViewSchema, view)).toBe(true);
    expect(Value.Check(AgentTaskViewSchema, { ...view, request: created })).toBe(false);
  });

  it.each(['', 'x'.repeat(65)])('rejects invalid correlation key %j', (key) => {
    expect(
      Value.Check(CreateAgentTaskRequestSchema, { ...request(), correlation: { [key]: 'value' } })
    ).toBe(false);
  });

  it('preserves newline and UTF-16 correlation keys within their original bounds', () => {
    expect(
      Value.Check(CreateAgentTaskRequestSchema, {
        ...request(),
        correlation: { ['\n' + '😀'.repeat(31)]: 'value' },
      })
    ).toBe(true);
    expect(
      Value.Check(CreateAgentTaskRequestSchema, {
        ...request(),
        correlation: { ['😀'.repeat(33)]: 'value' },
      })
    ).toBe(false);
  });

  it('rejects unsafe sequence/state version and wrong command/field types', () => {
    const created = request();
    created.browserBinding.browserLeaseSequence = Number.MAX_SAFE_INTEGER + 1;
    expect(Value.Check(CreateAgentTaskRequestSchema, created)).toBe(false);
    const command = { commandId: 'command-1', type: 'pause', expectedStateVersion: 1 };
    expect(Value.Check(AgentTaskCommandRequestSchema, command)).toBe(true);
    for (const patch of [
      { expectedStateVersion: Number.MAX_SAFE_INTEGER + 1 },
      { expectedStateVersion: '1' },
      { type: 'restart' },
      { unknown: true },
    ])
      expect(Value.Check(AgentTaskCommandRequestSchema, { ...command, ...patch })).toBe(false);
    expect(AGENT_TASK_STATUSES.every((status) => Value.Check(AgentTaskStatusSchema, status))).toBe(
      true
    );
    expect(Value.Check(AgentTaskStatusSchema, 'unknown')).toBe(false);
  });

  it('keeps videoSegment in the real browser step contract and rejects malformed targets', () => {
    const step = {
      stepId: 'step-1',
      kind: 'observe',
      operation: 'page_state',
      capture: { videoSegment: true },
    };
    expect(Value.Check(AgentTaskBrowserStepSchema, step)).toBe(true);
    expect(Value.Check(AgentTaskBrowserStepSchema, { ...step, capture: { unknown: true } })).toBe(
      false
    );
    expect(Value.Check(AgentTaskBrowserStepSchema, { ...step, target: {} })).toBe(false);
    const target = {
      semantic: 'Login',
      candidates: [{ strategy: 'role', role: 'button', name: 'Login' }],
      expected: { cardinality: 'exactly_one' },
    };
    expect(Value.Check(BrowserTargetRefV1Schema, target)).toBe(true);
    expect(
      Value.Check(BrowserTargetRefV1Schema, {
        ...target,
        candidates: [{ strategy: 'role', role: 'button', value: 'extra' }],
      })
    ).toBe(false);
  });
});
