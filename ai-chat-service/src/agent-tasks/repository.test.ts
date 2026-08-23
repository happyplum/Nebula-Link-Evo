import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { AgentTaskRepository } from './repository.js';
import { validateCreateAgentTaskRequest } from './validation.js';

const repositories: AgentTaskRepository[] = [];

function request(clientTaskId = 'client-1') {
  return validateCreateAgentTaskRequest({
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId,
    modelRole: 'decision',
    input: { objective: '分析页面' },
    responseSchema: {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
      additionalProperties: false,
    },
    toolPolicy: { allow: [] },
    skillPolicy: { allow: [] },
    budgets: { maxDurationMs: 5_000, maxModelTurns: 2, maxToolCalls: 0 },
  });
}

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
});

describe('AgentTaskRepository', () => {
  it('creates idempotently and rejects key reuse with a different request', () => {
    const repository = new AgentTaskRepository(':memory:');
    repositories.push(repository);
    const validated = request();
    const input = {
      taskId: 'task-1',
      request: validated.persistedRequest,
      requestHash: validated.requestHash,
      idempotencyKey: 'idem-1',
    };

    expect(repository.createOrGet(input).created).toBe(true);
    expect(repository.createOrGet({ ...input, taskId: 'task-2' })).toMatchObject({
      created: false,
      task: { taskId: 'task-1' },
    });
    const other = request('client-2');
    expect(() =>
      repository.createOrGet({
        taskId: 'task-3',
        request: other.persistedRequest,
        requestHash: other.requestHash,
        idempotencyKey: 'idem-1',
      })
    ).toThrow('reused with a different request');
  });

  it('persists terminal output and interrupts unfinished tasks on recovery', () => {
    const repository = new AgentTaskRepository(':memory:');
    repositories.push(repository);
    const first = request('first');
    repository.createOrGet({
      taskId: 'task-1',
      request: first.persistedRequest,
      requestHash: first.requestHash,
    });
    repository.markRunning('task-1');
    repository.complete('task-1', {
      output: { result: 'ok' },
      terminationReason: 'completed',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, modelTurns: 1, toolCalls: 0 },
      toolCalls: [],
    });
    expect(repository.get('task-1')).toMatchObject({
      status: 'completed',
      output: { result: 'ok' },
    });

    const second = request('second');
    repository.createOrGet({
      taskId: 'task-2',
      request: second.persistedRequest,
      requestHash: second.requestHash,
    });
    expect(repository.recoverUnfinished()).toBe(1);
    expect(repository.get('task-2')).toMatchObject({
      status: 'interrupted',
      terminationReason: 'service_restarted',
    });
  });

  it('commits the DSH cursor and matching pending result in the terminal transaction', () => {
    const repository = new AgentTaskRepository(':memory:');
    repositories.push(repository);
    const validated = request('harness');
    repository.createOrGet({
      taskId: 'task-harness',
      request: validated.persistedRequest,
      requestHash: validated.requestHash,
    });
    repository.markRunning('task-harness');
    const projection = repository.getHarnessProjection('task-harness');
    const output = { result: 'ok' };
    const hash = createHash('sha256').update(JSON.stringify(output)).digest('hex');
    repository.recordPendingHarnessResult('task-harness', 'call-1', hash, output);
    const result = {
      output,
      terminationReason: 'completed',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, modelTurns: 1, toolCalls: 0 },
      toolCalls: [],
      harness: {
        sessionId: projection.sessionId,
        durableSeq: 2,
        durableRevision: 'revision-1',
        resultCallId: 'call-1',
        resultHash: hash,
        events: [
          { seq: 0, type: 'tool/call' },
          { seq: 1, type: 'tool/result' },
        ],
      },
    };
    expect(repository.completeHarness('task-harness', result)).toMatchObject({
      status: 'completed',
      output,
    });
    expect(repository.getHarnessProjection('task-harness')).toMatchObject({
      projectedDshSeq: 2,
      durableDshSeq: 2,
    });
  });

  it('reserves total tokens conservatively and releases only settled surplus', () => {
    const repository = new AgentTaskRepository(':memory:');
    repositories.push(repository);
    const validated = request('budget');
    repository.createOrGet({
      taskId: 'task-budget',
      request: validated.persistedRequest,
      requestHash: validated.requestHash,
    });
    repository.markRunning('task-budget');
    expect(repository.reserveTokenBudget('task-budget', 'r1', 100, 20, 80)).toBe(80);
    expect(() => repository.reserveTokenBudget('task-budget', 'r2', 100, 1, 1)).toThrow(
      /cannot reserve/
    );
    repository.settleTokenBudget('task-budget', 'r1', 20, 10);
    expect(repository.reserveTokenBudget('task-budget', 'r2', 100, 20, 80)).toBe(50);
    expect(repository.reserveTokenBudget('task-budget', 'r2', 100, 20, 80)).toBe(50);
  });

  it('persists an immutable authorization record before dispatch and recovers unknown outcomes', () => {
    const repository = new AgentTaskRepository(':memory:');
    repositories.push(repository);
    const validated = request('operation');
    repository.createOrGet({
      taskId: 'task-operation',
      request: validated.persistedRequest,
      requestHash: validated.requestHash,
    });
    repository.markRunning('task-operation');
    const operation = {
      toolCallId: 'call-1',
      operationId: 'operation-1',
      toolName: 'browser-control.operation_execute',
      requestHash: 'a'.repeat(64),
      canonicalArgs: { stepId: 'step-1' },
      quantity: { browserOperations: 1 as const, affectedItems: 1 as const, sideEffectUnits: 1 as const },
      authorization: { toolAllow: ['browser-control.operation_execute'] },
      browserBinding: {
        browserSessionId: 'session-1',
        tabId: 'tab-1',
        browserLeaseId: 'lease-1',
        browserLeaseSequence: 2,
        access: 'control' as const,
      },
    };
    repository.reserveOperation('task-operation', operation);
    repository.reserveOperation('task-operation', operation);
    expect(() =>
      repository.reserveOperation('task-operation', {
        ...operation,
        requestHash: 'b'.repeat(64),
      })
    ).toThrow('immutable identity changed');
    repository.markOperationDispatched('task-operation', 'call-1');

    expect(repository.recoverUnfinished()).toBe(1);
    expect(
      repository
        .connection()
        .prepare(
          'SELECT status, browser_binding_json AS binding FROM agent_task_operations WHERE operation_id = ?'
        )
        .get('operation-1')
    ).toEqual({
      status: 'outcome_unknown',
      binding: JSON.stringify(operation.browserBinding),
    });
  });
});
