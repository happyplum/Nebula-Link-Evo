import { ConversationManager } from './manager.js';
import { DebugWebSocketManager } from '../websocket-manager.js';
import { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import type { ResolvedConfig } from '../config/schema.js';
import { ChatSessionController } from '../services/chat-session-controller.js';
import type { AgentState, Session, Message, SessionStatus } from './types.js';
import type { SessionEvent, SessionEventType } from '../../../shared/types/sse-events.js';
import { SessionEventsDAO } from './session-events-dao.js';
import { DatabaseManager } from './db.js';
import { SessionEventHub } from '../services/session-event-hub.js';
import { streamText, stepCountIs, tool } from 'ai';
import type { ModelMessage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { z } from 'zod';
import { getModel } from '../clients/vercel-ai/provider.js';
import WebSocket from 'ws';

interface ChatSendParams {
  sessionId: string;
  message: string;
  screenshot?: string;
  skipAddMessage?: boolean;
}

type ChatSessionData = Session;

interface ChatMessageData {
  sessionId: string;
  message: string;
  screenshot?: string;
}

interface ToolInputSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

interface MCPObjectSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

type TerminalReason = 'stop' | 'max_steps_reached' | 'tool_error' | 'abort' | 'pause';

class ChatHandler {
  private conversationManager: ConversationManager;
  private config: ResolvedConfig;
  private wsManager: DebugWebSocketManager;
  private mcpClient: MCPSDKClient | null = null;
  private sessionEventsDAO?: SessionEventsDAO;
  private sessionEventHub: SessionEventHub;
  private maxToolLoops = 10;
  private toolLoopCount = 0;
  private sessionEventQueue: Promise<void> = Promise.resolve();

  constructor(
    conversationManager: ConversationManager,
    config: ResolvedConfig,
    wsManager: DebugWebSocketManager,
    mcpClient?: MCPSDKClient,
    sessionEventsDAO?: SessionEventsDAO,
    sessionEventHub?: SessionEventHub
  ) {
    this.conversationManager = conversationManager;
    this.config = config;
    this.wsManager = wsManager;
    this.mcpClient = mcpClient || null;
    this.sessionEventsDAO = sessionEventsDAO || this.resolveSessionEventsDAO();
    this.sessionEventHub = sessionEventHub || SessionEventHub.getInstance();
    const configuredMaxSteps =
      this.config._resolved?.settings?.maxSteps ?? this.config.settings?.maxSteps ?? this.maxToolLoops;
    this.maxToolLoops = configuredMaxSteps > 0 ? configuredMaxSteps : this.maxToolLoops;
  }

  private resolveSessionEventsDAO(): SessionEventsDAO | undefined {
    try {
      return DatabaseManager.getInstance().getSessionEventsDAO();
    } catch {
      return undefined;
    }
  }

  private stringifyToolResult(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }

    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  private emitSessionEvent(
    sessionId: string,
    type: SessionEventType,
    payload: Record<string, unknown>
  ): Promise<void> {
    const eventData: SessionEvent = {
      type,
      ...payload,
    } as SessionEvent;

    this.sessionEventQueue = this.sessionEventQueue.then(async () => {
      try {
        let seq: number | undefined;
        // Persist to database if DAO is available
        if (this.sessionEventsDAO) {
          seq = await this.sessionEventsDAO.appendEvent(sessionId, type, payload);
        }
        // Always publish to hub for live SSE streaming (even without persistence)
        this.sessionEventHub.publish(sessionId, seq === undefined ? eventData : { ...eventData, seq });
      } catch (error) {
        console.warn(
          `[ChatHandler] Failed to emit session event ${type} for session ${sessionId}:`,
          error
        );
      }
    });

    return this.sessionEventQueue;
  }

  private async flushSessionEvents(): Promise<void> {
    await this.sessionEventQueue;
  }

  getSessionEventsDAO(): SessionEventsDAO | undefined {
    return this.sessionEventsDAO;
  }

  getSessionEventHub(): SessionEventHub {
    return this.sessionEventHub;
  }

  private getDecisionClient(provider: string, model: string): LanguageModelV3 {
    return getModel(this.config, provider, model);
  }

  setMCPClient(client: MCPSDKClient): void {
    this.mcpClient = client;
  }

  private clearBlockingAgentState(agentState?: AgentState): AgentState | undefined {
    if (!agentState) {
      return undefined;
    }

    const resumeAgentState = { ...agentState };
    delete resumeAgentState.blockReason;
    delete resumeAgentState.waitingFor;
    return Object.keys(resumeAgentState).length > 0 ? resumeAgentState : undefined;
  }

  private getSystemPrompt(_session: ChatSessionData): string {
    let basePrompt = `你是一个智能助手，可以通过MCP工具与浏览器交互。

## 工作模式
当用户询问页面相关问题时，你应该：
1. 首先调用 browser-control.browser_snapshot 获取当前页面快照
2. 分析页面信息后回答用户问题
3. 如果需要执行操作，调用相应的MCP工具

## 可用操作
- 获取页面信息：调用 browser-control.browser_snapshot
- 点击元素：调用 browser-control.browser_click
- 输入文本：调用 browser-control.browser_type
- 导航页面：调用 browser-control.browser_navigate
- 截图：调用 browser-control.browser_take_screenshot

## 响应格式
当需要调用工具时，使用以下JSON格式：
\`\`\`json
{
  "type": "mcp_call",
  "params": {
    "server": "browser-control",
    "tool": "browser_snapshot",
    "args": {}
  },
  "reasoning": "获取当前页面信息"
}
\`\`\`

任务完成时使用：
\`\`\`json
{
  "type": "finish",
  "params": { "result": "结果描述" },
  "reasoning": "任务完成原因"
}
\`\`\``;

    if (this.mcpClient && this.mcpClient.isEnabled()) {
      const tools = this.mcpClient.getAvailableTools();
      if (tools.length > 0) {
        const toolsDescription = tools
          .map((tool) => {
            const schema = tool.inputSchema as ToolInputSchema;
            const props = schema?.properties || {};
            const params =
              Object.keys(props).length > 0 ? `参数: ${Object.keys(props).join(', ')}` : '无参数';
            return `- ${tool.name}: ${tool.description} (${params})`;
          })
          .join('\n');
        basePrompt += `\n\n## 可用的MCP工具 (${tools.length}个)\n${toolsDescription}`;
      }
    }

    return basePrompt;
  }

  async handleChatSend(clientId: string, params: ChatSendParams): Promise<void> {
    const { sessionId, message, screenshot, skipAddMessage } = params;

    const session = this.conversationManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    console.log(`[ChatHandler] handleChatSend, screenshot length: ${screenshot?.length || 0}`);

    if (!skipAddMessage) {
      this.conversationManager.addMessage(sessionId, {
        role: 'user',
        content: message,
      });
    }

    this.toolLoopCount = 0;

    const sessionController = ChatSessionController.getInstance();
    const abortController = sessionController.createAbortController(sessionId);

    try {
      await this.executeAIResponse(
        clientId,
        sessionId,
        session,
        0,
        screenshot,
        abortController.signal
      );
    } finally {
      sessionController.cleanup(sessionId);
    }
  }

  async handleMessage(data: ChatMessageData, ws: WebSocket): Promise<void> {
    const { sessionId, message, screenshot } = data;
    if (!sessionId || !message) {
      throw new Error('sessionId and message are required');
    }

    const client = Array.from(this.wsManager['clients']).find(([_, client]) => client === ws);
    if (!client) {
      throw new Error('WebSocket client not found');
    }
    const clientId = client[0];

    await this.handleChatSend(clientId, { sessionId, message, screenshot });
  }

  async resumeSession(clientId: string, sessionId: string): Promise<void> {
    const session = this.conversationManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const persistedState = await this.conversationManager.getSessionState(sessionId);
    const currentStatus = persistedState?.status ?? 'idle';
    if (!this.isResumable(currentStatus)) {
      throw new Error(
        `Cannot resume session ${sessionId}: status "${currentStatus}" is not resumable. Allowed statuses: paused, completed, cancelled, blocked, interrupted.`
      );
    }

    const sessionController = ChatSessionController.getInstance();
    if (currentStatus === 'paused' || currentStatus === 'blocked') {
      sessionController.resume(sessionId, currentStatus);
    }

    const abortController = sessionController.createAbortController(sessionId, {
      activateSession: false,
    });

    await this.conversationManager.updateSessionStatus(
      sessionId,
      'running',
      this.clearBlockingAgentState(persistedState?.agentState)
    );

    try {
      await this.executeAIResponse(
        clientId,
        sessionId,
        session,
        0,
        undefined,
        abortController.signal
      );
    } finally {
      sessionController.cleanup(sessionId);
    }
  }

  private async executeAIResponse(
    _clientId: string,
    sessionId: string,
    session: ChatSessionData,
    iteration: number = 0,
    screenshot?: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) {
      console.log(`[ChatHandler] Execution aborted for session ${sessionId}`);
      return;
    }

    this.toolLoopCount = iteration;
    const runId = this.createRunId();
    const messageId = this.createMessageId();
    let accumulatedContent = '';
    let totalUsage: Record<string, unknown> | undefined;
    const emittedToolCalls: Array<Record<string, unknown>> = [];
    let streamError: unknown;
    let pauseRequested = false;
    let stepHadToolResult = false;
    let finishReason: string | undefined;

    await this.emitSessionEvent(sessionId, 'assistant.started', {
      sessionId,
      runId,
      messageId,
    });

    const contextWindow = this.conversationManager.getContextWindow(sessionId);
    const messages = this.toModelMessages(contextWindow.messages);
    const systemPrompt = this.getSystemPrompt(session);
    const sessionController = ChatSessionController.getInstance();

    const maxSteps = this.maxToolLoops;
    const streamOptions: Parameters<typeof streamText>[0] & { maxSteps: number } = {
      model: this.getDecisionClient(session.provider, session.model),
      system: systemPrompt,
      messages,
      tools: this.createSDKTools() as Parameters<typeof streamText>[0]['tools'],
      abortSignal: signal,
      maxSteps,
      stopWhen: stepCountIs(maxSteps),
    };

    console.log(
      `[ChatHandler] executeAIResponse, screenshot param length: ${screenshot?.length || 0}`
    );

    try {
      console.log(`[ChatHandler] Using SDK model: ${session.provider}/${session.model}`);
      const result = await streamText(streamOptions);

      for await (const streamPart of result.fullStream) {
        const part = streamPart as { type: string; [key: string]: unknown };

        if (part.type === 'text-delta' && typeof part.text === 'string') {
          accumulatedContent += part.text;
          await this.emitSessionEvent(sessionId, 'assistant.delta', {
            sessionId,
            runId,
            messageId,
            text: part.text,
          });
          continue;
        }

        if (
          (part.type === 'reasoning' || part.type === 'reasoning-delta') &&
          typeof part.text === 'string'
        ) {
          await this.emitSessionEvent(sessionId, 'assistant.thinking', {
            sessionId,
            runId,
            messageId,
            text: part.text,
          });
          continue;
        }

        if (part.type === 'tool-call') {
          const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
          const toolName = typeof part.toolName === 'string' ? part.toolName : 'unknown.tool';
          const toolInput = this.normalizeToRecord(part.input);
          const toolCall = {
            id: toolCallId,
            type: 'function',
            function: {
              name: toolName,
              arguments: JSON.stringify(toolInput),
            },
            input: toolInput,
          };
          emittedToolCalls.push(toolCall);

          await this.emitSessionEvent(sessionId, 'assistant.tool_call', {
            sessionId,
            runId,
            messageId,
            toolCallId,
            toolCall,
          });
          continue;
        }

        if (part.type === 'tool-result') {
          stepHadToolResult = true;
          const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
          const toolName = typeof part.toolName === 'string' ? part.toolName : 'unknown.tool';
          const toolInput = this.normalizeToRecord(part.input);
          const output = part.output;

          this.conversationManager.addMessage(sessionId, {
            role: 'tool',
            content: this.stringifyToolResult(output),
            metadata: {
              tool_call_id: toolCallId,
              tool_name: toolName,
              tool_args: toolInput,
              runId,
            },
          });

          await this.emitSessionEvent(sessionId, 'assistant.tool_result', {
            sessionId,
            runId,
            messageId,
            toolCallId,
            result: this.stringifyToolResult(output),
          });
          continue;
        }

        if (part.type === 'finish-step') {
          await this.flushSessionEvents();

          if (sessionController.shouldPause(sessionId, 'afterGeneration')) {
            sessionController.markAsPaused(sessionId);
            pauseRequested = true;
            break;
          }

          if (stepHadToolResult && sessionController.shouldPause(sessionId, 'afterExecution')) {
            sessionController.markAsPaused(sessionId);
            pauseRequested = true;
            break;
          }

          stepHadToolResult = false;
          continue;
        }

        if (part.type === 'finish') {
          finishReason = typeof part.finishReason === 'string' ? part.finishReason : undefined;
          totalUsage = this.normalizeToRecord(part.totalUsage);
          continue;
        }

        if (part.type === 'error') {
          streamError = part.error;
          break;
        }

        if (part.type === 'abort') {
          console.log(`[ChatHandler] Stream aborted for session ${sessionId}`);
          return;
        }
      }

      if (streamError) {
        throw streamError;
      }

      if (signal?.aborted) {
        console.log(`[ChatHandler] Execution aborted for session ${sessionId}`);
        return;
      }

      this.conversationManager.addMessage(sessionId, {
        role: 'assistant',
        content: accumulatedContent,
        metadata: {
          usage: totalUsage,
          provider: session.provider,
          model: session.model,
          runId,
          tool_calls: emittedToolCalls.length > 0 ? emittedToolCalls : undefined,
        },
      });

      const terminalReason: TerminalReason = pauseRequested
        ? 'pause'
        : this.mapFinishReasonToTerminalReason(finishReason);

      await this.flushSessionEvents();
      await this.emitSessionEvent(sessionId, 'assistant.completed', {
        sessionId,
        runId,
        messageId,
        terminal_reason: terminalReason,
      });
      const completionStatus: SessionStatus = pauseRequested ? 'paused' : 'completed';
      const latestState = await this.conversationManager.getSessionState(sessionId);
      const nextAgentState = {
        ...(latestState?.agentState ?? { schema_version: 1 as const }),
        terminalReason,
      };
      await this.conversationManager.updateSessionStatus(sessionId, completionStatus, nextAgentState);
      this.sendSessionUpdate();

      if (pauseRequested) {
        return;
      }
    } catch (error) {
      if (signal?.aborted || this.isAbortLikeError(error)) {
        console.log(`[ChatHandler] Execution aborted for session ${sessionId}`);
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('[ChatHandler] Failed to stream AI response', {
        sessionId,
        provider: session.provider,
        model: session.model,
        iteration,
        error: errorMessage,
        stack: errorStack,
      });
      await this.flushSessionEvents();
      await this.emitSessionEvent(sessionId, 'run.error', {
        sessionId,
        runId,
        error: errorMessage,
      });
    }
  }

  private mapFinishReasonToTerminalReason(finishReason?: string): TerminalReason {
    if (finishReason === 'max-steps' || finishReason === 'tool-calls') {
      return 'max_steps_reached';
    }

    return 'stop';
  }

  private isResumable(status: SessionStatus): boolean {
    if (status === 'running' || status === 'idle') {
      return false;
    }

    return true;
  }

  private createMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private createRunId(): string {
    return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private toModelMessages(messages: Message[]): ModelMessage[] {
    const converted: ModelMessage[] = [];

    for (const message of messages) {
      if (message.role === 'system') {
        continue;
      }

      if (message.role === 'user' || message.role === 'assistant') {
        converted.push({
          role: message.role,
          content: message.content,
        });
        continue;
      }

      const toolName =
        message.metadata && typeof message.metadata.tool_name === 'string'
          ? message.metadata.tool_name
          : 'tool';
      converted.push({
        role: 'user',
        content: `工具调用结果 (${toolName}): ${message.content}`,
      });
    }

    return converted;
  }

  private createSDKTools(): Record<string, unknown> {
    const tools: Record<string, unknown> = {};

    if (!this.mcpClient || !this.mcpClient.isEnabled()) {
      return tools;
    }

    for (const mcpTool of this.mcpClient.getAvailableTools()) {
      const fullToolName = mcpTool.name;
      tools[fullToolName] = tool({
        description: mcpTool.description || fullToolName,
        inputSchema: this.buildInputSchema(mcpTool.inputSchema),
        execute: async (rawArgs: unknown) => {
          if (!this.mcpClient || !this.mcpClient.isEnabled()) {
            throw new Error('MCP is not enabled or not available');
          }

          const args = this.normalizeToRecord(rawArgs);
          const [serverName, actualToolName] = this.parseToolName(fullToolName);
          this.assertToolIsSafe(actualToolName);
          return await this.mcpClient.callTool(serverName, actualToolName, args);
        },
      });
    }

    return tools;
  }

  private buildInputSchema(schema: unknown): z.ZodTypeAny {
    const jsonSchema = schema as MCPObjectSchema;
    if (jsonSchema?.type !== 'object' || !jsonSchema.properties) {
      return z.object({}).passthrough();
    }

    const required = new Set(jsonSchema.required || []);
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, property] of Object.entries(jsonSchema.properties)) {
      const propertySchema = this.buildPropertySchema(property);
      shape[key] = required.has(key) ? propertySchema : propertySchema.optional();
    }

    return z.object(shape).passthrough();
  }

  private buildPropertySchema(property: unknown): z.ZodTypeAny {
    if (!property || typeof property !== 'object') {
      return z.unknown();
    }

    const definition = property as {
      type?: string;
      enum?: unknown[];
      items?: unknown;
    };

    if (Array.isArray(definition.enum) && definition.enum.every((value) => typeof value === 'string')) {
      const enumValues = definition.enum as string[];
      return z.string().refine((value) => enumValues.includes(value), {
        message: `Expected one of: ${enumValues.join(', ')}`,
      });
    }

    switch (definition.type) {
      case 'string':
        return z.string();
      case 'number':
      case 'integer':
        return z.number();
      case 'boolean':
        return z.boolean();
      case 'array':
        return z.array(this.buildPropertySchema(definition.items));
      case 'object':
        return z.record(z.string(), z.unknown());
      default:
        return z.unknown();
    }
  }

  private normalizeToRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private parseToolName(fullToolName: string): [serverName: string, toolName: string] {
    const [serverName, ...nameParts] = fullToolName.split('.');
    if (!serverName || nameParts.length === 0) {
      throw new Error(`Invalid tool name format: ${fullToolName}`);
    }

    return [serverName, nameParts.join('.')];
  }

  private assertToolIsSafe(toolName: string): void {
    const dangerousToolPatterns = ['delete', 'remove', 'destroy', 'drop', 'truncate'];
    const isDangerous = dangerousToolPatterns.some((pattern) =>
      toolName.toLowerCase().includes(pattern)
    );

    if (isDangerous) {
      throw new Error(`Dangerous tool "${toolName}" requires confirmation and is not allowed`);
    }
  }

  private isAbortLikeError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const abortError = error as {
      name?: unknown;
      code?: unknown;
      message?: unknown;
    };

    return (
      abortError.name === 'AbortError' ||
      abortError.code === 'ERR_CANCELED' ||
      abortError.message === 'canceled' ||
      abortError.message === 'interrupted'
    );
  }

  sendSessionUpdate(): void {
    const sessions = this.conversationManager.listSessions();
    this.wsManager.broadcast({
      type: 'chat_session_update',
      sessions,
      timestamp: new Date().toISOString(),
    });
  }
}

export { ChatHandler };
export type { ChatSendParams, ChatSessionData, ChatMessageData };
