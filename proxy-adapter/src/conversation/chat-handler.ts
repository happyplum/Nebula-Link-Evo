import { ConversationManager } from './manager.js';
import { MCPSDKClient, MCPServerUnavailableError } from '../clients/mcp/sdk-client.js';
import type { ResolvedConfig } from '../config/schema.js';
import { ChatSessionController } from '../services/chat-session-controller.js';
import type { AgentState, Session, Message, SessionStatus } from './types.js';
import type { SessionEvent, SessionEventType } from '@nebula-link-evo/shared/types/sse-events';
import { SessionEventsDAO } from './session-events-dao.js';
import { DatabaseManager } from './db.js';
import { SessionEventHub } from '../services/session-event-hub.js';
import { streamText, stepCountIs, tool } from 'ai';
import { estimateTotalInputTokens } from '../services/provider/token-estimator.js';
import type { ModelMessage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { z } from 'zod';
import { getModel } from '../clients/vercel-ai/provider.js';
import { ProviderRegistry } from '../services/provider/registry.js';
import type { ProviderConfig } from '../services/provider/types.js';
import { createWorkerLogger } from '../services/logger.js';
import { LoopGuardService } from '../services/loop-guard/loop-guard-service.js';
import { InterventionEngine } from '../services/loop-guard/intervention.js';
import { hashArgs, hashResult } from '../services/loop-guard/fingerprint.js';
import type { LoopGuardVerdict } from '../services/loop-guard/types.js';

import { classifyRateLimitError } from '../services/provider/error-classifier.js';

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

interface MCPObjectSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

type TerminalReason = 'stop' | 'max_steps_reached' | 'tool_error' | 'abort' | 'pause' | 'loop_detected' | 'loop_warned';

class ChatHandler {
  private conversationManager: ConversationManager;
  private config: ResolvedConfig;
  private mcpClient: MCPSDKClient | null = null;
  private sessionEventsDAO?: SessionEventsDAO;
  private sessionEventHub: SessionEventHub;
  private providerRegistry: ProviderRegistry;
  private maxToolLoops = 10;
  private toolLoopCount = 0;
  private loopGuardMap: Map<string, LoopGuardService> = new Map();
  private intervention: InterventionEngine;
  private sessionEventQueue: Promise<void> = Promise.resolve();
  private logger = createWorkerLogger('chat-handler');

  constructor(
    conversationManager: ConversationManager,
    config: ResolvedConfig,
    mcpClient?: MCPSDKClient,
    sessionEventsDAO?: SessionEventsDAO,
    sessionEventHub?: SessionEventHub
  ) {
    this.conversationManager = conversationManager;
    this.config = config;
    this.mcpClient = mcpClient || null;
    this.sessionEventsDAO = sessionEventsDAO || this.resolveSessionEventsDAO();
    this.sessionEventHub = sessionEventHub || SessionEventHub.getInstance();
    this.providerRegistry = this.createProviderRegistry(config);
    const configuredMaxSteps =
      this.config.settings?.maxSteps ??
      this.maxToolLoops;
    this.maxToolLoops = configuredMaxSteps > 0 ? configuredMaxSteps : this.maxToolLoops;
    this.intervention = new InterventionEngine();
  }

  private getOrCreateLoopGuard(sessionId: string): LoopGuardService {
    let guard = this.loopGuardMap.get(sessionId);
    if (!guard) {
      guard = new LoopGuardService(this.config.settings?.loopGuard);
      this.loopGuardMap.set(sessionId, guard);
    }
    return guard;
  }

  private createProviderRegistry(config: ResolvedConfig): ProviderRegistry {
    const providers: Record<string, ProviderConfig> = {};
    for (const [key, provider] of Object.entries(config.providers)) {
      if (!provider.enabled) {
        continue;
      }

      providers[key] = {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl || undefined,
        npmPackage: provider.npmPackage,
      };
    }

    return new ProviderRegistry(providers);
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
        this.sessionEventHub.publish(
          sessionId,
          seq === undefined ? eventData : { ...eventData, seq }
        );
      } catch (error) {
        this.logger.warn({ sessionId, type, error }, 'Failed to emit session event');
      }
    });

    return this.sessionEventQueue;
  }

  private emitStreamingEvent(
    sessionId: string,
    type: SessionEventType,
    payload: Record<string, unknown>
  ): void {
    const eventData: SessionEvent = {
      type,
      ...payload,
    } as SessionEvent;

    const hub = this.sessionEventHub;
    if (this.sessionEventsDAO) {
      this.sessionEventQueue = this.sessionEventQueue
        .then(() => {
          // appendLiveEvent 是同步的 — 即时分配 seq，立即发布
          const seq = this.sessionEventsDAO!.appendLiveEvent(sessionId, type, payload);
          hub.publish(sessionId, { ...eventData, seq });
        })
        .catch((err) => {
          this.logger.warn({ err, sessionId, eventType: type }, 'Streaming event dropped — appendLiveEvent failed');
        });
    } else {
      hub.publish(sessionId, eventData);
    }
  }

  private async flushSessionEvents(): Promise<void> {
    await this.sessionEventQueue;
    await this.sessionEventsDAO?.flush();
  }

  getSessionEventsDAO(): SessionEventsDAO | undefined {
    return this.sessionEventsDAO;
  }

  getSessionEventHub(): SessionEventHub {
    return this.sessionEventHub;
  }

  private async resolveDecisionModel(provider: string, model: string): Promise<LanguageModelV3> {
    return getModel(this.providerRegistry, provider, model);
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
    const hasTools =
      this.mcpClient &&
      this.mcpClient.isEnabled() &&
      this.mcpClient.getAvailableTools().length > 0;

    if (hasTools) {
      return '你是一个智能助手，可以通过工具与浏览器交互。请根据工具描述中的说明使用它们。';
    }
    return '你是一个智能助手。当前没有可用的浏览器工具，请仅以文字形式回答用户问题。';
  }

  async handleChatSend(clientId: string, params: ChatSendParams): Promise<void> {
    const { sessionId, message, screenshot, skipAddMessage } = params;

    const session = this.conversationManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.logger.debug({ sessionId, screenshotLength: screenshot?.length ?? 0 }, 'handleChatSend');

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
    signal?: AbortSignal,
    restartCount: number = 0,
    nudgeOverride?: string,
  ): Promise<void> {
    if (signal?.aborted) {
      this.logger.debug({ sessionId }, 'Execution aborted');
      return;
    }

    this.toolLoopCount = iteration;
    if (restartCount === 0) {
      this.getOrCreateLoopGuard(sessionId).reset();
    }
    const runId = this.createRunId();
    const messageId = this.createMessageId();
    let accumulatedContent = '';
    let totalUsage: Record<string, unknown> | undefined;
    const emittedToolCalls: Array<Record<string, unknown>> = [];
    const completedToolCallIds = new Set<string>();
    let streamError: unknown;
    let pauseRequested = false;
    let stepHadToolResult = false;
    let finishReason: string | undefined;
    let terminalReasonOverride: TerminalReason | undefined;
    let loopVerdict: LoopGuardVerdict | null = null;
    let pendingNudge: string | undefined;

    await this.emitSessionEvent(sessionId, 'assistant.started', {
      sessionId,
      runId,
      messageId,
    });

    // Snapshot model info at execution start — immune to mid-run session updates
    const activeProvider = session.provider;
    const activeModel = session.model;

    const contextWindow = this.conversationManager.getContextWindow(sessionId);
    const messages = this.toModelMessages(contextWindow.messages);
    this.attachScreenshotToLastUser(messages, screenshot);

    const systemPrompt = nudgeOverride
      ? `${this.getSystemPrompt(session)}\n\n${nudgeOverride}`
      : this.getSystemPrompt(session);
    const sessionController = ChatSessionController.getInstance();
    const decisionModel = await this.resolveDecisionModel(activeProvider, activeModel);

    const sdkTools = this.createSDKTools() as Parameters<typeof streamText>[0]['tools'];

    // --- Token budget: layer 1 = single-request check, layer 2 = compress-then-error ---
    const contextWindowTokens = this.config.settings?.contextWindowTokens ?? 131072;
    const maxOutputTokens = this.config.settings?.maxTokens ?? 1000;
    const inputBudget = contextWindowTokens - maxOutputTokens;
    const toolsAsRecord = sdkTools as Record<string, unknown>;

    // ---- Layer 1: Minimum viable request (system + tools + current user message only) ----
    // Even with ZERO history, this single request must fit.
    const lastUserMsg = messages.length > 0 ? [messages[messages.length - 1]] : [];
    const minViableTokens = estimateTotalInputTokens(systemPrompt, lastUserMsg, toolsAsRecord);

    if (minViableTokens > inputBudget) {
      const errorMessage =
        `当前单次请求内容已超出模型上下文限制（约 ${Math.round(minViableTokens / 1000)}K tokens > ${Math.round(contextWindowTokens / 1024)}K）。` +
        `请缩短输入内容或减小附件大小后重试。`;
      this.logger.error(
        { minViableTokens, inputBudget, contextWindowTokens, messageCount: messages.length },
        'Single request exceeds context window — impossible to send',
      );
      await this.emitSessionEvent(sessionId, 'run.error', {
        sessionId,
        runId,
        error: errorMessage,
        code: 'VALIDATION_ERROR',
      });
      await this.flushSessionEvents();
      return;
    }

    // ---- Layer 2: Full request with history ----
    let estimatedInputTokens = estimateTotalInputTokens(systemPrompt, messages, toolsAsRecord);
    let budgetedMessages = messages;

    if (estimatedInputTokens > inputBudget) {
      this.logger.info(
        { estimatedTokens: estimatedInputTokens, budget: inputBudget, messageCount: messages.length },
        'Context window over budget — attempting compression',
      );

      // Force compression (summarize older messages)
      const didCompress = await this.conversationManager.compactForTokenBudget(sessionId);
      if (didCompress) {
        const compressedContext = this.conversationManager.getContextWindow(sessionId);
        budgetedMessages = this.toModelMessages(compressedContext.messages);
        this.attachScreenshotToLastUser(budgetedMessages, screenshot);

        estimatedInputTokens = estimateTotalInputTokens(systemPrompt, budgetedMessages, toolsAsRecord);
        this.logger.info(
          { estimatedTokens: estimatedInputTokens, budget: inputBudget, messageCount: budgetedMessages.length },
          'After compression — re-estimated tokens',
        );
      }

      // Still over budget after compression → error to frontend
      if (estimatedInputTokens > inputBudget) {
        const errorMessage =
          `上下文内容过大（约 ${Math.round(estimatedInputTokens / 1000)}K tokens），` +
          `超出模型上限（${Math.round(contextWindowTokens / 1024)}K tokens）。` +
          `请缩短输入内容或减少当前对话历史后重试。`;
        this.logger.error(
          { estimatedTokens: estimatedInputTokens, budget: inputBudget, messageCount: budgetedMessages.length },
          'Context overflow even after compression — reporting to frontend',
        );
      await this.emitSessionEvent(sessionId, 'run.error', {
        sessionId,
        runId,
        error: errorMessage,
        code: 'API_ERROR',
      });
      await this.flushSessionEvents();
      return;
      }
    }

    const maxSteps = this.maxToolLoops;
    const streamOptions: Parameters<typeof streamText>[0] & { maxSteps: number } = {
      model: decisionModel,
      system: systemPrompt,
      messages: budgetedMessages,
      tools: sdkTools,
      abortSignal: signal,
      maxSteps,
      maxOutputTokens,
      stopWhen: stepCountIs(maxSteps),
    };

    this.logger.debug({ screenshotLength: screenshot?.length ?? 0 }, 'executeAIResponse');

    try {
      this.logger.info({ provider: activeProvider, model: activeModel }, 'Using SDK model');
      const result = await streamText(streamOptions);

      for await (const streamPart of result.fullStream) {
        const part = streamPart as { type: string; [key: string]: unknown };

        if (part.type === 'text-delta' && typeof part.text === 'string') {
          accumulatedContent += part.text;
          this.emitStreamingEvent(sessionId, 'assistant.delta', {
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
          this.emitStreamingEvent(sessionId, 'assistant.thinking', {
            sessionId,
            runId,
            messageId,
            text: part.text,
          });
          continue;
        }

        if (part.type === 'tool-call') {
          // SDK always provides toolCallId as a required string, but generate a
          // stable fallback so downstream correlation never breaks.
          const rawId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
          const toolCallId = rawId ?? `tc_${sessionId}_${runId ?? 'run'}_${emittedToolCalls.length}`;
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
          this.conversationManager.setActiveToolCalls(sessionId, emittedToolCalls);

          this.emitStreamingEvent(sessionId, 'assistant.tool_call', {
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
          // Correlate with the matching tool-call by SDK toolCallId; fall back to
          // the sole unmatched (no result yet) emitted tool call's stable ID so
          // tool_result always has an ID. Only safe when exactly one pending call
          // exists — prevents mis-association in multi-tool / parallel scenarios.
          const rawId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
          let toolCallId: string;
          if (rawId) {
            toolCallId = rawId;
          } else {
            const pendingCalls = emittedToolCalls.filter(
              (tc) => !completedToolCallIds.has(tc.id as string),
            );
            if (pendingCalls.length === 1) {
              toolCallId = pendingCalls[0].id as string;
            } else {
              this.logger.warn(
                { sessionId, pendingCount: pendingCalls.length },
                'tool_result missing toolCallId and %d pending calls — cannot safely correlate',
                pendingCalls.length,
              );
              toolCallId = `tc_orphan_${sessionId}_${Date.now()}`;
            }
          }
          // Track this tool call as completed to avoid reuse in future fallbacks
          completedToolCallIds.add(toolCallId);
          const toolName = typeof part.toolName === 'string' ? part.toolName : 'unknown.tool';
          const toolInput = this.normalizeToRecord(part.input);
          const output = part.output;

          this.conversationManager.addMessage(sessionId, {
            role: 'tool',
            content: this.stringifyToolResult(output),
            metadata: {
              phase: 'tool_result',
              tool_call_id: toolCallId,
              tool_name: toolName,
              tool_args: toolInput,
              provider: activeProvider,
              model: activeModel,
              runId,
            },
          });

          this.emitStreamingEvent(sessionId, 'assistant.tool_result', {
            sessionId,
            runId,
            messageId,
            toolCallId,
            result: this.stringifyToolResult(output),
          });

          this.getOrCreateLoopGuard(sessionId).recordAction({
            toolName,
            argsHash: hashArgs(toolInput),
            resultHash: hashResult(output),
            timestamp: Date.now(),
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

          // Loop guard detection — check after each completed step
          const verdict = this.getOrCreateLoopGuard(sessionId).check();
          if (verdict.level === 'critical') {
            terminalReasonOverride = 'loop_detected';
            break;
          }
          if (verdict.level === 'warning' || verdict.level === 'blocked') {
            loopVerdict = verdict;
            pendingNudge = this.intervention.getNudge(verdict);
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
          this.logger.debug({ sessionId }, 'Stream aborted');
          return;
        }
      }

      if (streamError) {
        throw streamError;
      }

      if (signal?.aborted) {
        this.logger.debug({ sessionId }, 'Execution aborted');
        return;
      }

      // Handle loop detection restart/terminate
      const MAX_RESTARTS = 1;
      if (terminalReasonOverride === 'loop_detected') {
        // Critical: force terminate, fall through to completion with override
      } else if (loopVerdict && pendingNudge) {
        if (restartCount < MAX_RESTARTS) {
          return this.executeAIResponse(
            _clientId, sessionId, session,
            iteration, screenshot, signal,
            restartCount + 1, pendingNudge,
          );
        }
        // Restart limit exceeded — force terminate
        terminalReasonOverride = 'loop_detected';
      }

      this.conversationManager.addMessage(sessionId, {
        role: 'assistant',
        content: accumulatedContent,
        metadata: {
          phase: 'chat-decision',
          usage: totalUsage,
          provider: activeProvider,
          model: activeModel,
          runId,
          tool_calls: emittedToolCalls.length > 0 ? emittedToolCalls : undefined,
        },
      });
      this.conversationManager.clearActiveToolCalls(sessionId);

      const terminalReason: TerminalReason = pauseRequested
        ? 'pause'
        : terminalReasonOverride ?? this.mapFinishReasonToTerminalReason(finishReason);

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
      await this.conversationManager.updateSessionStatus(
        sessionId,
        completionStatus,
        nextAgentState
      );

      if (pauseRequested) {
        return;
      }
    } catch (error) {
      if (signal?.aborted || this.isAbortLikeError(error)) {
        this.logger.debug({ sessionId }, 'Execution aborted');
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error({ sessionId, provider: session.provider, model: session.model, iteration, error: errorMessage, stack: errorStack }, 'Failed to stream AI response');
      await this.flushSessionEvents();
      this.conversationManager.clearActiveToolCalls(sessionId);

      // Classify rate-limit errors before emitting SSE
      const classification = classifyRateLimitError(error, { provider: session.provider, logger: this.logger });

      if (classification.isRateLimited) {
        await this.emitSessionEvent(sessionId, 'run.error', {
          sessionId,
          runId,
          error: errorMessage,
          code: 'RATE_LIMITED',
          retryAfterMs: classification.retryAfterMs,
        });

        // Re-throw classified ProviderError so job queue can set rate_limit blockReason
        throw classification.providerError;
      }

      await this.emitSessionEvent(sessionId, 'run.error', {
        sessionId,
        runId,
        error: errorMessage,
        code: 'API_ERROR',
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

  /**
   * Attach a screenshot (base64) to the last user message in the array.
   * Mutates the array in place and returns it.
   */
  private attachScreenshotToLastUser(messages: ModelMessage[], screenshot?: string): ModelMessage[] {
    if (!screenshot) return messages;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx !== -1) {
      const existing = messages[lastUserIdx];
      const textContent = typeof existing.content === 'string' ? existing.content : '';
      messages[lastUserIdx] = {
        role: 'user',
        content: [
          { type: 'image', image: screenshot },
          { type: 'text', text: textContent },
        ],
      };
    }
    return messages;
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
      this.logger.warn('MCP is not available — no tools registered, AI can only respond with text');
      return tools;
    }

    // All tools (including browser tools) are provided by MCP servers
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

          try {
            return await this.mcpClient.callTool(serverName, actualToolName, args);
          } catch (error) {
            if (error instanceof MCPServerUnavailableError) {
              this.logger.warn(
                { serverName, toolName: actualToolName, state: error.serverState },
                'MCP server unavailable during tool call',
              );
              return error.message;
            }
            throw error;
          }
        },
      });
    }

    if (Object.keys(tools).length === 0) {
      this.logger.warn('MCP is enabled but no tools discovered — check MCP server status');
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

    if (
      Array.isArray(definition.enum) &&
      definition.enum.every((value) => typeof value === 'string')
    ) {
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

}

export { ChatHandler };
export type { ChatSendParams, ChatSessionData, ChatMessageData };
