/**
 * Unit tests for TaskService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskService } from '../../../services/task-service.js';

// Mock all dependencies
vi.mock('../../../services/action-executor.js', () => {
  const mockActionExecutor = class {
    setMCPClient = vi.fn();
    execute = vi.fn();
  };
  return {
    ActionExecutor: mockActionExecutor,
  };
});

vi.mock('../../../services/step-runner.js', () => ({
  StepRunner: vi.fn(),
}));

vi.mock('../../../services/task-orchestrator.js', () => {
  const mockTaskOrchestrator = class {
    execute = vi.fn();
    getHistory = vi.fn();
    getHistoryById = vi.fn();
    clearHistory = vi.fn();
  };
  return {
    TaskOrchestrator: mockTaskOrchestrator,
  };
});

vi.mock('../../../clients/mcp/sdk-client.js', () => {
  const mockMCPSDKClient = class {
    initialize = vi.fn().mockResolvedValue(undefined);
    shutdown = vi.fn().mockResolvedValue(undefined);
    isEnabled = vi.fn().mockReturnValue(true);
    getServerList = vi.fn().mockReturnValue([]);
    getAvailableTools = vi.fn().mockReturnValue([]);
  };
  return {
    MCPSDKClient: mockMCPSDKClient,
  };
});

vi.mock('../../../config/index.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    config: {
      providers: {},
      defaults: { mode: 'separation' },
      _resolved: { providers: {} },
    },
    configPath: '/path/to/config.json',
    result: { errors: [] },
  }),
  validateConfig: vi.fn().mockReturnValue({
    valid: true,
    errors: [],
    warnings: [],
  }),
}));

vi.mock('../../../websocket-manager.js', () => ({
  DebugWebSocketManager: {
    getInstance: vi.fn().mockReturnValue({
      setMCPStatusProvider: vi.fn(),
      setTaskCommandHandler: vi.fn(),
      broadcast: vi.fn(),
    }),
  },
}));

describe('TaskService', () => {
  let taskService: TaskService;

  beforeEach(() => {
    vi.clearAllMocks();
    taskService = new TaskService();
  });

  describe('constructor', () => {
    it('should initialize with null config', () => {
      expect(taskService).toBeDefined();
      expect(taskService['config']).toBeNull();
    });

    it('should initialize DebugWebSocketManager', async () => {
      const { DebugWebSocketManager } = await import('../../../websocket-manager.js');
      expect(DebugWebSocketManager.getInstance).toHaveBeenCalled();
    });

    it('should initialize ActionExecutor', async () => {
      // ActionExecutor is initialized in constructor with mcpClient: null
      expect(taskService.getActionExecutor()).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should load config successfully', async () => {
      await taskService.initialize();
      expect(taskService['config']).not.toBeNull();
    });

    it('should validate config', async () => {
      await taskService.initialize();
      const configModule = await import('../../../config/index.js');
      expect(configModule.validateConfig).toHaveBeenCalled();
    });

    it('should initialize MCP client', async () => {
      await taskService.initialize();
      expect(taskService.getMCPSDKClient()).not.toBeNull();
    });

    it('should create provider registry', async () => {
      await taskService.initialize();
      expect(taskService.getRegistry()).not.toBeNull();
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
      expect(taskService.getConfigPath()).toBe('/path/to/config.json');
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

  describe('getActionExecutor', () => {
    it('should return action executor', () => {
      const executor = taskService.getActionExecutor();
      expect(executor).toBeDefined();
      expect(executor.setMCPClient).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should throw error if not initialized', async () => {
      await expect(
        taskService.execute({
          url: 'https://example.com',
          instruction: 'test',
        })
      ).rejects.toThrow('TaskService not initialized');
    });

    it('should execute task through orchestrator', async () => {
      await taskService.initialize();
      const orchestrator = taskService.getTaskOrchestrator();
      const mockResult = { success: true, actions: [] };
      orchestrator!.execute = vi.fn().mockResolvedValue(mockResult);

      const result = await taskService.execute({
        url: 'https://example.com',
        instruction: 'test',
      });

      expect(result).toEqual(mockResult);
    });
  });

  describe('getHistory', () => {
    it('should return empty array before initialization', () => {
      expect(taskService.getHistory()).toEqual([]);
    });

    it('should call orchestrator getHistory', async () => {
      await taskService.initialize();
      const orchestrator = taskService.getTaskOrchestrator();
      const mockHistory = [{ id: '1', instruction: 'test' }];
      orchestrator!.getHistory = vi.fn().mockReturnValue(mockHistory);

      const history = taskService.getHistory();
      expect(history).toEqual(mockHistory);
    });

    it('should pass limit to orchestrator', async () => {
      await taskService.initialize();
      const orchestrator = taskService.getTaskOrchestrator();
      const mockHistory = [{ id: '1' }];
      orchestrator!.getHistory = vi.fn().mockReturnValue(mockHistory);

      taskService.getHistory(10);
      expect(orchestrator!.getHistory).toHaveBeenCalledWith(10);
    });
  });

  describe('getHistoryById', () => {
    it('should return null before initialization', () => {
      expect(taskService.getHistoryById('1')).toBeNull();
    });

    it('should call orchestrator getHistoryById', async () => {
      await taskService.initialize();
      const orchestrator = taskService.getTaskOrchestrator();
      const mockEntry = { id: '1', instruction: 'test' };
      orchestrator!.getHistoryById = vi.fn().mockReturnValue(mockEntry);

      const entry = taskService.getHistoryById('1');
      expect(entry).toEqual(mockEntry);
    });
  });

  describe('clearHistory', () => {
    it('should not throw before initialization', () => {
      expect(() => taskService.clearHistory()).not.toThrow();
    });

    it('should call orchestrator clearHistory', async () => {
      await taskService.initialize();
      const orchestrator = taskService.getTaskOrchestrator();
      const clearHistoryMock = vi.fn();
      orchestrator!.clearHistory = clearHistoryMock;

      taskService.clearHistory();
      expect(clearHistoryMock).toHaveBeenCalled();
    });
  });

  describe('getMCPStatus', () => {
    it('should return disabled status before initialization', () => {
      const status = taskService.getMCPStatus();
      expect(status).toEqual({
        enabled: false,
        servers: [],
      });
    });

    it('should return MCP status after initialization', async () => {
      await taskService.initialize();
      const status = taskService.getMCPStatus();
      expect(status.enabled).toBe(true);
      expect(status.servers).toEqual([]);
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
      expect(tools).toEqual([]);
    });
  });

  describe('getMCPSDKClient', () => {
    it('should return null before initialization', () => {
      const client = taskService.getMCPSDKClient();
      expect(client).toBeNull();
    });

    it('should return MCP client after initialization', async () => {
      await taskService.initialize();
      const client = taskService.getMCPSDKClient();
      expect(client).not.toBeNull();
    });
  });

  describe('shutdown', () => {
    it('should not throw when MCP client is null', async () => {
      await expect(taskService.shutdown()).resolves.not.toThrow();
    });

    it('should shutdown MCP client', async () => {
      await taskService.initialize();
      await taskService.shutdown();
      const mcpClient = taskService.getMCPSDKClient();
      expect(mcpClient!.shutdown).toHaveBeenCalled();
    });
  });

  describe('executeAction', () => {
    it('should execute action through action executor', async () => {
      const mockResult = { success: true, message: 'Action executed' };
      const executor = taskService.getActionExecutor();
      executor.execute = vi.fn().mockResolvedValue(mockResult);

      const result = await taskService.executeAction({
        type: 'click',
        params: { x: 100, y: 200 },
      });

      expect(result).toEqual(mockResult);
    });
  });

  describe('static getInstance', () => {
    beforeEach(() => {
      TaskService['instance'] = null;
    });

    it('should create singleton instance', () => {
      const instance1 = TaskService.getInstance();
      const instance2 = TaskService.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should return same instance on multiple calls', () => {
      const instance1 = TaskService.getInstance();
      const instance2 = TaskService.getInstance();
      const instance3 = TaskService.getInstance();
      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });
  });

  describe('static setInstance', () => {
    it('should set singleton instance', () => {
      const customInstance = new TaskService();
      TaskService.setInstance(customInstance);
      expect(TaskService.getInstance()).toBe(customInstance);
    });
  });
});
