import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../tools/registry.js';
import { AgentTaskModelExecutor } from './executor.js';
import type { CreateAgentTaskRequest } from './types.js';

const config = {
  version: '2.0',
  providers: { test: { enabled: true, apiKey: 'secret', models: {} } },
  defaults: { mode: 'unified', decision: { provider: 'test', model: 'decision' } },
  settings: {
    timeout: 30_000,
    maxRetries: 0,
    temperature: 0.1,
    maxTokens: 2_000,
    maxSteps: 5,
    contextWindowTokens: 10_000,
  },
  mcp: { enabled: false, servers: {} },
} as const;

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
  it('uses the configured decision model and returns validated structured output', async () => {
    const generate = vi.fn(async (options: Record<string, unknown>) => ({
      output: { status: 'ok' },
      finishReason: 'stop',
      totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      steps: [{}],
      received: options,
    }));
    const resolve = vi.fn(async () => ({ specificationVersion: 'v3' }));
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      providerRegistry: { isAvailable: () => true, resolve } as never,
      toolRegistry: new ToolRegistry(),
      generate,
    });

    const result = await executor.execute({
      taskId: 'task-1',
      request: request(),
      deadlineAt: Date.now() + 10_000,
      signal: new AbortController().signal,
      beforeToolCall: vi.fn(),
      emitEvent: vi.fn(),
    });

    expect(resolve).toHaveBeenCalledWith('test', 'decision');
    expect(result).toMatchObject({
      output: { status: 'ok' },
      usage: { modelTurns: 1, toolCalls: 0 },
    });
    expect(JSON.stringify(generate.mock.calls[0]![0])).not.toContain('browserLeaseToken');
  });

  it('rejects tools outside the available registry', async () => {
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      providerRegistry: { isAvailable: () => true, resolve: async () => ({}) } as never,
      toolRegistry: new ToolRegistry(),
      generate: vi.fn(),
    });
    const taskRequest = request();
    taskRequest.toolPolicy.allow = ['vision.missing'];

    await expect(
      executor.execute({
        taskId: 'task-1',
        request: taskRequest,
        deadlineAt: Date.now() + 10_000,
        signal: new AbortController().signal,
        beforeToolCall: vi.fn(),
        emitEvent: vi.fn(),
      })
    ).rejects.toThrow("Allowed tool 'vision.missing' is unavailable");
  });

  it('injects one pinned Skill with narrowed budgets and auditable lifecycle events', async () => {
    const generate = vi.fn(async () => ({
      output: { status: 'ok' },
      finishReason: 'stop',
      totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      steps: [{}],
    }));
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      providerRegistry: { isAvailable: () => true, resolve: async () => ({}) } as never,
      toolRegistry: new ToolRegistry(),
      generate,
    });
    const emitEvent = vi.fn();
    const taskRequest = request();
    taskRequest.skillPolicy.allow = [
      {
        skillId: 'document.requirements_extract',
        version: '1.0.0',
        contentHash: 'a'.repeat(64),
      },
    ];

    await executor.execute({
      taskId: 'task-skill-1',
      request: taskRequest,
      deadlineAt: Date.now() + 10_000,
      signal: new AbortController().signal,
      skill: {
        skillId: 'document.requirements_extract',
        version: '1.0.0',
        contentHash: 'a'.repeat(64),
        description: '提取需求',
        instructions: '只返回输入明确支持的结论。',
        requiredToolPatterns: [],
        effectiveToolAllow: [],
        effectiveBudgets: { maxModelTurns: 1, maxToolCalls: 0, maxTokens: 50 },
        policySha256: 'b'.repeat(64),
      },
      beforeToolCall: vi.fn(),
      emitEvent,
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 50,
        tools: {},
        system: expect.stringContaining('只返回输入明确支持的结论'),
      })
    );
    expect(emitEvent.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining([
        'agent_task.skill_loaded',
        'agent_task.skill_execute',
        'agent_task.skill_result',
      ])
    );
  });

  it('emits a structured Skill failure without persisting instruction content', async () => {
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      providerRegistry: { isAvailable: () => true, resolve: async () => ({}) } as never,
      toolRegistry: new ToolRegistry(),
      generate: async () => {
        throw new Error('provider failed');
      },
    });
    const emitEvent = vi.fn();
    await expect(
      executor.execute({
        taskId: 'task-skill-failure',
        request: request(),
        deadlineAt: Date.now() + 10_000,
        signal: new AbortController().signal,
        skill: {
          skillId: 'test.failure_classify',
          version: '1.0.0',
          contentHash: 'a'.repeat(64),
          description: '分类失败',
          instructions: '不要写入事件的固定指令正文。',
          requiredToolPatterns: [],
          effectiveToolAllow: [],
          effectiveBudgets: { maxModelTurns: 1, maxToolCalls: 0 },
          policySha256: 'b'.repeat(64),
        },
        beforeToolCall: vi.fn(),
        emitEvent,
      })
    ).rejects.toThrow();

    const failure = emitEvent.mock.calls.find(([type]) => type === 'agent_task.skill_failure');
    expect(failure?.[1]).toMatchObject({
      skillId: 'test.failure_classify',
      version: '1.0.0',
      errorCode: expect.any(String),
    });
    expect(JSON.stringify(emitEvent.mock.calls)).not.toContain('不要写入事件的固定指令正文');
  });
});
