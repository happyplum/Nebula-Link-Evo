import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskRepository } from '../agent-tasks/repository.js';
import { validateCreateAgentTaskRequest } from '../agent-tasks/validation.js';
import type { HarnessRuntime } from './types.js';
import { HarnessRetentionService } from './retention-service.js';

const roots: string[] = [];
const repositories: AgentTaskRepository[] = [];

afterEach(async () => {
  for (const repository of repositories.splice(0)) repository.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nebula-retention-'));
  roots.push(root);
  const repository = new AgentTaskRepository(':memory:');
  repositories.push(repository);
  return {
    root,
    repository,
    sessionRoot: join(root, 'sessions'),
    attachmentRoot: join(root, 'attachments'),
  };
}

function createCompletedTask(repository: AgentTaskRepository, taskId: string): string {
  const validated = validateCreateAgentTaskRequest({
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId: `client-${taskId}`,
    modelRole: 'decision',
    input: { objective: 'retention test' },
    responseSchema: {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
      additionalProperties: false,
    },
    toolPolicy: { allow: [] },
    skillPolicy: { allow: [] },
    budgets: { maxDurationMs: 5_000, maxModelTurns: 1, maxToolCalls: 0 },
  });
  repository.createOrGet({
    taskId,
    request: validated.persistedRequest,
    requestHash: validated.requestHash,
  });
  repository.markRunning(taskId);
  repository.complete(taskId, {
    output: { result: 'ok' },
    terminationReason: 'completed',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, modelTurns: 1, toolCalls: 0 },
    toolCalls: [],
  });
  return repository.getHarnessProjection(taskId).sessionId;
}

describe('HarnessRetentionService', () => {
  it('purges expired terminal sessions while preserving pinned tasks', async () => {
    const { repository, sessionRoot, attachmentRoot } = await fixture();
    const expiredSession = createCompletedTask(repository, 'expired');
    createCompletedTask(repository, 'pinned');
    repository.setPinned('pinned', true);
    repository
      .connection()
      .prepare('UPDATE agent_tasks SET completed_at = ?')
      .run('2000-01-01T00:00:00.000Z');

    const revision = { version: 1, digest: 'revision' } as never;
    const purge = vi.fn(async () => true);
    const harness = {
      revision: vi.fn(async () => revision),
      purge,
    } as unknown as HarnessRuntime;
    const service = new HarnessRetentionService(repository, harness, {
      sessionRoot,
      attachmentRoot,
      now: () => Date.parse('2026-08-24T00:00:00.000Z'),
    });

    expect(await service.initialize()).toBe(1);
    expect(purge).toHaveBeenCalledWith(expiredSession, revision);
    expect(repository.get('expired')).toBeNull();
    expect(repository.get('pinned')).toMatchObject({ taskId: 'pinned' });
  });

  it('refuses new runs at the persistent storage high watermark', async () => {
    const { repository, sessionRoot, attachmentRoot } = await fixture();
    await mkdir(sessionRoot, { recursive: true });
    await writeFile(join(sessionRoot, 'log.jsonl'), '1234567890');
    const harness = { revision: vi.fn(), purge: vi.fn() } as unknown as HarnessRuntime;
    const service = new HarnessRetentionService(repository, harness, {
      sessionRoot,
      attachmentRoot,
      sessionLimitBytes: 10,
      attachmentLimitBytes: 10,
      highWatermark: 0.9,
    });

    await service.initialize();
    expect(() => service.admitNewRun()).toThrow('above its admission watermark');
  });
});
