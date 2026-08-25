import axios, { isAxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskClient, type CreateAgentTaskInput } from '../agent-task-client.js';
import { SemanticBrowserClient } from '../semantic-browser-client.js';

vi.mock('axios');

const mockedAxios = vi.mocked(axios);

function axiosInstance() {
  return { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
}

describe('semantic control HTTP clients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAxiosError).mockImplementation(
      (error): error is never => Boolean((error as { isAxiosError?: boolean })?.isAxiosError)
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

  it('按持久 seq 游标消费 Agent 与浏览器事件日志', async () => {
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

    const browserHttp = axiosInstance();
    browserHttp.get.mockResolvedValueOnce({
      data: { data: [{ id: 'event-7', sessionId: 'session-1', seq: 7 }], meta: {} },
    });
    mockedAxios.create.mockReturnValueOnce(browserHttp as never);
    const browser = new SemanticBrowserClient({ baseUrl: 'http://127.0.0.1:3000' });
    await expect(browser.listSessionEvents('session-1', 6, 25)).resolves.toMatchObject([
      { seq: 7 },
    ]);
    expect(browserHttp.get).toHaveBeenCalledWith(
      '/api/v1/browser-execution/sessions/session-1/event-log',
      expect.objectContaining({ params: { afterSeq: 6, limit: 25 } })
    );
  });

  it('浏览器客户端解包 session/lease，并只在 Authorization header 中传租约 token', async () => {
    const mock = axiosInstance();
    mock.post
      .mockResolvedValueOnce({ data: { data: sessionView(), meta: { requestId: 'r1' } } })
      .mockResolvedValueOnce({
        data: {
          data: { lease: leaseView(), token: 'opaque-token', tokenIssued: true },
          meta: { requestId: 'r2' },
        },
      });
    mock.delete.mockResolvedValueOnce({
      data: { data: { ...leaseView(), status: 'revoked' }, meta: { requestId: 'r3' } },
    });
    mockedAxios.create.mockReturnValue(mock as never);
    const client = new SemanticBrowserClient({ baseUrl: 'http://127.0.0.1:3000' });

    mock.get.mockResolvedValueOnce({
      data: {
        schema: 'nebula.service-capabilities/1.0',
        service: 'proxy-adapter',
        serviceVersion: '2.0.0',
        protocols: { browserExecution: { major: 1, minor: 0 } },
        features: {},
        limits: {},
        generatedAt: '2026-08-25T00:00:00.000Z',
      },
    });

    await expect(client.getCapabilities()).resolves.toMatchObject({
      service: 'proxy-adapter',
      protocols: { browserExecution: { major: 1, minor: 0 } },
    });
    await expect(client.createSession('session-create')).resolves.toMatchObject({ id: 'session-1' });
    await expect(
      client.createLease('session-1', 'lease-create', {
        mode: 'control',
        operations: ['page_state'],
      })
    ).resolves.toMatchObject({ tokenIssued: true, token: 'opaque-token' });
    await client.revokeLease('session-1', 'lease-1', 'opaque-token', 'lease-revoke');

    expect(mock.delete).toHaveBeenCalledWith(
      '/api/v1/browser-execution/sessions/session-1/leases/lease-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer opaque-token',
          'X-Browser-Lease-ID': 'lease-1',
        }),
      })
    );
    expect(JSON.stringify(mock.post.mock.calls)).not.toContain('opaque-token');
  });
});

function taskRequest(): CreateAgentTaskInput {
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

function sessionView() {
  return {
    id: 'session-1',
    status: 'active',
    tabs: [{ id: 'tab-1', url: 'about:blank', title: '', isActive: true }],
    activeLeases: [],
    liveView: { available: true, controlAllowed: false },
    viewport: { width: 1920, height: 1080 },
    createdAt: '2026-08-24T00:00:00.000Z',
  };
}

function leaseView() {
  return {
    id: 'lease-1',
    sessionId: 'session-1',
    mode: 'control',
    sequence: 1,
    status: 'active',
    policy: { tabIds: ['tab-1'], operations: ['page_state'] },
    expiresAt: '2026-08-24T00:05:00.000Z',
    createdAt: '2026-08-24T00:00:00.000Z',
  };
}
