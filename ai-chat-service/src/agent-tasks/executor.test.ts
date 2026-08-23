import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { ToolRegistry } from '../tools/registry.js';
import { createHarnessRuntime } from '../harness/runtime.js';
import type { HarnessRuntime } from '../harness/types.js';
import { AgentTaskModelExecutor } from './executor.js';
import type { AgentTaskExecutionContext, CreateAgentTaskRequest } from './types.js';

const config = {
  version: '2.0',
  providers: { test: { enabled: true, apiKey: 'unused', models: {} } },
  defaults: { mode: 'unified', decision: { provider: 'test', model: 'decision' } },
  settings: {
    timeout: 30_000,
    maxRetries: 3,
    temperature: 0.1,
    maxTokens: 2_000,
    maxSteps: 5,
    contextWindowTokens: 10_000,
  },
  mcp: { enabled: false, servers: {} },
} as const;

class SubmitAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];

  override providerInfo(provider: string) {
    return { id: provider, name: provider };
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    const id = CallId('submit-call-1');
    const args = JSON.stringify({ result: { status: 'ok' } });
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id, name: 'submit_result', argumentsDelta: args };
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name: 'submit_result', arguments: args },
    };
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function request(): CreateAgentTaskRequest {
  return {
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId: 'client-1',
    modelRole: 'decision',
    input: { objective: '判断页面状态' },
    responseSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['ok', 'blocked'] } },
      required: ['status'],
      additionalProperties: false,
    },
    toolPolicy: { allow: [] },
    skillPolicy: { allow: [] },
    budgets: { maxDurationMs: 10_000, maxModelTurns: 2, maxToolCalls: 0, maxTokens: 100 },
  };
}

describe('AgentTaskModelExecutor', () => {
  it('uses the shared DSH loop and commits only a durable submit_result', async () => {
    const fixture = await runtimeFixture();
    const persisted = vi.fn();
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      harness: fixture.runtime,
      toolRegistry: new ToolRegistry(),
    });
    try {
      const result = await executor.execute(executionContext(request(), persisted));
      expect(result).toMatchObject({
        output: { status: 'ok' },
        usage: { inputTokens: 10, outputTokens: 5, modelTurns: 1, toolCalls: 0 },
        harness: {
          resultCallId: 'submit-call-1',
          durableSeq: expect.any(Number),
          durableRevision: expect.any(String),
        },
      });
      expect(persisted).toHaveBeenCalledWith(
        'submit-call-1',
        expect.stringMatching(/^[a-f0-9]{64}$/),
        { status: 'ok' }
      );
      expect(result.harness?.events.at(-1)?.type).toBe('turn/end');
    } finally {
      await fixture.runtime.dispose();
    }
  }, 20_000);

  it('rejects tools outside the available registry before opening a session', async () => {
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      harness: {} as HarnessRuntime,
      toolRegistry: new ToolRegistry(),
    });
    const taskRequest = request();
    taskRequest.toolPolicy.allow = ['vision.missing'];
    await expect(executor.execute(executionContext(taskRequest))).rejects.toThrow(
      "Allowed tool 'vision.missing' is unavailable"
    );
  });

  it('injects one pinned Skill with narrowed request limits and lifecycle events', async () => {
    const fixture = await runtimeFixture();
    const emitEvent = vi.fn();
    const taskRequest = request();
    taskRequest.skillPolicy.allow = [
      {
        skillId: 'document.requirements_extract',
        version: '1.0.0',
        contentHash: 'a'.repeat(64),
      },
    ];
    const context = executionContext(taskRequest, vi.fn(), emitEvent);
    context.skill = {
      skillId: 'document.requirements_extract',
      version: '1.0.0',
      contentHash: 'a'.repeat(64),
      description: '提取需求',
      instructions: '只返回输入明确支持的结论。',
      requiredToolPatterns: [],
      effectiveToolAllow: [],
      effectiveBudgets: { maxModelTurns: 1, maxToolCalls: 0, maxTokens: 50 },
      policySha256: 'b'.repeat(64),
    };
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      harness: fixture.runtime,
      toolRegistry: new ToolRegistry(),
    });
    try {
      await executor.execute(context);
      expect(fixture.adapter.requests[0]).toMatchObject({ maxTokens: 50 });
      expect(fixture.adapter.requests[0]?.system).toContain('只返回输入明确支持的结论');
      expect(emitEvent.mock.calls.map(([type]) => type)).toEqual(
        expect.arrayContaining([
          'agent_task.skill_loaded',
          'agent_task.skill_execute',
          'agent_task.skill_result',
        ])
      );
    } finally {
      await fixture.runtime.dispose();
    }
  }, 20_000);

  it('emits a structured Skill failure without persisting instruction content', async () => {
    const fixture = await runtimeFixture();
    const emitEvent = vi.fn();
    const context = executionContext(request(), vi.fn(), emitEvent);
    context.skill = {
      skillId: 'test.failure_classify',
      version: '1.0.0',
      contentHash: 'a'.repeat(64),
      description: '分类失败',
      instructions: '不要写入事件的固定指令正文。',
      requiredToolPatterns: [],
      effectiveToolAllow: [],
      effectiveBudgets: { maxModelTurns: 1, maxToolCalls: 0, maxTokens: 1 },
      policySha256: 'b'.repeat(64),
    };
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      harness: fixture.runtime,
      toolRegistry: new ToolRegistry(),
    });
    try {
      await expect(executor.execute(context)).rejects.toThrow(/token budget/);
      const failure = emitEvent.mock.calls.find(([type]) => type === 'agent_task.skill_failure');
      expect(failure?.[1]).toMatchObject({
        skillId: 'test.failure_classify',
        version: '1.0.0',
        errorCode: 'budget_exceeded',
      });
      expect(JSON.stringify(emitEvent.mock.calls)).not.toContain('不要写入事件的固定指令正文');
    } finally {
      await fixture.runtime.dispose();
    }
  }, 20_000);
});

function executionContext(
  taskRequest: CreateAgentTaskRequest,
  persistPendingResult = vi.fn(),
  emitEvent = vi.fn()
): AgentTaskExecutionContext {
  return {
    taskId: 'task-1',
    request: taskRequest,
    deadlineAt: Date.now() + 10_000,
    signal: new AbortController().signal,
    harnessProjectedSeq: 0,
    beforeToolCall: vi.fn(),
    emitEvent,
    persistPendingResult,
  };
}

async function runtimeFixture(): Promise<{
  runtime: HarnessRuntime;
  adapter: SubmitAdapter;
}> {
  const root = await mkdtemp(join(tmpdir(), 'nebula-task-executor-'));
  roots.push(root);
  const adapter = new SubmitAdapter();
  const runtime = await createHarnessRuntime({
    sessionRoot: join(root, 'sessions'),
    attachmentRoot: join(root, 'attachments'),
    persona: 'test',
    maxParallelToolCalls: 4,
    piAi: { providers: {} },
    decision: { provider: 'test', model: 'decision' },
    mcp: [],
    configure(ctx) {
      ctx.llm.registerAdapter(['test'], adapter);
    },
  });
  return { runtime, adapter };
}
