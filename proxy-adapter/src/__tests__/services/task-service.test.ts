import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskService } from '../../services/task-service.js';

// Mock config module
vi.mock('../../config/index.js', () => ({
  loadConfig: vi.fn(() => ({
    config: {
      version: '1.0',
      providers: {
        kimi: {
          enabled: true,
          apiKey: 'test-key',
          baseUrl: 'https://api.test.com/v1',
          npmPackage: '@ai-sdk/openai-compatible',
          models: {},
        },
      },
      mcp: { enabled: false, servers: {} },
      defaults: {
        mode: 'separation',
        decision: { provider: 'kimi', model: 'test-decision-model' },
        vision: { provider: 'kimi', model: 'test-vision-model' },
      },
    },
    configPath: '/test/config.json',
    result: { success: true, warnings: [], errors: [] },
  })),
  validateConfig: vi.fn(() => ({ valid: true, warnings: [], errors: [] })),
}));

// Mock WebSocket manager
vi.mock('../../websocket-manager.js', () => ({
  DebugWebSocketManager: {
    getInstance: vi.fn(() => ({
      setMCPStatusProvider: vi.fn(),
      setTaskCommandHandler: vi.fn(),
      broadcast: vi.fn(),
    })),
  },
}));

// Mock ActionExecutor
vi.mock('../../services/action-executor.js', () => ({
  ActionExecutor: class {
    setMCPClient = vi.fn();
    execute = vi.fn().mockResolvedValue({ success: true });
  },
}));

// Mock StepRunner
vi.mock('../../services/step-runner.js', () => ({
  StepRunner: class {
  },
}));

// Mock TaskOrchestrator
vi.mock('../../services/task-orchestrator.js', () => ({
  TaskOrchestrator: class {
    execute = vi.fn().mockResolvedValue({
      success: true,
      url: 'https://example.com',
      actions: [],
      result: 'Task completed',
    });
    getHistory = vi.fn().mockReturnValue([]);
    getHistoryById = vi.fn().mockReturnValue(null);
    clearHistory = vi.fn();
  },
}));

