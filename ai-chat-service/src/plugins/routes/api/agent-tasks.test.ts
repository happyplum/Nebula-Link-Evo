import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskRepository } from '../../../agent-tasks/repository.js';
import { AgentTaskService } from '../../../agent-tasks/service.js';
import type { AgentTaskExecutor } from '../../../agent-tasks/types.js';
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

const completedExecutor: AgentTaskExecutor = {
  execute: async () => ({
    output: { ok: true },
    terminationReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, modelTurns: 1, toolCalls: 0 },
    toolCalls: [],
  }),
};

async function setup(localControlPlane = true, executor: AgentTaskExecutor = completedExecutor) {
  const app = Fastify();
  const repository = new AgentTaskRepository(':memory:');
  const service = new AgentTaskService(repository, executor, {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
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
        taskEvents: true,
        taskCommands: true,
        skillsRuntime: true,
        operationPresentationAnimation: false,
      },
      protocols: { 'nebula.ai.skill': { major: 1, minor: 0 } },
      limits: { maxSkillsPerTask: 1, loadedSkillVersions: 0 },
    });
    const skills = await app.inject({ method: 'GET', url: '/api/v1/skills' });
    expect(skills.statusCode).toBe(200);
    expect(skills.json()).toEqual([]);
  });

  it('accepts the caller-frozen side-effect authorization envelope', async () => {
    const app = await setup();
    const request = body();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks',
      payload: {
        ...request,
        toolPolicy: {
          allow: ['browser-control.operation_execute'],
          constraints: {
            'browser-control.operation_execute': {
              steps: [
                {
                  stepId: 'step-1',
                  kind: 'act',
                  operation: 'navigate',
                  args: { url: 'http://example.test/' },
                  effectId: 'effect-1',
                  maxAffectedItems: 1,
                },
              ],
            },
          },
        },
        browserBinding: {
          browserSessionId: 'session-1',
          tabId: 'tab-1',
          browserLeaseId: 'lease-1',
          browserLeaseToken: 'token-1',
          browserLeaseSequence: 1,
          access: 'control',
        },
        sideEffectAuthorization: {
          contextType: 'run',
          contextId: 'run-1',
          environment: 'test',
          policyVersion: 'side-effect-policy/1.0',
          policyEvaluationId: 'evaluation-1',
          policyResult: 'auto_allowed',
          projectionSha256: 'a'.repeat(64),
          effects: [
            {
              stepId: 'step-1',
              effectId: 'effect-1',
              kind: 'update',
              maxAffectedItems: 1,
              reversibility: 'reversible',
            },
          ],
        },
        correlation: { runId: 'run-1' },
      },
    });

    expect(create.statusCode).toBe(202);
    expect(create.json().request.sideEffectAuthorization).toMatchObject({
      contextId: 'run-1',
      policyEvaluationId: 'evaluation-1',
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

  it('executes optimistic commands and exposes the durable event log', async () => {
    const app = await setup(true, {
      execute: async (context) => {
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true }
          );
        });
        throw new Error('unreachable');
      },
    });
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks',
      payload: body(),
    });
    const taskId = create.json().taskId as string;
    let current = create.json();
    await vi.waitFor(async () => {
      current = (await app.inject({ method: 'GET', url: `/api/v1/agent-tasks/${taskId}` })).json();
      expect(current.status).toBe('running');
    });

    const command = await app.inject({
      method: 'POST',
      url: `/api/v1/agent-tasks/${taskId}/commands`,
      payload: {
        commandId: 'cancel-route-1',
        type: 'cancel',
        expectedStateVersion: current.stateVersion,
      },
    });
    expect(command.statusCode).toBe(200);
    expect(command.json()).toMatchObject({
      command: { status: 'completed' },
      task: { status: 'cancelled' },
    });

    const events = await app.inject({
      method: 'GET',
      url: `/api/v1/agent-tasks/${taskId}/event-log?afterSeq=0&limit=100`,
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining([
        'agent_task.command.accepted',
        'agent_task.state_changed',
        'agent_task.command.completed',
      ])
    );
  });

  it('streams committed events and recovers a disconnected client from a fresh snapshot', async () => {
    const app = await setup(true, {
      execute: async (context) => {
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true }
          );
        });
        throw new Error('unreachable');
      },
    });
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks',
      payload: { ...body(), clientTaskId: 'stream-client' },
    });
    const taskId = create.json().taskId as string;
    await vi.waitFor(async () => {
      const task = await app.inject({ method: 'GET', url: `/api/v1/agent-tasks/${taskId}` });
      expect(task.json().status).toBe('running');
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/v1/agent-tasks/${taskId}/events`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const firstChunk = await reader.read();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(new TextDecoder().decode(firstChunk.value)).toContain('event: agent_task.snapshot');

    const running = await app.inject({ method: 'GET', url: `/api/v1/agent-tasks/${taskId}` });
    const command = await app.inject({
      method: 'POST',
      url: `/api/v1/agent-tasks/${taskId}/commands`,
      payload: {
        commandId: 'cancel-stream-1',
        type: 'cancel',
        expectedStateVersion: running.json().stateVersion,
      },
    });
    expect(command.statusCode).toBe(200);
    let liveText = '';
    while (!liveText.includes('agent_task.command.completed')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      liveText += new TextDecoder().decode(chunk.value);
    }
    expect(liveText).toContain('event: agent_task.command.completed');
    await reader.cancel();
    controller.abort();

    const reconnectController = new AbortController();
    const reconnect = await fetch(`${address}/api/v1/agent-tasks/${taskId}/events`, {
      signal: reconnectController.signal,
    });
    const reconnectReader = reconnect.body!.getReader();
    const reconnectChunk = await reconnectReader.read();
    const reconnectText = new TextDecoder().decode(reconnectChunk.value);
    await reconnectReader.cancel();
    reconnectController.abort();

    expect(reconnectText).toContain('event: agent_task.snapshot');
    expect(reconnectText).toContain('"status":"cancelled"');
  });
});
