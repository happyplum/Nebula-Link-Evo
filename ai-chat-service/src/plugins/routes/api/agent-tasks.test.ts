import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskRepository } from '../../../agent-tasks/repository.js';
import { AgentTaskService } from '../../../agent-tasks/service.js';
import agentTaskRoutes from './agent-tasks.js';

const cleanups: Array<() => Promise<void>> = [];

function body() {
  return {
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId: 'client-1',
    modelRole: 'decision',
    input: { objective: '分析页面' },
    responseSchema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    toolPolicy: { allow: [] },
    skillPolicy: { allow: [] },
    budgets: { maxDurationMs: 5_000, maxModelTurns: 1, maxToolCalls: 0 },
  };
}

async function setup(localControlPlane = true) {
  const app = Fastify();
  const repository = new AgentTaskRepository(':memory:');
  const service = new AgentTaskService(
    repository,
    {
      execute: async () => ({
        output: { ok: true },
        terminationReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, modelTurns: 1, toolCalls: 0 },
        toolCalls: [],
      }),
    },
    { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  );
  await app.register(agentTaskRoutes, {
    prefix: '/api/v1',
    service,
    serviceVersion: '0.1.0',
    localControlPlane,
  });
  cleanups.push(async () => {
    await service.close();
    await app.close();
  });
  return app;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('Agent task routes', () => {
  it('creates, gets and advertises the minimal implemented surface', async () => {
    const app = await setup();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks',
      headers: { 'idempotency-key': 'idem-1' },
      payload: body(),
    });
    expect(create.statusCode).toBe(202);
    const task = create.json();
    expect(JSON.stringify(task)).not.toContain('browserLeaseToken');

    const get = await app.inject({ method: 'GET', url: `/api/v1/agent-tasks/${task.taskId}` });
    expect(get.statusCode).toBe(200);
    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json()).toMatchObject({
      features: {
        agentTasks: true,
        taskEvents: false,
        skillsRuntime: false,
        operationPresentationAnimation: false,
      },
    });
  });

  it('returns a structured conflict and refuses non-loopback control-plane exposure', async () => {
    const app = await setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks',
      headers: { 'idempotency-key': 'idem-1' },
      payload: body(),
    });
    const changed = body();
    changed.input.objective = '另一个任务';
    changed.clientTaskId = 'client-2';
    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks',
      headers: { 'idempotency-key': 'idem-1' },
      payload: changed,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'conflict' } });

    const remote = await setup(false);
    const remoteCapabilities = await remote.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(remoteCapabilities.statusCode).toBe(200);
    expect(remoteCapabilities.json()).toMatchObject({ features: { localControlPlane: false } });
    const denied = await remote.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks',
      payload: body(),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'tool_not_allowed' } });
  });
});
