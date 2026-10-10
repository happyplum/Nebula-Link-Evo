import axios, { isAxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type CreateAgentTaskRequest } from '@nebula-link-evo/shared/types/agent-task';
import { AgentTaskClient } from '../agent-task-client.js';

vi.mock('axios');

const mockedAxios = vi.mocked(axios);

function axiosInstance() {
  return { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
}

describe('semantic control HTTP clients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAxiosError).mockImplementation((error): error is never =>
      Boolean((error as { isAxiosError?: boolean })?.isAxiosError)
    );
  });

  it('Agent task 客户端携带幂等键并保留结构化错误语义', async () => {
    const mock = axiosInstance();
    mock.post.mockResolvedValueOnce({ data: taskView() });
    mockedAxios.create.mockReturnValue(mock as never);
    const client = new AgentTaskClient({ baseUrl: 'http://127.0.0.1:3001' });
    const request = taskRequest();

    await expect(client.createTask(request, 'agent-create-1')).resolves.toMatchObject({
      taskId: 'task-1',
    });
    expect(mock.post).toHaveBeenCalledWith(
      '/api/v1/agent-tasks',
      request,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'agent-create-1' }),
      })
    );

    const failure = Object.assign(new Error('conflict'), {
      isAxiosError: true,
      response: {
        status: 409,
        data: { error: { code: 'idempotency_conflict', message: '请求冲突', retryable: false } },
      },
    });
    mock.post.mockRejectedValueOnce(failure);
    await expect(client.createTask(request, 'agent-create-1')).rejects.toMatchObject({
      code: 'idempotency_conflict',
      retryable: false,
      statusCode: 409,
    });
  });

  it('按持久 seq 游标消费 Agent 事件日志', async () => {
    const agentHttp = axiosInstance();
    agentHttp.get.mockResolvedValueOnce({
      data: [
        {
          id: 'event-4',
          taskId: 'task-1',
          seq: 4,
          type: 'agent_task.completed',
          entityType: 'task',
          entityId: 'task-1',
          stateVersion: 2,
          payload: {},
          occurredAt: '2026-08-25T00:00:00.000Z',
          createdAt: '2026-08-25T00:00:00.000Z',
        },
      ],
    });
    mockedAxios.create.mockReturnValueOnce(agentHttp as never);
    const agent = new AgentTaskClient({ baseUrl: 'http://127.0.0.1:3001' });
    await expect(agent.listTaskEvents('task-1', 3, 25)).resolves.toMatchObject([{ seq: 4 }]);
    expect(agentHttp.get).toHaveBeenCalledWith(
      '/api/v1/agent-tasks/task-1/event-log',
      expect.objectContaining({ params: { afterSeq: 3, limit: 25 } })
    );
  });
});

function taskRequest(): CreateAgentTaskRequest {
  return {
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId: 'client-task-1',
    modelRole: 'decision',
    input: { objective: 'test' },
    responseSchema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    toolPolicy: { allow: [] },
    skillPolicy: { allow: [] },
    budgets: { maxDurationMs: 1_000, maxModelTurns: 1, maxToolCalls: 0 },
  };
}

function taskView() {
  return {
    schema: 'nebula.ai.agent-task/1.0',
    taskId: 'task-1',
    clientTaskId: 'client-task-1',
    status: 'created',
    stateVersion: 1,
    eventSeq: 1,
    toolCalls: [],
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  };
}
