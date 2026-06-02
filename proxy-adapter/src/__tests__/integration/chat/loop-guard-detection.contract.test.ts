import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ResolvedConfig } from '../../../config/schema.js';
import type { SessionEventType } from '@nebula-link-evo/shared/types/sse-events';
import { ChatHandler } from '../../../conversation/chat-handler.js';
import { ConversationManager } from '../../../conversation/manager.js';
import { MCPSDKClient } from '../../../clients/mcp/sdk-client.js';
import { ChatSessionController } from '../../../services/chat-session-controller.js';
import { SessionEventsDAO } from '../../../conversation/session-events-dao.js';
import { SessionEventHub } from '../../../services/session-event-hub.js';

type StreamResult = {
  fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>;
};

const { streamTextMock, toolMock, stepCountIsMock, getModelMock } = vi.hoisted(() => {
  const streamText = vi.fn<(...args: unknown[]) => Promise<StreamResult>>();
  const tool = vi.fn((definition: unknown) => definition);
  const stepCountIs = vi.fn().mockReturnValue(() => false);
  const getModel = vi.fn().mockReturnValue({ provider: 'test-provider', modelId: 'test-model' });
  return {
    streamTextMock: streamText,
    toolMock: tool,
    stepCountIsMock: stepCountIs,
    getModelMock: getModel,
  };
});

vi.mock('ai', () => ({
  streamText: streamTextMock,
  tool: toolMock,
  stepCountIs: stepCountIsMock,
}));

vi.mock('../../../clients/vercel-ai/provider.js', () => ({
  getModel: getModelMock,
}));

function createResolvedConfig(): ResolvedConfig {
  return {
    version: '1.0',
    providers: {
      kimi: {
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://api.moonshot.cn/v1',
        npmPackage: '@ai-sdk/openai-compatible',
        models: {
          'moonshot-v1-vision-preview': {
            type: 'vision',
            capabilities: ['vision', 'decision'],
            temperature: 0.4,
            maxTokens: 2000,
          },
        },
      },
    },
    mcp: { enabled: true, servers: {} },
    defaults: {
      mode: 'separation',
      vision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
      decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
    },
    settings: {
      timeout: 30000,
      maxRetries: 3,
      temperature: 0.4,
      maxTokens: 2000,
      maxSteps: 8,
      loopGuard: {
        identicalAction: { warnAt: 3, blockAt: 5 },
        noProgress: { warnAt: 3, blockAt: 5 },
        pingPong: { warnAt: 4, blockAt: 6 },
        hardCap: 30,
        windowSize: 15,
      },
    },
  };
}

function createStream(parts: Array<{ type: string; [key: string]: unknown }>): StreamResult {
  return {
    fullStream: {
      async *[Symbol.asyncIterator]() {
        for (const part of parts) {
          yield part;
        }
      },
    },
  };
}

/** Build a repeating tool-call + tool-result + finish-step sequence */
function buildIdenticalSteps(
  count: number,
  toolName: string,
  args: Record<string, unknown>,
  output: Record<string, unknown>,
): Array<{ type: string; [key: string]: unknown }> {
  const parts: Array<{ type: string; [key: string]: unknown }> = [];
  for (let i = 0; i < count; i++) {
    const callId = `call_ident_${i}`;
    parts.push(
      { type: 'tool-call', toolCallId: callId, toolName, args },
      { type: 'tool-result', toolCallId: callId, toolName, input: args, output },
      { type: 'finish-step' },
    );
  }
  return parts;
}

/** Build alternating ping-pong steps */
function buildPingPongSteps(
  count: number,
  toolA: string,
  argsA: Record<string, unknown>,
  toolB: string,
  argsB: Record<string, unknown>,
  outputA: Record<string, unknown>,
  outputB: Record<string, unknown>,
): Array<{ type: string; [key: string]: unknown }> {
  const parts: Array<{ type: string; [key: string]: unknown }> = [];
  for (let i = 0; i < count; i++) {
    const isA = i % 2 === 0;
    const toolName = isA ? toolA : toolB;
    const args = isA ? argsA : argsB;
    const output = isA ? outputA : outputB;
    const callId = `call_pp_${i}`;
    parts.push(
      { type: 'tool-call', toolCallId: callId, toolName, args },
      { type: 'tool-result', toolCallId: callId, toolName, input: args, output },
      { type: 'finish-step' },
    );
  }
  return parts;
}

