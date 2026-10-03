import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { ToolRegistry } from '../tools/registry.js';
import { createHarnessRuntime } from '../harness/runtime.js';
import { installGatewayToolBridge } from '../harness/gateway-tool-bridge.js';
import type { HarnessRuntime } from '../harness/types.js';
import { validateCreateAgentTaskRequest } from './validation.js';
import * as validation from './validation.js';
import { AgentTaskModelExecutor } from './executor.js';
import type { AgentTaskError } from './errors.js';
import type { GatewayTool } from '../tools/types.js';
import type { CreateAgentTaskRequest } from '@nebula-link-evo/shared/types/agent-task';
import type { AgentTaskExecutionContext } from './types.js';

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

  constructor(private readonly callProductTool = false) {
    super();
  }

  override providerInfo(provider: string) {
    return { id: provider, name: provider };
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    const productCall = this.callProductTool && this.requests.length === 1;
    const name = productCall
      ? options.tools?.find((tool) => tool.name !== 'submit_result')?.name
      : 'submit_result';
    if (!name) throw new Error('Expected a model-visible product tool');
    const id = CallId(productCall ? 'product-call-1' : 'submit-call-1');
    const args = JSON.stringify(productCall ? {} : { result: { status: 'ok' } });
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args };
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name, arguments: args },
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
  it.each(['vision.analyze_page', 'vision..analyze---page/$', `vision.${'long_name_'.repeat(10)}`])(
    'matches the bridge model name for %s while authorizing and auditing the product name',
    async (name) => {
      const fixture = await runtimeFixture(true);
      const execute = vi.fn(async () => '{"ok":true}');
      const registry = productRegistry([name, 'vision.not_allowed'], execute);
      const bridge = installGatewayToolBridge(fixture.runtime.context, registry);
      const safeName = bridge.mappings().get(name);
      if (!safeName) throw new Error('Expected a bridge mapping for the product tool');
      const taskRequest = request();
      taskRequest.toolPolicy.allow = [name];
      taskRequest.budgets.maxToolCalls = 1;
      const context = executionContext(taskRequest);
      const executor = new AgentTaskModelExecutor({
        config: config as never,
        harness: fixture.runtime,
        toolRegistry: registry,
      });
      try {
        const result = await executor.execute(context);
        expect(safeName).toMatch(/^[A-Za-z0-9_]+$/);
        expect(safeName.length).toBeLessThanOrEqual(64);
        expect(fixture.adapter.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
          safeName,
          'submit_result',
        ]);
        expect(fixture.adapter.requests[0]?.system).toContain(
          `产品工具 ${name} 映射为 ${safeName}。`
        );
        expect(execute).toHaveBeenCalledExactlyOnceWith(
          {},
          {
            toolCallId: 'product-call-1',
            abortSignal: expect.any(AbortSignal),
          }
        );
        expect(result.toolCalls).toEqual([
          { toolCallId: 'product-call-1', toolName: name, status: 'succeeded' },
        ]);
        expect(context.beforeToolCall).toHaveBeenCalledOnce();
        expect(context.emitEvent).toHaveBeenCalledWith('agent_task.tool_call', {
          toolCallId: 'product-call-1',
          toolName: name,
        });
        expect(context.emitEvent).toHaveBeenCalledWith('agent_task.tool_result', {
          toolCallId: 'product-call-1',
          toolName: name,
          status: 'succeeded',
        });
      } finally {
        bridge.dispose();
        await fixture.runtime.dispose();
      }
    },
    20_000
  );

  it('preserves the AgentTaskError classification for normalized tool-name collisions', async () => {
    const fixture = await runtimeFixture();
    const names = ['vision.a-b', 'vision.a_b'];
    const taskRequest = request();
    taskRequest.toolPolicy.allow = names;
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      harness: fixture.runtime,
      toolRegistry: productRegistry(names),
    });
    try {
      await expect(executor.execute(executionContext(taskRequest))).rejects.toMatchObject({
        name: 'AgentTaskError',
        code: 'dependency_unavailable',
        message: 'Tool name collision for vision.a_b',
        retryable: false,
      } satisfies Partial<AgentTaskError>);
      expect(fixture.adapter.requests).toHaveLength(0);
    } finally {
      await fixture.runtime.dispose();
    }
  }, 20_000);

  it('uses the shared DSH loop and commits only a durable submit_result', async () => {
    const fixture = await runtimeFixture();
    const persisted = vi.fn();
    const executor = new AgentTaskModelExecutor({
      config: config as never,
      harness: fixture.runtime,
      toolRegistry: new ToolRegistry(),
    });
    try {
      const context = executionContext(request(), persisted);
      const normalize = vi.spyOn(validation, 'validateCreateAgentTaskRequest');
      const result = await executor.execute(context);
      expect(normalize).not.toHaveBeenCalled();
      normalize.mockRestore();
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
    browserSteps: validateCreateAgentTaskRequest(taskRequest).browserSteps,
    deadlineAt: Date.now() + 10_000,
    signal: new AbortController().signal,
    harnessProjectedSeq: 0,
    beforeToolCall: vi.fn(),
    emitEvent,
    persistPendingResult,
  };
}

function productRegistry(
  names: string[],
  execute: GatewayTool['execute'] = async () => '{"ok":true}'
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerProvider({
    id: 'fixture',
    status: 'ready',
    initialize: async () => {},
    shutdown: async () => {},
    on: () => {},
    removeListener: () => {},
    getTools: () =>
      names.map((name) => ({
        id: name,
        name,
        description: 'test product tool',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        providerId: 'fixture',
        isAvailable: true,
        execute,
      })),
  });
  return registry;
}

async function runtimeFixture(callProductTool = false): Promise<{
  runtime: HarnessRuntime;
  adapter: SubmitAdapter;
}> {
  const temporaryRoot = fileURLToPath(new URL('../../../.tmp/', import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(join(temporaryRoot, 'nebula-task-executor-'));
  roots.push(root);
  const adapter = new SubmitAdapter(callProductTool);
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
