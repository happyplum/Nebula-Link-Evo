import { afterEach, describe, expect, it } from 'vitest';
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
});
