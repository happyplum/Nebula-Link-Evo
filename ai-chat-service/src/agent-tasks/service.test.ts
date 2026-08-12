import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskError } from './errors.js';
import { AgentTaskRepository } from './repository.js';
import { AgentTaskService } from './service.js';

const services: AgentTaskService[] = [];

function request() {
  return {
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId: 'client-1',
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
  };
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
});

describe('AgentTaskService', () => {
  it('runs a newly persisted task asynchronously and returns it idempotently', async () => {
    const repository = new AgentTaskRepository(':memory:');
    const execute = vi.fn(async () => ({
      output: { result: 'ok' },
      terminationReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, modelTurns: 1, toolCalls: 0 },
      toolCalls: [],
    }));
    const service = new AgentTaskService(
      repository,
      { execute },
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    );
    services.push(service);

    const created = service.create(request(), { idempotencyKey: 'idem-1' });
    const duplicate = service.create(request(), { idempotencyKey: 'idem-1' });
    expect(created.created).toBe(true);
    expect(duplicate).toMatchObject({ created: false, task: { taskId: created.task.taskId } });
    await vi.waitFor(() => expect(service.get(created.task.taskId).status).toBe('completed'));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('maps missing dependencies to blocked', async () => {
    const repository = new AgentTaskRepository(':memory:');
    const service = new AgentTaskService(
      repository,
      {
        execute: async () => {
          throw new AgentTaskError(
            'dependency_unavailable',
            'model missing',
            true
          ).withExecutionTrace({
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'vision.test',
                status: 'failed',
                errorCode: 'dependency_unavailable',
              },
            ],
          });
        },
      },
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    );
    services.push(service);

    const created = service.create(request());
    await vi.waitFor(() => expect(service.get(created.task.taskId).status).toBe('blocked'));
    expect(service.get(created.task.taskId).toolCalls).toEqual([
      {
        toolCallId: 'call-1',
        toolName: 'vision.test',
        status: 'failed',
        errorCode: 'dependency_unavailable',
      },
    ]);
  });
});
