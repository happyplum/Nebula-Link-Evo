import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAgentStreamEvent } from '@nebula-link-evo/shared/types/agent-stream';
import { AgentTaskRepository } from '../../agent-tasks/repository.js';
import { AgentTaskService } from '../../agent-tasks/service.js';
import type { AgentTaskExecutor } from '../../agent-tasks/types.js';
import agentTaskRoutes from './agent-tasks.js';
import type { CreateAgentTaskRequest } from '@nebula-link-evo/shared/types/agent-task';

const cleanups: Array<() => Promise<void>> = [];

function body(): CreateAgentTaskRequest {
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
  it.each([true, false])(
    'accepts a low-risk subset of an approved staging plan only with its grant: %s',
    async (approved) => {
      const app = await setup();
      const request: CreateAgentTaskRequest = {
        ...body(),
        browserBinding: {
          browserSessionId: 's',
          tabId: 't',
          browserLeaseId: 'l',
          browserLeaseToken: 'test-token',
          browserLeaseSequence: 1,
          access: 'control',
        },
        toolPolicy: {
          allow: ['browser-control.operation_execute'],
          constraints: {
            'browser-control.operation_execute': {
              steps: [
                {
                  stepId: 'create',
                  kind: 'act',
                  operation: 'click',
                  effectId: 'create',
                  maxAffectedItems: 1,
                },
              ],
            },
          },
        },
        correlation: { runId: 'repeat-two-run' },
        sideEffectAuthorization: {
          contextType: 'run',
          contextId: 'repeat-two-run',
          environment: 'staging',
          policyVersion: 'side-effect-policy/1.0',
          policyEvaluationId: 'evaluation',
          policyResult: 'approval_required',
          projectionSha256: 'a'.repeat(64),
          effects: [
            {
              stepId: 'create',
              effectId: 'create',
              kind: 'create',
              maxAffectedItems: 1,
              reversibility: 'compensatable',
            },
          ],
          ...(approved
            ? {
                grant: {
                  grantId: 'grant',
                  status: 'active',
                  approvedProjectionSha256: 'a'.repeat(64),
                },
              }
            : {}),
        },
      };
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/agent-tasks',
        payload: request,
      });
      expect(response.statusCode).toBe(approved ? 202 : 400);
    }
  );
  it.each([
    'browserBinding',
    'toolPolicy.constraints.browser-control.operation_execute',
    'toolPolicy.constraints.browser-control.operation_execute.steps.0',
    'toolPolicy.constraints.browser-control.operation_execute.steps.0.capture',
    'toolPolicy.constraints.browser-control.operation_execute.steps.0.target',
    'toolPolicy.constraints.browser-control.operation_execute.steps.0.target.expected',
    'toolPolicy.constraints.browser-control.operation_execute.steps.0.target.candidates.0',
    'sideEffectAuthorization',
    'sideEffectAuthorization.effects.0',
    'sideEffectAuthorization.grant',
  ])('rejects nested unknown fields in %s before starting a task', async (path) => {
    const execute = vi.fn(completedExecutor.execute);
    const app = await setup(true, { execute });
    const request: CreateAgentTaskRequest = {
      ...body(),
      browserBinding: {
        browserSessionId: 'session-1',
        tabId: 'tab-1',
        browserLeaseId: 'lease-1',
        browserLeaseToken: 'test-token',
        browserLeaseSequence: 1,
        access: 'control',
      },
      toolPolicy: {
        allow: ['browser-control.operation_execute'],
        constraints: {
          'browser-control.operation_execute': {
            steps: [
              {
                stepId: 'step-1',
                kind: 'act',
                operation: 'click',
                effectId: 'effect-1',
                maxAffectedItems: 1,
                capture: { domSnapshot: true },
                target: {
                  semantic: 'Login',
                  candidates: [{ strategy: 'role', role: 'button' }],
                  expected: { cardinality: 'exactly_one' },
                },
              },
            ],
          },
        },
      },
      sideEffectAuthorization: {
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
        grant: { grantId: 'grant-1', status: 'active', approvedProjectionSha256: 'a'.repeat(64) },
      },
      correlation: { runId: 'run-1' },
    };
    let nested = request as unknown as Record<string, unknown>;
    for (const key of path
      .replace('browser-control.operation_execute', 'executeConstraint')
      .split('.')) {
      nested = nested[
        key === 'executeConstraint' ? 'browser-control.operation_execute' : key
      ] as Record<string, unknown>;
    }
    nested.unknown = true;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks',
      payload: request,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'validation_failed' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { unknown: true },
    { expectedStateVersion: '1' },
    { expectedStateVersion: Number.MAX_SAFE_INTEGER + 1 },
    { type: 'restart' },
  ])('rejects malformed commands through the shared schema: %j', async (patch) => {
    const app = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks/missing/commands',
      payload: { commandId: 'command-1', type: 'pause', expectedStateVersion: 1, ...patch },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('rejects an oversized idempotency header at the HTTP boundary', async () => {
    const app = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks',
      payload: body(),
      headers: { 'idempotency-key': 'x'.repeat(201) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it.each([
    { unknown: true },
    { budgets: { maxDurationMs: 5000, maxModelTurns: 1, maxToolCalls: 0, unknown: true } },
    { toolPolicy: { allow: [], unknown: true } },
    { skillPolicy: { allow: [], unknown: true } },
    { budgets: { maxDurationMs: '5000', maxModelTurns: 1, maxToolCalls: 0 } },
    { correlation: { '': 'value' } },
    { correlation: { ['x'.repeat(65)]: 'value' } },
  ])('rejects unknown fields and scalar coercion at the HTTP boundary: %j', async (patch) => {
    const app = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-tasks',
      payload: { ...body(), ...patch },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'validation_failed', retryable: false },
    });
  });

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
    await vi.waitFor(async () => {
      const activity = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-tasks/${task.taskId}/activity-log?afterSeq=0&limit=100`,
      });
      expect(activity.statusCode).toBe(200);
      const events = activity.json();
      expect(events.every(isAgentStreamEvent)).toBe(true);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            schema: 'nebula.ai.agent-stream.event/1.0',
            streamId: task.taskId,
            type: 'section.upsert',
            section: expect.objectContaining({ sectionId: expect.any(String) }),
          }),
        ])
      );
    });
    const missingActivity = await app.inject({
      method: 'GET',
      url: '/api/v1/agent-tasks/missing/activity-log',
    });
    expect(missingActivity.statusCode).toBe(404);
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
    expect(create.json().request.browserBinding).toEqual({
      browserSessionId: 'session-1',
      tabId: 'tab-1',
      browserLeaseId: 'lease-1',
      browserLeaseSequence: 1,
      access: 'control',
    });
    expect(
      create.json().request.toolPolicy.constraints['browser-control.operation_execute'].steps[0]
    ).toMatchObject({
      stepId: 'step-1',
      args: { url: 'http://example.test/' },
      effectId: 'effect-1',
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

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/agent-tasks/${taskId}/commands`,
      payload: {
        commandId: 'cancel-route-1',
        type: 'cancel',
        expectedStateVersion: current.stateVersion,
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(command.json());

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
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    if (!response.body) throw new Error('agent task SSE response must have a body');
    const reader = response.body.getReader();
    const firstChunk = await reader.read();
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
    if (!reconnect.body) throw new Error('reconnected agent task SSE response must have a body');
    const reconnectReader = reconnect.body.getReader();
    const reconnectChunk = await reconnectReader.read();
    const reconnectText = new TextDecoder().decode(reconnectChunk.value);
    await reconnectReader.cancel();
    reconnectController.abort();

    expect(reconnectText).toContain('event: agent_task.snapshot');
    expect(reconnectText).toContain('"status":"cancelled"');
  });
});
