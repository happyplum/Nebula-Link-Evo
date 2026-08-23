import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskError } from './errors.js';
import { AgentTaskRepository } from './repository.js';
import { computeSkillContentHash, type SkillManifestV1 } from './repository.js';
import { AgentTaskService } from './service.js';
import type { AgentTaskExecutionContext } from './types.js';
import { SkillRuntime } from '../skills/runtime.js';

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

  it('pauses only before tool execution and resumes from a safe checkpoint', async () => {
    const repository = new AgentTaskRepository(':memory:');
    let executionNo = 0;
    const execute = vi.fn(async (context: AgentTaskExecutionContext) => {
      executionNo += 1;
      if (executionNo === 1) {
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Paused', 'AbortError')),
            { once: true }
          );
        });
      }
      return {
        output: { result: 'resumed' },
        terminationReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, modelTurns: 1, toolCalls: 0 },
        toolCalls: [],
      };
    });
    const service = new AgentTaskService(
      repository,
      { execute },
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    );
    services.push(service);
    const created = service.create(request());
    await vi.waitFor(() => expect(service.get(created.task.taskId).status).toBe('running'));

    const running = service.get(created.task.taskId);
    const paused = await service.command(created.task.taskId, {
      commandId: 'pause-1',
      type: 'pause',
      expectedStateVersion: running.stateVersion,
    });
    expect(paused).toMatchObject({
      command: { status: 'completed' },
      task: { status: 'paused', lastCheckpointId: 'pause:pause-1' },
    });

    const resumed = await service.command(created.task.taskId, {
      commandId: 'resume-1',
      type: 'resume',
      expectedStateVersion: paused.task.stateVersion,
    });
    expect(resumed).toMatchObject({
      command: { status: 'completed' },
      task: { status: 'running' },
    });
    await vi.waitFor(() => expect(service.get(created.task.taskId).status).toBe('completed'));
    expect(execute).toHaveBeenCalledTimes(2);

    const replay = await service.command(created.task.taskId, {
      commandId: 'resume-1',
      type: 'resume',
      expectedStateVersion: paused.task.stateVersion,
    });
    expect(replay.command.status).toBe('completed');
  });

  it('waits for an atomic tool call to settle before pausing', async () => {
    const repository = new AgentTaskRepository(':memory:');
    let settleOperation = (): void => {};
    const operation = new Promise<void>((resolve) => {
      settleOperation = resolve;
    });
    const service = new AgentTaskService(
      repository,
      {
        execute: async (context) => {
          context.beforeToolCall();
          await operation;
          expect(context.shouldPause?.()).toBe(true);
          throw new DOMException('Paused at safe checkpoint', 'AbortError');
        },
      },
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    );
    services.push(service);
    const created = service.create(request());
    await vi.waitFor(() => expect(service.get(created.task.taskId).status).toBe('running'));

    const running = service.get(created.task.taskId);
    const pausePromise = service.command(created.task.taskId, {
      commandId: 'pause-after-tool',
      type: 'pause',
      expectedStateVersion: running.stateVersion,
    });
    await Promise.resolve();
    expect(service.get(created.task.taskId).status).toBe('running');
    settleOperation();
    const pause = await pausePromise;
    expect(pause).toMatchObject({
      command: { status: 'completed' },
      task: { status: 'paused' },
    });
  });

  it('does not coalesce in-flight commands that reuse an id with different content', async () => {
    const repository = new AgentTaskRepository(':memory:');
    const service = new AgentTaskService(
      repository,
      {
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
      },
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    );
    services.push(service);
    const created = service.create(request());
    await vi.waitFor(() => expect(service.get(created.task.taskId).status).toBe('running'));
    const running = service.get(created.task.taskId);

    const first = service.command(created.task.taskId, {
      commandId: 'shared-command-id',
      type: 'pause',
      expectedStateVersion: running.stateVersion,
      reason: 'operator requested pause',
    });
    expect(() =>
      service.command(created.task.taskId, {
        commandId: 'shared-command-id',
        type: 'cancel',
        expectedStateVersion: running.stateVersion,
      })
    ).toThrowError(/already in use/);
    await first;
  });

  it('binds an exact Skill policy before scheduling and passes its immutable execution view', async () => {
    const repository = new AgentTaskRepository(':memory:');
    const runtime = new SkillRuntime(repository);
    const instructions = '只返回输入明确支持的结果。';
    const manifest: SkillManifestV1 = {
      schema: 'nebula.ai.skill/1.0',
      id: 'document.requirements_extract',
      version: '1.0.0',
      description: '提取需求',
      contentHash: '0'.repeat(64),
      requiredModelRole: 'decision',
      inputSchema: {
        type: 'object',
        properties: { objective: { type: 'string' } },
        required: ['objective'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { result: { type: 'string' } },
        required: ['result'],
        additionalProperties: false,
      },
      requiredToolPatterns: [],
      limits: { maxToolCalls: 0, maxModelTurns: 1, maxTokens: 100 },
    };
    manifest.contentHash = computeSkillContentHash(manifest, instructions);
    runtime.register({
      manifest,
      instructions,
      sourceRef: `local:${manifest.id}/${manifest.version}`,
      registeredAt: '2026-08-13T00:00:00.000Z',
    });
    let receivedSkill: AgentTaskExecutionContext['skill'];
    const service = new AgentTaskService(
      repository,
      {
        execute: async (context) => {
          receivedSkill = context.skill;
          context.emitEvent('agent_task.skill_loaded', {
            skillId: manifest.id,
            version: manifest.version,
            contentHash: manifest.contentHash,
          });
          return {
            output: { result: 'ok' },
            terminationReason: 'stop',
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
              modelTurns: 1,
              toolCalls: 0,
            },
            toolCalls: [],
          };
        },
      },
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runtime
    );
    services.push(service);
    const skillRequest = request();
    skillRequest.skillPolicy.allow = [
      {
        skillId: manifest.id,
        version: manifest.version,
        contentHash: manifest.contentHash,
      },
    ];

    const created = service.create(skillRequest, { idempotencyKey: 'skill-idempotency-1' });
    await vi.waitFor(() => expect(service.get(created.task.taskId).status).toBe('completed'));
    expect(receivedSkill).toMatchObject({
      skillId: manifest.id,
      version: manifest.version,
      contentHash: manifest.contentHash,
      effectiveToolAllow: [],
    });
    expect(repository.listTaskSkillBindings(created.task.taskId)).toEqual([
      expect.objectContaining({ skillId: manifest.id, contentHash: manifest.contentHash }),
    ]);
    expect(repository.listEvents(created.task.taskId).map((event) => event.type)).toContain(
      'agent_task.skills_bound'
    );
    expect(
      repository
        .listEvents(created.task.taskId)
        .find((event) => event.type === 'agent_task.skill_loaded')
    ).toMatchObject({ entityType: 'skill', entityId: `${manifest.id}@${manifest.version}` });

    const replayWithoutRuntime = new AgentTaskService(
      repository,
      {
        execute: async () => {
          throw new Error('must not execute an idempotent replay');
        },
      },
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    );
    expect(
      replayWithoutRuntime.create(skillRequest, { idempotencyKey: 'skill-idempotency-1' })
    ).toMatchObject({ created: false, task: { taskId: created.task.taskId, status: 'completed' } });
  });
});
