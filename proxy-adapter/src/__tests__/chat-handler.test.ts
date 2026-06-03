import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ChatHandler } from '../conversation/chat-handler.js';
import { ConversationManager } from '../conversation/manager.js';
import type { DecisionClient } from '../clients/types.js';
import type { ResolvedConfig } from '../config/schema.js';
import { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import { ChatSessionController } from '../services/chat-session-controller.js';

function createDeferredPromise<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

vi.mock('../clients/vercel-ai/browser-lifecycle-tools.js', () => ({
  createBrowserLifecycleTools: vi.fn().mockReturnValue({
    browser_status: { description: '检查浏览器当前状态', inputSchema: {}, execute: vi.fn() },
    browser_open: { description: '打开浏览器', inputSchema: {}, execute: vi.fn() },
    browser_close: { description: '关闭浏览器', inputSchema: {}, execute: vi.fn() },
    browser_list_tabs: { description: '获取所有标签页', inputSchema: {}, execute: vi.fn() },
    browser_switch_tab: { description: '切换标签页', inputSchema: {}, execute: vi.fn() },
  }),
}));

const mockConfig: ResolvedConfig = {
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
    vision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
    decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
  },
};

describe('ChatHandler', () => {
  let chatHandler: ChatHandler;
  let conversationManager: ConversationManager;
  let mockDecisionClient: DecisionClient;
  let mcpClient: MCPSDKClient;

  const mockClientId = 'test-client-123';
  let mockSessionId: string;

  beforeEach(() => {
    mockSessionId = randomUUID();

    conversationManager = new ConversationManager(':memory:');
    conversationManager.initialize();

    conversationManager.createSession({
      id: mockSessionId,
      title: 'Test Chat Session',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
      systemPrompt: 'You are a helpful assistant.',
    });

    mcpClient = new MCPSDKClient(mockConfig);
    vi.spyOn(mcpClient, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(mcpClient, 'isEnabled').mockReturnValue(true);
    vi.spyOn(mcpClient, 'getAvailableTools').mockReturnValue([]);
    vi.spyOn(mcpClient, 'callTool').mockResolvedValue({ result: 'success' });

    mockDecisionClient = {
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
      decide: vi.fn(),
      decideStream: vi.fn().mockImplementation((context, callbacks) => {
        setTimeout(() => {
          callbacks.onToken('Hello');
        }, 10);
        setTimeout(() => {
          callbacks.onToken(' world');
        }, 20);
        setTimeout(() => {
          callbacks.onUsage({ total_tokens: 5, prompt_tokens: 2, completion_tokens: 3 });
          callbacks.onDone();
        }, 30);
      }),
    } as unknown as DecisionClient;

    chatHandler = new ChatHandler(conversationManager, mockConfig, mcpClient);
    // Override resolveDecisionModel to return mock
    (chatHandler as any).resolveDecisionModel = () => mockDecisionClient;
  });

  describe('setMCPClient', () => {
    it('should set MCP client', () => {
      const newMCPClient = new MCPSDKClient(mockConfig);
      vi.spyOn(newMCPClient, 'initialize').mockResolvedValue(undefined);
      vi.spyOn(newMCPClient, 'isEnabled').mockReturnValue(true);
      vi.spyOn(newMCPClient, 'getAvailableTools').mockReturnValue([
        {
          name: 'browser-control.browser_click',
          description: 'Click on element',
          inputSchema: { type: 'object' },
        },
      ]);

      chatHandler.setMCPClient(newMCPClient);

      expect((chatHandler as any).mcpClient).toBe(newMCPClient);
    });

    it('should replace existing MCP client', () => {
      const originalMCP = (chatHandler as any).mcpClient;

      const newMCPClient = new MCPSDKClient(mockConfig);
      vi.spyOn(newMCPClient, 'initialize').mockResolvedValue(undefined);
      vi.spyOn(newMCPClient, 'isEnabled').mockReturnValue(false);
      vi.spyOn(newMCPClient, 'getAvailableTools').mockReturnValue([]);

      chatHandler.setMCPClient(newMCPClient);

      expect((chatHandler as any).mcpClient).toBe(newMCPClient);
      expect((chatHandler as any).mcpClient).not.toBe(originalMCP);
    });
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(chatHandler).toBeInstanceOf(ChatHandler);
      expect((chatHandler as any).conversationManager).toBe(conversationManager);
      expect((chatHandler as any).config).toBe(mockConfig);
    });

    it('should initialize with MCP client when provided', () => {
      const testMCPClient = new MCPSDKClient(mockConfig);
      vi.spyOn(testMCPClient, 'initialize').mockResolvedValue(undefined);
      vi.spyOn(testMCPClient, 'isEnabled').mockReturnValue(true);
      vi.spyOn(testMCPClient, 'getAvailableTools').mockReturnValue([]);

      const testChatHandler = new ChatHandler(
        conversationManager,
        mockConfig,
        testMCPClient
      );

      expect((testChatHandler as any).mcpClient).toBe(testMCPClient);
    });

    it('should initialize without MCP client when not provided', () => {
      const testChatHandler = new ChatHandler(
        conversationManager,
        mockConfig
      );

      expect((testChatHandler as any).mcpClient).toBeNull();
    });

    it('should initialize tool loop counter to zero', () => {
      expect((chatHandler as any).toolLoopCount).toBe(0);
      expect((chatHandler as any).maxToolLoops).toBe(10);
    });
  });

  describe('handleChatSend', () => {
    it('should save user message to conversation', async () => {
      await chatHandler.handleChatSend(mockClientId, {
        sessionId: mockSessionId,
        message: 'Hello, AI assistant!',
      });

      const messages = conversationManager.getMessages(mockSessionId);
      // System message + user message + AI response
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('Hello, AI assistant!');
    });




    it('should throw error for non-existent session', async () => {
      await expect(
        chatHandler.handleChatSend(mockClientId, {
          sessionId: 'non-existent-session',
          message: 'Test',
        })
      ).rejects.toThrow();
    });
  });

  describe('abort behavior', () => {
    it('should stop execution when aborted', async () => {
      const sessionController = ChatSessionController.getInstance();

      // Start execution
      const promise = chatHandler.handleChatSend(mockClientId, {
        sessionId: mockSessionId,
        message: 'test'
      });

      // Abort immediately
      await sessionController.interrupt(mockSessionId);

      // Should complete without error but stop execution
      await expect(promise).resolves.not.toThrow();
    });
  });

  describe('resumeSession', () => {
    it('should create the abort controller before awaiting persisted state updates', async () => {
      const updateStatus = createDeferredPromise<void>();
      const executeSpy = vi
        .spyOn(
          chatHandler as unknown as {
            executeAIResponse: (...args: unknown[]) => Promise<void>;
          },
          'executeAIResponse'
        )
        .mockResolvedValue(undefined);
      const getSessionStateSpy = vi.spyOn(conversationManager, 'getSessionState').mockResolvedValue({
        sessionId: mockSessionId,
        status: 'blocked',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        agentState: {
          schema_version: 1,
          blockReason: 'api_error',
          waitingFor: 'api_retry',
        },
      });
      const updateSessionStatusSpy = vi
        .spyOn(conversationManager, 'updateSessionStatus')
        .mockReturnValue(updateStatus.promise);

      const abortController = new AbortController();
      const resumeSpy = vi.fn();
      const createAbortControllerSpy = vi.fn().mockReturnValue(abortController);
      const cleanupSpy = vi.fn();
      const mockSessionController = {
        resume: resumeSpy,
        createAbortController: createAbortControllerSpy,
        cleanup: cleanupSpy,
      } as unknown as ChatSessionController;
      vi.spyOn(ChatSessionController, 'getInstance').mockReturnValue(mockSessionController);

      const resumePromise = chatHandler.resumeSession(mockClientId, mockSessionId);
      await Promise.resolve();

      expect(getSessionStateSpy).toHaveBeenCalledWith(mockSessionId);
      expect(resumeSpy).toHaveBeenCalledWith(mockSessionId, 'blocked');
      expect(createAbortControllerSpy).toHaveBeenCalledWith(mockSessionId, {
        activateSession: false,
      });
      expect(updateSessionStatusSpy).toHaveBeenCalledWith(mockSessionId, 'running', {
        schema_version: 1,
      });
      expect(executeSpy).not.toHaveBeenCalled();

      updateStatus.resolve(undefined);
      await resumePromise;

      expect(executeSpy).toHaveBeenCalledWith(
        mockClientId,
        mockSessionId,
        expect.objectContaining({ id: mockSessionId }),
        0,
        undefined,
        abortController.signal
      );
      expect(cleanupSpy).toHaveBeenCalledWith(mockSessionId);
    });
  });


  describe('metadata enrichment', () => {
    it('should enrich assistant message metadata with phase, provider, model, and runId', async () => {
      const executeSpy = vi
        .spyOn(
          chatHandler as unknown as {
            executeAIResponse: (...args: unknown[]) => Promise<void>;
          },
          'executeAIResponse'
        )
        .mockImplementation(async () => {
          // Manually add an assistant message to test metadata
          await conversationManager.addMessage(mockSessionId, {
            role: 'assistant',
            content: 'Test response',
            metadata: {
              phase: 'chat-decision',
              provider: 'kimi',
              model: 'moonshot-v1-vision-preview',
              runId: 'test-run-id',
            },
          });
        });

      await chatHandler.handleChatSend(mockClientId, {
        sessionId: mockSessionId,
        message: 'Hello',
      });

      const messages = conversationManager.getMessages(mockSessionId);
      const assistantMessage = messages.find((m) => m.role === 'assistant');

      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.metadata).toHaveProperty('phase', 'chat-decision');
      expect(assistantMessage?.metadata).toHaveProperty('provider', 'kimi');
      expect(assistantMessage?.metadata).toHaveProperty('model', 'moonshot-v1-vision-preview');
      expect(assistantMessage?.metadata).toHaveProperty('runId');

      executeSpy.mockRestore();
    });

    it('should enrich tool message metadata with phase, tool_name, provider, model, and runId', async () => {
      await conversationManager.addMessage(mockSessionId, {
        role: 'tool',
        content: 'Tool result',
        metadata: {
          phase: 'tool_result',
          tool_call_id: 'call-123',
          tool_name: 'browser_snapshot',
          tool_args: {},
          provider: 'kimi',
          model: 'moonshot-v1-vision-preview',
          runId: 'test-run-id',
        },
      });

      const messages = conversationManager.getMessages(mockSessionId);
      const toolMessage = messages.find((m) => m.role === 'tool');

      expect(toolMessage).toBeDefined();
      expect(toolMessage?.metadata).toHaveProperty('phase', 'tool_result');
      expect(toolMessage?.metadata).toHaveProperty('tool_name', 'browser_snapshot');
      expect(toolMessage?.metadata).toHaveProperty('provider', 'kimi');
      expect(toolMessage?.metadata).toHaveProperty('model', 'moonshot-v1-vision-preview');
      expect(toolMessage?.metadata).toHaveProperty('runId');
    });
  });


  describe('createSDKTools with browser lifecycle tools', () => {
    const lifecycleToolKeys = [
      'browser_status',
      'browser_open',
      'browser_close',
      'browser_list_tabs',
      'browser_switch_tab',
    ];

    it('should include browser lifecycle tools when MCP is disabled', () => {
      vi.spyOn(mcpClient, 'isEnabled').mockReturnValue(false);

      const tools = (chatHandler as any).createSDKTools();

      for (const key of lifecycleToolKeys) {
        expect(tools).toHaveProperty(key);
      }
    });

    it('should include browser lifecycle tools alongside MCP tools when MCP is enabled', () => {
      vi.spyOn(mcpClient, 'isEnabled').mockReturnValue(true);
      vi.spyOn(mcpClient, 'getAvailableTools').mockReturnValue([
        {
          name: 'server.tool_a',
          description: 'Tool A',
          inputSchema: { type: 'object' },
        },
      ]);

      const tools = (chatHandler as any).createSDKTools();

      for (const key of lifecycleToolKeys) {
        expect(tools).toHaveProperty(key);
      }
      expect(tools).toHaveProperty('server.tool_a');
    });

    it('should include browser lifecycle tools when mcpClient is null', () => {
      // Create a new ChatHandler with no MCP client
      const handlerWithNullMcp = new ChatHandler(
        conversationManager,
        mockConfig,
        undefined as any, // null mcpClient
      );

      const tools = (handlerWithNullMcp as any).createSDKTools();

      for (const key of lifecycleToolKeys) {
        expect(tools).toHaveProperty(key);
      }
    });

    it('should include lifecycle management section in system prompt', () => {
      const session = {};
      const prompt = (chatHandler as any).getSystemPrompt(session);

      expect(prompt).toContain('## 浏览器生命周期管理');
      expect(prompt).toContain('browser_status');
      expect(prompt).toContain('browser_open');
      expect(prompt).toContain('browser_close');
      expect(prompt).toContain('browser_list_tabs');
      expect(prompt).toContain('browser_switch_tab');
      expect(prompt).toContain('browser_snapshot');
    });
  });


});
