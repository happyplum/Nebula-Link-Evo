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
});