function createCleanFinish(): Array<{ type: string; [key: string]: unknown }> {
  return [
    { type: 'text-delta', text: 'done' },
    {
      type: 'finish',
      finishReason: 'stop',
      rawFinishReason: 'stop',
      totalUsage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
    },
  ];
}

describe('chat loop guard detection contract', () => {
  let manager: ConversationManager;
  let mcpClient: MCPSDKClient;
  let chatHandler: ChatHandler;
  let sessionId: string;

  const appendEvent = vi.fn<
    (sessionId: string, type: SessionEventType, payload: Record<string, unknown>) => Promise<number>
  >();

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ConversationManager(':memory:');
    manager.initialize();
    mcpClient = new MCPSDKClient(createResolvedConfig());
    vi.spyOn(mcpClient, 'isEnabled').mockReturnValue(true);
    vi.spyOn(mcpClient, 'getAvailableTools').mockReturnValue([]);

    sessionId = `loop-detect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    manager.createSession({
      id: sessionId,
      title: 'loop-detect-contract',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    appendEvent.mockResolvedValue(1);
    const sessionEventsDAO = {
      appendEvent,
      flush: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionEventsDAO;
    const sessionEventHub = {
      publish: vi.fn(),
    } as unknown as SessionEventHub;

    chatHandler = new ChatHandler(
      manager,
      createResolvedConfig(),
      mcpClient,
      sessionEventsDAO,
      sessionEventHub,
    );
  });

  afterEach(async () => {
    await manager.close();
    vi.restoreAllMocks();
  });

  function getCompletedPayload(): Record<string, unknown> {
    return appendEvent.mock.calls.find((call) => call[1] === 'assistant.completed')?.[2] ?? {};
  }

  it('identical action warning triggers restart and model heeds nudge → stop', async () => {
    // Call 1: 3 identical actions → warning (warnAt=3) → break → restart
    // Call 2: clean finish → stop
    const args = { selector: '#submit-btn' };
    const output = { success: true, message: 'clicked' };

    streamTextMock
      .mockResolvedValueOnce(createStream([
        ...buildIdenticalSteps(3, 'click_element', args, output),
      ]))
      .mockResolvedValueOnce(createStream(createCleanFinish()));

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'click the button repeatedly',
    });

    expect(getCompletedPayload().terminal_reason).toBe('stop');
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('identical action blocked triggers restart and model still loops → loop_detected', async () => {
    // Call 1: 5 identical actions → blocked (blockAt=5) → break → restart
    // Call 2: 1 more identical action → blocked again → restartCount=1 >= MAX_RESTARTS → loop_detected
    const args = { selector: '#submit-btn' };
    const output = { success: true, message: 'clicked' };

    streamTextMock
      .mockResolvedValueOnce(createStream([
        ...buildIdenticalSteps(5, 'click_element', args, output),
      ]))
      .mockResolvedValueOnce(createStream([
        ...buildIdenticalSteps(1, 'click_element', args, output),
      ]));

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'click the button repeatedly',
    });

    expect(getCompletedPayload().terminal_reason).toBe('loop_detected');
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('double restart prevented — streamText called at most 2 times', async () => {
    // Call 1: 3 identical → warning → restart
    // Call 2: 3 more identical → history=6, blocked → restartCount=1 >= MAX_RESTARTS → loop_detected
    const args = { selector: '#retry-btn' };
    const output = { success: false, message: 'failed' };

    streamTextMock
      .mockResolvedValueOnce(createStream([
        ...buildIdenticalSteps(3, 'click_element', args, output),
      ]))
      .mockResolvedValueOnce(createStream([
        ...buildIdenticalSteps(3, 'click_element', args, output),
      ]));

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'keep retrying',
    });

    expect(getCompletedPayload().terminal_reason).toBe('loop_detected');
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('no-progress detection — different tools same result → warning → restart → stop', async () => {
    // 3 different tools with different args but same output hash → noProgress warning (warnAt=3)
    const sameOutput = { success: true, page: 'unchanged' };

    streamTextMock
      .mockResolvedValueOnce(createStream([
        { type: 'tool-call', toolCallId: 'c1', toolName: 'click_element', args: { selector: '#btn1' } },
        { type: 'tool-result', toolCallId: 'c1', toolName: 'click_element', input: { selector: '#btn1' }, output: sameOutput },
        { type: 'finish-step' },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'type_text', args: { selector: '#input', text: 'hello' } },
        { type: 'tool-result', toolCallId: 'c2', toolName: 'type_text', input: { selector: '#input', text: 'hello' }, output: sameOutput },
        { type: 'finish-step' },
        { type: 'tool-call', toolCallId: 'c3', toolName: 'scroll_page', args: { direction: 'down' } },
        { type: 'tool-result', toolCallId: 'c3', toolName: 'scroll_page', input: { direction: 'down' }, output: sameOutput },
        { type: 'finish-step' },
      ]))
      .mockResolvedValueOnce(createStream(createCleanFinish()));

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'interact with page',
    });

    expect(getCompletedPayload().terminal_reason).toBe('stop');
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('ping-pong detection — two tools alternating 4 times → warning → restart → stop', async () => {
    // Alternating: click_A, click_B, click_A, click_B → alternationCount=4, warnAt=4 → warning
    const argsA = { selector: '#tab-a' };
    const argsB = { selector: '#tab-b' };
    const outputA = { success: true, active: 'a' };
    const outputB = { success: true, active: 'b' };

    streamTextMock
      .mockResolvedValueOnce(createStream([
        ...buildPingPongSteps(4, 'click_element', argsA, 'click_element', argsB, outputA, outputB),
      ]))
      .mockResolvedValueOnce(createStream(createCleanFinish()));

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'switch tabs',
    });

    expect(getCompletedPayload().terminal_reason).toBe('stop');
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('loop_detected terminal reason leaves session resumable', async () => {
    const updateSessionStatusSpy = vi.spyOn(manager, 'updateSessionStatus').mockResolvedValue(undefined);

    const args = { selector: '#btn' };
    const output = { success: true };

    // Trigger loop_detected via double restart prevention
    streamTextMock
      .mockResolvedValueOnce(createStream([
        ...buildIdenticalSteps(3, 'click_element', args, output),
      ]))
      .mockResolvedValueOnce(createStream([
        ...buildIdenticalSteps(1, 'click_element', args, output),
      ]));

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'loop then resume',
    });

    expect(getCompletedPayload().terminal_reason).toBe('loop_detected');

    // Session should be completed with terminal reason, making it resumable
    const completionCall = updateSessionStatusSpy.mock.calls.find((call) => call[1] === 'completed');
    expect(completionCall).toBeDefined();
    expect(completionCall?.[2]).toMatchObject({
      terminalReason: 'loop_detected',
    });

    // 'completed' status is resumable (not 'running' or 'idle')
    const finalStatus = completionCall?.[1];
    expect(finalStatus).toBe('completed');
    expect(finalStatus).not.toBe('running');
    expect(finalStatus).not.toBe('idle');
  });

  it('hard cap / maxSteps still acts as safety net → max_steps_reached', async () => {
    // max-steps finishReason triggers max_steps_reached regardless of loop guard
    streamTextMock.mockResolvedValue(
      createStream([
        { type: 'text-delta', text: 'still going' },
        {
          type: 'finish',
          finishReason: 'max-steps',
          rawFinishReason: 'max-steps',
          totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      ]),
    );

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'trigger max steps',
    });

    expect(getCompletedPayload().terminal_reason).toBe('max_steps_reached');
  });

  it('clean flow — varied tool calls → no restart, no nudge → stop', async () => {
    // Different tools with different args and different results → all clean
    streamTextMock.mockResolvedValueOnce(
      createStream([
        { type: 'tool-call', toolCallId: 'c1', toolName: 'click_element', args: { selector: '#btn1' } },
        { type: 'tool-result', toolCallId: 'c1', toolName: 'click_element', input: { selector: '#btn1' }, output: { success: true, clicked: 'btn1' } },
        { type: 'finish-step' },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'type_text', args: { selector: '#input', text: 'hello' } },
        { type: 'tool-result', toolCallId: 'c2', toolName: 'type_text', input: { selector: '#input', text: 'hello' }, output: { success: true, typed: 'hello' } },
        { type: 'finish-step' },
        { type: 'tool-call', toolCallId: 'c3', toolName: 'scroll_page', args: { direction: 'down', amount: 200 } },
        { type: 'tool-result', toolCallId: 'c3', toolName: 'scroll_page', input: { direction: 'down', amount: 200 }, output: { success: true, scrolled: 200 } },
        { type: 'finish-step' },
        { type: 'text-delta', text: 'task done' },
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: { inputTokens: 15, outputTokens: 10, totalTokens: 25 },
        },
      ]),
    );

    await chatHandler.handleChatSend('test-client', {
      sessionId,
      message: 'do various things',
    });

    expect(getCompletedPayload().terminal_reason).toBe('stop');
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });
});
