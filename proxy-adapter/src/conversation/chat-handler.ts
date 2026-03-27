import { ConversationManager } from './manager.js';
import type { DecisionClient } from '../clients/decision/base.js';
import type { StreamCallbacks, ToolCall, UsageStats } from '../clients/decision/stream.js';
import { DebugWebSocketManager } from '../websocket-manager.js';
import { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import { createDecisionClientFactory, DecisionClientFactory } from '../clients/decision/index.js';
import type { ResolvedConfig } from '../config/schema.js';
import { ChatSessionController } from '../services/chat-session-controller.js';
import type { AgentState, Session, Message } from './types.js';
import type { DecisionContext } from '../clients/types.js';
import type { SessionEvent, SessionEventType } from '../../../shared/types/sse-events.js';
import { SessionEventsDAO } from './session-events-dao.js';
import { DatabaseManager } from './db.js';
import { SessionEventHub } from '../services/session-event-hub.js';
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

interface ParsedAction {
  type: string;
  params: Record<string, unknown>;
  reasoning?: string;
}

interface ToolInputSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

interface ChatDecisionContext extends DecisionContext {
  sessionId: string;
  messages: Message[];
  provider: string;
  model: string;
  systemPrompt: string;
}

interface MCPToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

class ChatHandler {
  private conversationManager: ConversationManager;
  private decisionClientFactory: DecisionClientFactory;
  private config: ResolvedConfig;
  private wsManager: DebugWebSocketManager;
  private mcpClient: MCPSDKClient | null = null;
  private sessionEventsDAO?: SessionEventsDAO;
  private sessionEventHub: SessionEventHub;
  private maxToolLoops = 10;
  private toolLoopCount = 0;
  private pendingToolCalls: MCPToolCall[] = [];
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
    this.decisionClientFactory = createDecisionClientFactory();
    this.wsManager = wsManager;
    this.mcpClient = mcpClient || null;
    this.sessionEventsDAO = sessionEventsDAO || this.resolveSessionEventsDAO();
    this.sessionEventHub = sessionEventHub || SessionEventHub.getInstance();
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

  private getDecisionClient(provider: string, model: string): DecisionClient | null {
    return this.decisionClientFactory.create(this.config, provider, model);
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
    this.pendingToolCalls = [];

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
    const sessionController = ChatSessionController.getInstance();
    sessionController.resume(sessionId, persistedState?.status);

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
    clientId: string,
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

    if (iteration >= this.maxToolLoops) {
      throw new Error('Maximum tool use loop exceeded');
    }

    this.toolLoopCount = iteration;
    let accumulatedContent = '';
    let usageHandler: UsageStats | null = null;
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await this.emitSessionEvent(sessionId, 'assistant.started', {
      sessionId,
      messageId,
    });

    const contextWindow = this.conversationManager.getContextWindow(sessionId);
    const messages = contextWindow.messages;

    const systemPrompt = this.getSystemPrompt(session);

    console.log(
      `[ChatHandler] executeAIResponse, screenshot param length: ${screenshot?.length || 0}`
    );

    // Agent模式：不预注入页面信息，让AI主动调用MCP工具获取
    // 只提供空的初始上下文，AI需要通过mcp_call获取页面信息
    const chatContext = {
      sessionId,
      messages,
      provider: session.provider,
      model: session.model,
      systemPrompt,
      // DecisionContext fields - 初始为空，AI需要主动获取
      screenshot: screenshot || '',
      dom: {
        url: 'unknown',
        title: 'Unknown',
        elements: [],
        viewport: { width: 1920, height: 1080 },
      },
      elements: [],
      instruction: messages[messages.length - 1]?.content || '',
      previousActions: [],
      // 提供MCP工具列表供AI选择
      mcpTools: this.mcpClient ? this.mcpClient.getAvailableTools() : [],
    };

    this.pendingToolCalls = [];

    // Some mocks implement decideStream with timers and return void.
    // Wait for onDone to finish to prevent cross-test timer leakage and ordering flakiness.
    let resolveStreamDone: (() => void) | null = null;
    let streamDoneResolved = false;
    const streamDone = new Promise<void>((resolve) => {
      resolveStreamDone = resolve;
    });
    const resolveStreamDoneOnce = (): void => {
      if (streamDoneResolved) return;
      streamDoneResolved = true;
      resolveStreamDone?.();
    };

    const callbacks: StreamCallbacks = {
      onToken: (text: string) => {
        accumulatedContent += text;
        void this.emitSessionEvent(sessionId, 'assistant.delta', {
          sessionId,
          messageId,
          text,
        });
      },
      onThinking: (text: string) => {
        void this.emitSessionEvent(sessionId, 'assistant.thinking', {
          sessionId,
          messageId,
          text,
        });
      },
      onToolCall: (call: ToolCall) => {
        this.pendingToolCalls.push(call);
        void this.emitSessionEvent(sessionId, 'assistant.tool_call', {
          sessionId,
          messageId,
          toolCall: call,
        });
      },
      onUsage: (usage: UsageStats) => {
        usageHandler = usage;
      },
      onDone: async () => {
        try {
          await this.flushSessionEvents();
          const sessionController = ChatSessionController.getInstance();

          this.conversationManager.addMessage(sessionId, {
            role: 'assistant',
            content: accumulatedContent,
            metadata: {
              usage: usageHandler,
              provider: session.provider,
              model: session.model,
              tool_calls: this.pendingToolCalls.length > 0 ? this.pendingToolCalls : undefined,
            },
          });

          // Check pauseAfterGeneration
          if (sessionController.shouldPause(sessionId, 'afterGeneration')) {
            sessionController.markAsPaused(sessionId);
            await this.emitSessionEvent(sessionId, 'assistant.completed', {
              sessionId,
              messageId,
            });
            this.sendSessionUpdate();
            return;
          }

          // 检查是否有API级别的tool_calls
          if (this.pendingToolCalls.length > 0 && this.mcpClient && this.mcpClient.isEnabled()) {
            await this.handleToolCalls(clientId, sessionId, session, messageId);

            // Check pauseAfterExecution
            if (sessionController.shouldPause(sessionId, 'afterExecution')) {
              sessionController.markAsPaused(sessionId);
              await this.emitSessionEvent(sessionId, 'assistant.completed', {
                sessionId,
                messageId,
              });
              this.sendSessionUpdate();
              return;
            }

            await this.executeAIResponse(
              clientId,
              sessionId,
              session,
              iteration + 1,
              screenshot,
              signal
            );
            return;
          }

          // 解析AI返回的JSON指令，检查是否包含mcp_call
          console.log(
            `[ChatHandler] Parsing action from content: ${accumulatedContent.substring(0, 200)}...`
          );
          const parsedAction = this.parseActionFromContent(accumulatedContent);
          console.log(`[ChatHandler] Parsed action: ${JSON.stringify(parsedAction)}`);

          if (
            parsedAction &&
            parsedAction.type === 'mcp_call' &&
            this.mcpClient &&
            this.mcpClient.isEnabled()
          ) {
            console.log(`[ChatHandler] Executing MCP call: ${JSON.stringify(parsedAction.params)}`);
            const toolResult = await this.executeMCPCallAction(parsedAction);

            // 将工具结果添加到对话历史
            this.conversationManager.addMessage(sessionId, {
              role: 'tool',
              content: JSON.stringify(toolResult),
              metadata: {
                tool_name: `${parsedAction.params.server}.${parsedAction.params.tool}`,
                tool_args: parsedAction.params.args,
              },
            });
            await this.emitSessionEvent(sessionId, 'assistant.tool_result', {
              sessionId,
              messageId,
              result: this.stringifyToolResult(toolResult),
            });

            // Check pauseAfterExecution
            if (sessionController.shouldPause(sessionId, 'afterExecution')) {
              sessionController.markAsPaused(sessionId);
              await this.emitSessionEvent(sessionId, 'assistant.completed', {
                sessionId,
                messageId,
              });
              this.sendSessionUpdate();
              return;
            }

            // 继续让AI处理工具结果
            await this.executeAIResponse(
              clientId,
              sessionId,
              session,
              iteration + 1,
              screenshot,
              signal
            );
            return;
          }

          await this.emitSessionEvent(sessionId, 'assistant.completed', {
            sessionId,
            messageId,
          });
          this.sendSessionUpdate();
        } finally {
          resolveStreamDoneOnce();
        }
      },
    };

    try {
      const decisionClient = this.getDecisionClient(session.provider, session.model);
      if (!decisionClient) {
        const availableProviders = Object.keys(this.config._resolved?.providers || {}).join(', ');
        throw new Error(
          `Provider '${session.provider}' 未启用或模型 '${session.model}' 不可用。可用 providers: ${availableProviders || '无'}`
        );
      }
      if (!decisionClient.decideStream) {
        throw new Error(
          `Provider '${session.provider}' does not support streaming decisions for model '${session.model}'`
        );
      }
      console.log(`[ChatHandler] Using decision client: ${session.provider}/${session.model}`);
      await decisionClient.decideStream(
        chatContext as unknown as ChatDecisionContext,
        callbacks,
        signal
      );

      await streamDone;
    } catch (error) {
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
        error: errorMessage,
      });
      resolveStreamDoneOnce();
    }
  }

  private async handleToolCalls(
    _clientId: string,
    sessionId: string,
    _session: ChatSessionData,
    messageId: string
  ): Promise<void> {
    for (const toolCall of this.pendingToolCalls) {
      try {
        const toolResult = await this.executeToolCall(toolCall);

        this.conversationManager.addMessage(sessionId, {
          role: 'tool',
          content: JSON.stringify(toolResult),
          metadata: {
            tool_call_id: toolCall.id,
            tool_name: toolCall.function.name,
            tool_args: toolCall.function.arguments,
          },
        });
        await this.emitSessionEvent(sessionId, 'assistant.tool_result', {
          sessionId,
          messageId,
          result: this.stringifyToolResult(toolResult),
        });
      } catch (error) {
        const result = { error: (error as Error).message };
        this.conversationManager.addMessage(sessionId, {
          role: 'tool',
          content: JSON.stringify(result),
          metadata: {
            tool_call_id: toolCall.id,
            tool_name: toolCall.function.name,
            error: true,
          },
        });
        await this.emitSessionEvent(sessionId, 'assistant.tool_result', {
          sessionId,
          messageId,
          result: this.stringifyToolResult(result),
        });
      }
    }
  }

  private async executeToolCall(toolCall: MCPToolCall): Promise<unknown> {
    if (!this.mcpClient || !this.mcpClient.isEnabled()) {
      throw new Error('MCP is not enabled or not available');
    }

    const toolName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

    const [serverName, ...nameParts] = toolName.split('.');
    if (!serverName || nameParts.length === 0) {
      throw new Error(`Invalid tool name format: ${toolName}`);
    }

    const actualToolName = nameParts.join('.');

    const dangerousToolPatterns = ['delete', 'remove', 'destroy', 'drop', 'truncate'];
    const isDangerous = dangerousToolPatterns.some((pattern) =>
      actualToolName.toLowerCase().includes(pattern)
    );

    if (isDangerous) {
      throw new Error(
        `Dangerous tool "${actualToolName}" requires confirmation and is not allowed`
      );
    }

    return await this.mcpClient.callTool(serverName, actualToolName, args);
  }

  private parseActionFromContent(content: string): ParsedAction | null {
    // 尝试从内容中提取JSON块
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
        return this.normalizeAction(parsed);
      } catch (e) {
        console.warn('Failed to parse JSON from content:', e);
      }
    }

    // 尝试直接解析整个内容为JSON
    try {
      const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
      return this.normalizeAction(parsed);
    } catch {
      // 不是JSON格式
    }

    return null;
  }

  private normalizeAction(parsed: Record<string, unknown>): ParsedAction | null {
    if (!parsed) return null;

    if (typeof parsed.type === 'string') {
      return {
        type: parsed.type,
        params: (parsed.params as Record<string, unknown>) || {},
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
      };
    }

    if (parsed.action === 'mcp_call') {
      let server = (parsed.server as string) || 'browser-control';
      let tool = parsed.tool as string;
      const args = (parsed.args as Record<string, unknown>) || {};

      if (tool && tool.includes('.')) {
        const parts = tool.split('.');
        if (parts.length >= 2) {
          tool = parts.pop() || tool;
        }
      }

      server = server.replace(/_/g, '-');

      return {
        type: 'mcp_call',
        params: { server, tool, args },
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
      };
    }

    if (typeof parsed.action === 'string') {
      return {
        type: parsed.action,
        params:
          (parsed.params as Record<string, unknown>) ||
          ({ target: parsed.target, value: parsed.value } as Record<string, unknown>),
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
      };
    }

    return null;
  }

  private async executeMCPCallAction(action: ParsedAction): Promise<unknown> {
    if (!this.mcpClient || !this.mcpClient.isEnabled()) {
      throw new Error('MCP is not enabled or not available');
    }

    const { server, tool, args = {} } = action.params as {
      server: string;
      tool: string;
      args: Record<string, unknown>;
    };
    console.log(
      `[Agent] Executing MCP call: server=${server}, tool=${tool}, args=${JSON.stringify(args)}`
    );

    // 如果server不是browser-control，自动修正
    const actualServer = server === 'default' ? 'browser-control' : server;

    return await this.mcpClient.callTool(actualServer, tool, args);
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
