import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentTaskRepository,
  computeSkillContentHash,
  type SkillManifestV1,
} from './repository.js';
import { validateCreateAgentTaskRequest } from './validation.js';

const repositories: AgentTaskRepository[] = [];
const tempDirectories: string[] = [];
const now = '2026-08-12T00:00:00.000Z';

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTask(repository: AgentTaskRepository, taskId = 'task-1'): void {
  const validated = validateCreateAgentTaskRequest({
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId: `client-${taskId}`,
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
  repository.createOrGet({
    taskId,
    request: validated.persistedRequest,
    requestHash: validated.requestHash,
  });
}

function createRepository(path = ':memory:'): AgentTaskRepository {
  const repository = new AgentTaskRepository(path);
  repositories.push(repository);
  return repository;
}

function skill(instructions = '只提取明确写出的需求。') {
  const manifest: SkillManifestV1 = {
    schema: 'nebula.ai.skill/1.0',
    id: 'document.requirements_extract',
    version: '1.0.0',
    description: '提取结构化需求',
    contentHash: '0'.repeat(64),
    requiredModelRole: 'decision',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    requiredToolPatterns: [],
    limits: { maxToolCalls: 0, maxModelTurns: 2, maxTokens: 2000 },
  };
  manifest.contentHash = computeSkillContentHash(manifest, instructions);
  return {
    manifest,
    instructions,
    sourceRef: 'skills/document.requirements_extract/1.0.0',
    registeredAt: now,
  };
}

describe('Agent task command, event and Skill data foundation', () => {
  it('persists state versions and monotonic events with task transitions', () => {
    const repository = createRepository();
    createTask(repository);
    expect(repository.getPersistenceState('task-1')).toMatchObject({
      stateVersion: 1,
      nextEventSeq: 2,
    });

    repository.markRunning('task-1');
    repository.complete('task-1', {
      output: { result: 'ok' },
      terminationReason: 'completed',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, modelTurns: 1, toolCalls: 0 },
      toolCalls: [],
    });

    expect(repository.getPersistenceState('task-1')).toMatchObject({
      stateVersion: 3,
      nextEventSeq: 4,
    });
    expect(repository.listEvents('task-1').map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(repository.listEvents('task-1').map((event) => event.stateVersion)).toEqual([1, 2, 3]);
  });

  it('records command idempotency, optimistic state and terminal command events', () => {
    const repository = createRepository();
    createTask(repository);
    const command = {
      id: 'command-1',
      taskId: 'task-1',
      type: 'cancel' as const,
      expectedStateVersion: 1,
      requestHash: 'a'.repeat(64),
      createdBy: 'ai-e2e',
      createdAt: now,
    };
    expect(repository.createCommand(command)).toMatchObject({ status: 'accepted' });
    expect(repository.createCommand(command)).toMatchObject({ id: 'command-1' });
    expect(() => repository.createCommand({ ...command, requestHash: 'b'.repeat(64) })).toThrow(
      'different request'
    );

    repository.markRunning('task-1');
    expect(() => repository.createCommand({ ...command, id: 'command-stale' })).toThrow(
      'state version is 2'
    );
    expect(
      repository.completeCommand('command-1', {
        status: 'completed',
        completedAt: now,
        result: { accepted: true },
      })
    ).toMatchObject({ status: 'completed', result: { accepted: true } });
    expect(repository.listEvents('task-1').map((event) => event.seq)).toEqual([1, 2, 3, 4]);
  });

  it('stores append-only checkpoints as the restart recovery index', () => {
    const repository = createRepository();
    createTask(repository);
    repository.markRunning('task-1');
    const checkpoint = repository.saveCheckpoint({
      id: 'checkpoint-1',
      taskId: 'task-1',
      payload: { modelTurn: 1, pendingToolCalls: [] },
      createdAt: now,
    });
    expect(checkpoint).toMatchObject({ checkpointNo: 1, stateVersion: 2 });
    expect(repository.getPersistenceState('task-1')).toMatchObject({
      lastCheckpointId: 'checkpoint-1',
    });
    expect(repository.getLatestCheckpoint('task-1')).toEqual(checkpoint);
    expect(() =>
      repository.saveCheckpoint({
        id: 'checkpoint-1',
        taskId: 'task-1',
        payload: { modelTurn: 2 },
        createdAt: now,
      })
    ).toThrow('different content');
  });

  it('registers immutable Skill versions and pins exact hashes to a task', () => {
    const repository = createRepository();
    createTask(repository);
    const registered = skill();
    expect(repository.registerSkillVersion(registered).created).toBe(true);
    expect(repository.registerSkillVersion(registered).created).toBe(false);
    expect(() => repository.registerSkillVersion(skill('改变后的指令'))).toThrow(
      'reused with different content'
    );

    const bindings = repository.bindTaskSkills(
      'task-1',
      [
        {
          skillId: registered.manifest.id,
          version: registered.manifest.version,
          contentHash: registered.manifest.contentHash,
        },
      ],
      'c'.repeat(64),
      now
    );
    expect(bindings).toEqual([
      expect.objectContaining({
        skillId: registered.manifest.id,
        version: '1.0.0',
        contentHash: registered.manifest.contentHash,
      }),
    ]);
    expect(() =>
      repository.bindTaskSkills(
        'task-1',
        [{ skillId: registered.manifest.id, version: '1.0.0', contentHash: 'd'.repeat(64) }],
        'c'.repeat(64),
        now
      )
    ).toThrow('immutable');
  });

  it('reopens the same file with migrations and recovery data intact', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nebula-agent-data-'));
    tempDirectories.push(directory);
    const path = join(directory, 'agent.sqlite');
    const repository = createRepository(path);
    createTask(repository);
    repository.markRunning('task-1');
    repository.createCommand({
      id: 'pause-before-restart',
      taskId: 'task-1',
      type: 'pause',
      expectedStateVersion: 2,
      requestHash: 'e'.repeat(64),
      createdBy: 'test',
      createdAt: now,
    });
    repository.pause('task-1', {
      id: 'pause:pause-before-restart',
      taskId: 'task-1',
      payload: { kind: 'safe_pause', toolCallsStarted: 0 },
      createdAt: now,
    });
    repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = createRepository(path);
    expect(reopened.getPersistenceState('task-1')).toMatchObject({ stateVersion: 3 });
    expect(reopened.recoverUnfinished()).toBe(1);
    expect(reopened.get('task-1')).toMatchObject({
      status: 'interrupted',
      terminationReason: 'service_restarted',
    });
    expect(reopened.getCommand('pause-before-restart')).toMatchObject({
      status: 'rejected',
      error: { code: 'service_restarted' },
    });
    expect(reopened.listEvents('task-1').map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
