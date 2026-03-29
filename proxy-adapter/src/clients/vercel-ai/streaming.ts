/**
 * Streaming Integration - Vercel AI SDK streamText with WebSocket event mapping
 */

import { streamText } from 'ai';
import type { ModelMessage } from 'ai';
import type { ActionExecutor } from '../../services/action-executor.js';
import type { TaskOrchestrator } from '../../services/task-orchestrator.js';
import type { ResolvedConfig } from '../../config/schema.js';
import { ProviderRegistry } from '../../services/provider/registry.js';
import type { ProviderConfig } from '../../services/provider/types.js';
import { getModel } from './provider.js';
import { createCoreTools } from './core-tools.js';
import { createLoadSkillTool } from './skills-tool.js';

/**
 * Options for streaming a task
 */
export interface StreamTaskOptions {
  /** Provider name (e.g., 'kimi', 'anthropic') */
  provider: string;
  /** Model name */
  model: string;
  /** Conversation messages */
  messages: ModelMessage[];
  /** Action executor for tool calls */
  executor: ActionExecutor;
  /** Task orchestrator for skill parameter substitution */
  taskOrchestrator: TaskOrchestrator;
  /** Resolved configuration for provider/model lookup */
  config: ResolvedConfig;
  /** Callback for streaming events */
  onEvent: (event: { type: string; [key: string]: unknown }) => void;
}

/**
 * Stream a task execution with AI SDK and WebSocket event mapping
 */
export async function streamTask(options: StreamTaskOptions): Promise<void> {
  const { provider, model, messages, executor, taskOrchestrator, config, onEvent } = options;

  try {
    // Get the AI model
    const providers: Record<string, ProviderConfig> = {};
    for (const [key, providerConfig] of Object.entries(config._resolved.providers)) {
      if (!providerConfig.enabled) {
        continue;
      }

      providers[key] = {
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl || undefined,
        npmPackage: providerConfig.npmPackage,
      };
    }

    const registry = new ProviderRegistry(providers);
    const aiModel = await getModel(registry, provider, model);

    // Create tools
    const coreTools = createCoreTools(executor);
    const loadSkillTool = createLoadSkillTool(executor, taskOrchestrator);

    const tools = {
      ...coreTools,
      loadSkill: loadSkillTool,
    };

    // Start streaming
    const result = await streamText({
      model: aiModel,
      messages,
      tools,
    });

    // Process stream parts and emit events
    for await (const part of result.fullStream) {
      try {
        switch (part.type) {
          case 'text-delta': {
            onEvent({
              type: 'chat_stream_token',
              text: part.text,
            });
            break;
          }

          case 'tool-call': {
            onEvent({
              type: 'chat_stream_tool_call',
              name: part.toolName,
              input: part.input,
            });
            break;
          }

          case 'tool-result': {
            onEvent({
              type: 'chat_stream_tool_result',
              name: part.toolName,
              output: part.output,
            });
            break;
          }

          case 'finish': {
            onEvent({
              type: 'chat_stream_end',
              usage: part.totalUsage,
            });
            break;
          }

          case 'error': {
            onEvent({
              type: 'chat_stream_error',
              error: part.error,
            });
            break;
          }

          default: {
            // Handle unknown part types gracefully
            console.warn('Unknown stream part type:', (part as { type: string }).type);
          }
        }
      } catch (streamError) {
        // Handle errors in event processing
        const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
        onEvent({
          type: 'chat_stream_error',
          error: `Stream processing error: ${errorMessage}`,
        });
      }
    }
  } catch (error) {
    // Handle setup/initialization errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Stream task error:', errorMessage);
    onEvent({
      type: 'chat_stream_error',
      error: `Failed to start stream: ${errorMessage}`,
    });
    throw error; // Re-throw for caller to handle
  }
}
