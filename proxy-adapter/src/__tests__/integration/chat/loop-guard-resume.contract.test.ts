import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ResolvedConfig } from '../../../config/schema.js';
import type { SessionStatus } from '../../../conversation/types.js';
import { ChatHandler } from '../../../conversation/chat-handler.js';
import { ConversationManager } from '../../../conversation/manager.js';
import { DebugWebSocketManager } from '../../../websocket-manager.js';
import { ChatSessionController } from '../../../services/chat-session-controller.js';

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
    mcp: { enabled: false, servers: {} },
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
    },
  };
}

describe('chat loop guard resume policy contract', () => {
  let manager: ConversationManager;
  let wsManager: DebugWebSocketManager;
  let chatHandler: ChatHandler;
  let sessionId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ConversationManager(':memory:');
    manager.initialize();
    wsManager = DebugWebSocketManager.getInstance();
    wsManager.setTaskCommandHandler(() => {});

    sessionId = `loop-guard-resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    manager.createSession({
      id: sessionId,
      title: 'loop-guard-resume-contract',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    chatHandler = new ChatHandler(manager, createResolvedConfig(), wsManager);
    vi.spyOn(
      chatHandler as unknown as {
        executeAIResponse: (...args: unknown[]) => Promise<void>;
      },
      'executeAIResponse'
    ).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await manager.close();
    vi.restoreAllMocks();
  });

  it('allows resume for paused/completed/cancelled/blocked/interrupted and rejects running', async () => {
    const allowedStatuses: SessionStatus[] = ['paused', 'completed', 'cancelled', 'blocked', 'interrupted'];
    const sessionController = {
      resume: vi.fn(),
      createAbortController: vi.fn().mockReturnValue(new AbortController()),
      cleanup: vi.fn(),
    } as unknown as ChatSessionController;
    vi.spyOn(ChatSessionController, 'getInstance').mockReturnValue(sessionController);

    const getSessionStateSpy = vi.spyOn(manager, 'getSessionState');
    const updateSessionStatusSpy = vi.spyOn(manager, 'updateSessionStatus').mockResolvedValue(undefined);

    for (const status of allowedStatuses) {
      getSessionStateSpy.mockResolvedValueOnce({
        sessionId,
        status,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        agentState: { schema_version: 1 },
      });

      await expect(chatHandler.resumeSession('test-client', sessionId)).resolves.toBeUndefined();
    }

    expect(updateSessionStatusSpy).toHaveBeenCalledTimes(allowedStatuses.length);

    getSessionStateSpy.mockResolvedValueOnce({
      sessionId,
      status: 'running',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      agentState: { schema_version: 1 },
    });

    await expect(chatHandler.resumeSession('test-client', sessionId)).rejects.toThrow(
      `Cannot resume session ${sessionId}: status "running" is not resumable`
    );
  });

  it('allows resume after max_steps_reached completion and continues with new execution context', async () => {
    const abortController = new AbortController();
    const sessionController = {
      resume: vi.fn(),
      createAbortController: vi.fn().mockReturnValue(abortController),
      cleanup: vi.fn(),
    } as unknown as ChatSessionController;
    vi.spyOn(ChatSessionController, 'getInstance').mockReturnValue(sessionController);

    vi.spyOn(manager, 'getSessionState').mockResolvedValue({
      sessionId,
      status: 'completed',
      version: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      agentState: { schema_version: 1 },
    });
    vi.spyOn(manager, 'updateSessionStatus').mockResolvedValue(undefined);

    const executeSpy = vi.spyOn(
      chatHandler as unknown as {
        executeAIResponse: (...args: unknown[]) => Promise<void>;
      },
      'executeAIResponse'
    );

    await expect(chatHandler.resumeSession('test-client', sessionId)).resolves.toBeUndefined();
    expect(executeSpy).toHaveBeenCalledWith(
      'test-client',
      sessionId,
      expect.objectContaining({ id: sessionId }),
      0,
      undefined,
      abortController.signal
    );
  });
});