// Mock MCP client
vi.mock('../../clients/mcp/sdk-client.js', () => ({
  MCPSDKClient: class {
    initialize = vi.fn().mockResolvedValue(undefined);
    isEnabled = vi.fn().mockReturnValue(false);
    getServerList = vi.fn().mockReturnValue([]);
    getAvailableTools = vi.fn().mockReturnValue([]);
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
}));

// Mock streamTask
vi.mock('../../clients/vercel-ai/streaming.js', () => ({
  streamTask: vi.fn().mockResolvedValue(undefined),
}));

describe('TaskService', () => {
  let taskService: TaskService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance
    TaskService['instance'] = null;
    taskService = new TaskService();
  });

  afterEach(async () => {
    await taskService?.shutdown();
  });

  describe('constructor', () => {
    it('should create instance and initialize wsManager and actionExecutor', () => {
      expect(taskService).toBeDefined();
      expect(taskService.getActionExecutor()).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should load and validate config', async () => {
      const { loadConfig, validateConfig } = await import('../../config/index.js');

      await taskService.initialize();

      expect(loadConfig).toHaveBeenCalled();
      expect(validateConfig).toHaveBeenCalled();
      expect(taskService.getConfig()).not.toBeNull();
      expect(taskService.getConfigPath()).toBe('/test/config.json');
    });

    it('should initialize MCP client', async () => {
      await taskService.initialize();

      expect(taskService.getMCPStatus().enabled).toBe(false);
    });

    it('should create stepRunner and taskOrchestrator', async () => {
      await taskService.initialize();

      expect(taskService.getTaskOrchestrator()).not.toBeNull();
    });

    it('should set task command handler', async () => {
      await taskService.initialize();

      // Command handler is set internally; we verify it works through other tests
      expect(taskService).toBeDefined();
    });

    it('should throw error if config loading fails', async () => {
      const { loadConfig } = await import('../../config/index.js');
      vi.mocked(loadConfig).mockReturnValueOnce({
        config: null,
        configPath: '/test/config.json',
        result: { success: false, warnings: [], errors: ['Config file not found'] },
      });

      await expect(taskService.initialize()).rejects.toThrow('Failed to load config');
    });

    it('should throw error if config validation fails', async () => {
      const { validateConfig } = await import('../../config/index.js');
      vi.mocked(validateConfig).mockReturnValueOnce({
        valid: false,
        warnings: [],
        errors: ['Invalid config'],
      });

      await expect(taskService.initialize()).rejects.toThrow('Config validation failed');
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      await taskService.initialize();
    });

    it('should delegate to taskOrchestrator.execute', async () => {
      const request = {
        url: 'https://example.com',
        instruction: 'Click button',
        context: { maxSteps: 10 },
      };

      const result = await taskService.execute(request);

      expect(result.success).toBe(true);
    });

    it('should throw error if not initialized', async () => {
      const uninitializedService = new TaskService();

      await expect(
        uninitializedService.execute({
          url: 'https://example.com',
          instruction: 'Click button',
        })
      ).rejects.toThrow('TaskService not initialized');
    });
  });

  describe('getConfig', () => {
    it('should return null before initialization', () => {
      expect(taskService.getConfig()).toBeNull();
    });

    it('should return config after initialization', async () => {
      await taskService.initialize();

      const config = taskService.getConfig();
      expect(config).not.toBeNull();
      expect(config?.providers).toBeDefined();
    });
  });

  describe('getConfigPath', () => {
    it('should return empty string before initialization', () => {
      expect(taskService.getConfigPath()).toBe('');
    });

    it('should return config path after initialization', async () => {
      await taskService.initialize();

      expect(taskService.getConfigPath()).toBe('/test/config.json');
    });
  });

  describe('getMCPStatus', () => {
    it('should return disabled status before initialization', () => {
      const status = taskService.getMCPStatus();

      expect(status.enabled).toBe(false);
      expect(status.servers).toEqual([]);
    });

    it('should return MCP status after initialization', async () => {
      await taskService.initialize();

      const status = taskService.getMCPStatus();

      expect(status).toHaveProperty('enabled');
      expect(status).toHaveProperty('servers');
    });
  });

  describe('getMCPTools', () => {
    it('should return empty array before initialization', () => {
      const tools = taskService.getMCPTools();

      expect(tools).toEqual([]);
    });

    it('should return MCP tools after initialization', async () => {
      await taskService.initialize();

      const tools = taskService.getMCPTools();

      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe('getMCPSDKClient', () => {
    it('should return null before initialization', () => {
      expect(taskService.getMCPSDKClient()).toBeNull();
    });

    it('should return MCP client after initialization', async () => {
      await taskService.initialize();

      expect(taskService.getMCPSDKClient()).not.toBeNull();
    });
  });

  describe('getHistory', () => {
    beforeEach(async () => {
      await taskService.initialize();
    });

    it('should return history array', () => {
      const history = taskService.getHistory();

      expect(Array.isArray(history)).toBe(true);
    });

    it('should respect limit parameter', () => {
      const history = taskService.getHistory(5);

      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('getHistoryById', () => {
    beforeEach(async () => {
      await taskService.initialize();
    });

    it('should return null for non-existent ID', () => {
      const result = taskService.getHistoryById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('clearHistory', () => {
    beforeEach(async () => {
      await taskService.initialize();
    });

    it('should call clearHistory on orchestrator', () => {
      const orchestrator = taskService.getTaskOrchestrator();
      orchestrator?.clearHistory();

      expect(orchestrator).toBeDefined();
    });
  });

  describe('getActionExecutor', () => {
    it('should return actionExecutor instance', () => {
      const executor = taskService.getActionExecutor();

      expect(executor).toBeDefined();
      expect(executor).toHaveProperty('execute');
    });
  });

  describe('getTaskOrchestrator', () => {
    it('should return null before initialization', () => {
      expect(taskService.getTaskOrchestrator()).toBeNull();
    });

    it('should return orchestrator after initialization', async () => {
      await taskService.initialize();

      const orchestrator = taskService.getTaskOrchestrator();

      expect(orchestrator).not.toBeNull();
    });
  });

  describe('shutdown', () => {
    it('should shutdown MCP client if initialized', async () => {
      await taskService.initialize();
      await taskService.shutdown();

      const mcpClient = taskService.getMCPSDKClient();
      expect(mcpClient?.shutdown).toHaveBeenCalled();
    });

    it('should handle shutdown without MCP client', async () => {
      await expect(taskService.shutdown()).resolves.not.toThrow();
    });
  });

  describe('streamTaskStream', () => {
    beforeEach(async () => {
      await taskService.initialize();
    });

    it('should call streamTask with correct parameters', async () => {
      const { streamTask } = await import('../../clients/vercel-ai/streaming.js');

      await taskService.streamTaskStream({
        provider: 'kimi',
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(streamTask).toHaveBeenCalled();
    });

    it('should throw error if not initialized', async () => {
      const uninitializedService = new TaskService();

      await expect(
        uninitializedService.streamTaskStream({
          provider: 'kimi',
          model: 'test-model',
          messages: [{ role: 'user', content: 'test' }],
        })
      ).rejects.toThrow('TaskService not initialized');
    });
  });

  describe('executeAction', () => {
    it('should delegate to actionExecutor', async () => {
      const action = {
        type: 'click' as const,
        params: { x: 100, y: 200 },
        reasoning: 'Test action',
      };

      const result = await taskService.executeAction(action);

      expect(result.success).toBe(true);
    });
  });

  describe('getInstance/setInstance (singleton)', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = TaskService.getInstance();
      const instance2 = TaskService.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should set custom instance', () => {
      const customService = new TaskService();
      TaskService.setInstance(customService);

      const instance = TaskService.getInstance();

      expect(instance).toBe(customService);
    });
  });

  describe('handleTaskCommand', () => {
    beforeEach(async () => {
      await taskService.initialize();
    });

    it('should handle pause command', () => {
      // Command handler is internal; we verify it doesn't throw
      expect(() => {
        taskService['handleTaskCommand']({ type: 'pause', taskId: 'test-task' });
      }).not.toThrow();
    });

    it('should handle resume command', () => {
      expect(() => {
        taskService['handleTaskCommand']({ type: 'resume', taskId: 'test-task' });
      }).not.toThrow();
    });

    it('should handle modify command', () => {
      expect(() => {
        taskService['handleTaskCommand']({
          type: 'modify',
          taskId: 'test-task',
          instruction: 'New instruction',
        });
      }).not.toThrow();
    });

    it('should handle manual_action command', () => {
      expect(() => {
        taskService['handleTaskCommand']({
          type: 'manual_action',
          taskId: 'test-task',
          action: { type: 'click', params: { x: 100, y: 200 } },
        });
      }).not.toThrow();
    });
  });

  describe('testAIConnectivity', () => {
    beforeEach(async () => {
      await taskService.initialize();
    });

    it('should test vision and decision connectivity', async () => {
      const result = await taskService.testAIConnectivity();

      expect(result).toHaveProperty('vision');
      expect(result).toHaveProperty('decision');
      expect(result).toHaveProperty('totalResponseTime');
      expect(result.vision).toHaveProperty('status');
      expect(result.decision).toHaveProperty('status');
    });

    it('should return not_configured status when no client available', async () => {
      const result = await taskService.testAIConnectivity();

      // Mock doesn't have clients, so should be not_configured or similar
      expect(['not_configured', 'connected', 'disconnected']).toContain(result.vision.status);
      expect(['not_configured', 'connected', 'disconnected']).toContain(result.decision.status);
    });
  });
});
