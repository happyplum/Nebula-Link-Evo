import { generateText, jsonSchema, Output, stepCountIs } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import type { ResolvedConfig } from '../config/schema.js';
import type { ProviderRegistry } from '../services/provider/registry.js';
import type { GatewayTool } from '../tools/types.js';
import { gatewayToolsToVercelToolMap } from '../tools/adapters/vercel-ai.js';
import type { ToolRegistry } from '../tools/registry.js';
import { AgentTaskError, toAgentTaskError } from './errors.js';
import { BrowserToolWrapper } from './browser-tool-wrapper.js';
import type {
  AgentTaskExecutionContext,
  AgentTaskExecutionResult,
  AgentTaskToolCallSummary,
} from './types.js';
import { validateCreateAgentTaskRequest, validateResponseValue } from './validation.js';

interface GeneratedTaskText {
  output: unknown;
  finishReason: string;
  totalUsage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  steps: unknown[];
}

type AgentTextGenerator = (options: Record<string, unknown>) => Promise<GeneratedTaskText>;

export interface AgentTaskModelExecutorOptions {
  config: ResolvedConfig;
  providerRegistry: ProviderRegistry;
  toolRegistry: ToolRegistry;
  mcpClient?: Pick<MCPSDKClient, 'callTool'>;
  generate?: AgentTextGenerator;
}

export class AgentTaskModelExecutor {
  private readonly generate: AgentTextGenerator;

  constructor(private readonly options: AgentTaskModelExecutorOptions) {
    this.generate = options.generate ?? (generateText as unknown as AgentTextGenerator);
  }

  async execute(context: AgentTaskExecutionContext): Promise<AgentTaskExecutionResult> {
    const validated = validateCreateAgentTaskRequest(context.request);
    const request = validated.request;
    const model = await this.resolveDecisionModel();
    const summaries: AgentTaskToolCallSummary[] = [];
    let toolCallCount = 0;
    const consumeToolCall = () => {
      if (toolCallCount >= request.budgets.maxToolCalls) {
        throw new AgentTaskError('budget_exceeded', 'Agent task tool-call budget was exceeded');
      }
      toolCallCount += 1;
    };
    const tools = this.buildTools(context, validated.browserSteps, summaries, consumeToolCall);
    const schema = request.responseSchema;
    const outputSchema = jsonSchema(schema, {
      validate: (value) => {
        try {
          validateResponseValue(schema, value);
          return { success: true as const, value };
        } catch (error) {
          return {
            success: false as const,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      },
    });

    try {
      const result = await this.generate({
        model,
        system: [
          '你是单次、受限的测试分析执行代理。只完成输入指定的职责，不扩展场景。',
          '只能使用提供的工具；不要推断或索要浏览器 session、tab、lease、token、operationId。',
          '若发现意外登出、前置条件缺失或需要主代理决策，应在结构化结果中如实报告，不要自行恢复。',
          '视觉工具只用于一次分析，不得把它当作连续任务代理。',
        ].join('\n'),
        prompt: JSON.stringify(request.input),
        tools,
        stopWhen: stepCountIs(request.budgets.maxModelTurns),
        maxRetries: 0,
        maxOutputTokens: request.budgets.maxTokens ?? this.options.config.settings.maxTokens,
        temperature: this.options.config.settings.temperature,
        abortSignal: context.signal,
        output: Output.object({ schema: outputSchema }),
      });

      validateResponseValue(schema, result.output);
      const inputTokens = result.totalUsage.inputTokens ?? 0;
      const outputTokens = result.totalUsage.outputTokens ?? 0;
      const totalTokens = result.totalUsage.totalTokens ?? inputTokens + outputTokens;
      if (request.budgets.maxTokens !== undefined && totalTokens > request.budgets.maxTokens) {
        throw new AgentTaskError('budget_exceeded', 'Agent task token budget was exceeded');
      }
      return {
        output: result.output,
        terminationReason: result.finishReason,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
          modelTurns: result.steps.length,
          toolCalls: toolCallCount,
        },
        toolCalls: summaries,
      };
    } catch (error) {
      throw toAgentTaskError(error).withExecutionTrace({ toolCalls: [...summaries] });
    }
  }

  private async resolveDecisionModel(): Promise<LanguageModelV3> {
    const { provider, model } = this.options.config.defaults.decision;
    if (
      !this.options.config.providers[provider]?.enabled ||
      !this.options.providerRegistry.isAvailable(provider)
    ) {
      throw new AgentTaskError(
        'dependency_unavailable',
        `Decision provider '${provider}' is unavailable`,
        true
      );
    }
    try {
      return await this.options.providerRegistry.resolve(provider, model);
    } catch (error) {
      throw new AgentTaskError(
        'dependency_unavailable',
        `Decision model '${provider}/${model}' is unavailable`,
        true,
        undefined,
        { cause: error }
      );
    }
  }

  private buildTools(
    context: AgentTaskExecutionContext,
    browserSteps: ReadonlyMap<string, import('./types.js').AgentTaskBrowserStep>,
    summaries: AgentTaskToolCallSummary[],
    consumeToolCall: () => void
  ): Record<string, unknown> {
    const requested = new Set(context.request.toolPolicy.allow);
    const selected: GatewayTool[] = [];
    const available = new Map(
      this.options.toolRegistry
        .getAvailableTools({ consumer: 'chat' })
        .map((tool) => [tool.name, tool])
    );
    for (const name of requested) {
      if (name === 'browser-control.operation_execute') continue;
      const tool = available.get(name);
      if (!tool)
        throw new AgentTaskError(
          'dependency_unavailable',
          `Allowed tool '${name}' is unavailable`,
          true
        );
      selected.push({
        ...tool,
        execute: async (args, executionContext) => {
          consumeToolCall();
          const toolCallId = executionContext?.toolCallId ?? 'unknown';
          const summary: AgentTaskToolCallSummary = {
            toolCallId,
            toolName: name,
            status: 'failed',
          };
          summaries.push(summary);
          try {
            const output = await tool.execute(args, executionContext);
            summary.status = 'succeeded';
            return output;
          } catch (error) {
            summary.errorCode =
              error instanceof AgentTaskError ? error.code : 'tool_execution_failed';
            throw error;
          }
        },
      });
    }
    if (requested.has('browser-control.operation_execute')) {
      if (!context.request.browserBinding || !this.options.mcpClient) {
        throw new AgentTaskError(
          'dependency_unavailable',
          'Controlled browser execution is unavailable',
          true
        );
      }
      const wrapper = new BrowserToolWrapper({
        taskId: context.taskId,
        binding: context.request.browserBinding,
        steps: browserSteps,
        deadlineAt: context.deadlineAt,
        maxToolCalls: context.request.budgets.maxToolCalls,
        consumeToolCall,
        mcpClient: this.options.mcpClient,
      });
      selected.push(wrapper.createTool());
      summaries.push(...wrapper.summaries);
      const browserTool = selected[selected.length - 1];
      if (!browserTool) {
        throw new AgentTaskError('execution_failed', 'Browser tool wrapper initialization failed');
      }
      const originalExecute = browserTool.execute;
      selected[selected.length - 1] = {
        ...browserTool,
        execute: async (args, executionContext) => {
          try {
            return await originalExecute(args, executionContext);
          } finally {
            summaries.splice(summaries.length, 0, ...wrapper.summaries.splice(0));
          }
        },
      };
    }
    return gatewayToolsToVercelToolMap(selected, { swallowErrors: false });
  }
}
