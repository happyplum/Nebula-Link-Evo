import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRequest } from '../../types.js';

const {
  mockOrchestratorExecute,
} = vi.hoisted(() => ({
  mockOrchestratorExecute: vi.fn(),
}));

vi.mock('../../config/index.js', () => ({
  loadConfig: vi.fn(() => ({
    config: {
      providers: {},
      defaults: { mode: 'separation', vision: { provider: 'glm', model: 'glm-4v' }, decision: { provider: 'glm', model: 'glm-4' } },
      settings: { timeout: 30, maxRetries: 3, temperature: 0.7, maxTokens: 4096, maxSteps: 5 },
      mcp: { enabled: false, servers: {} },

    },
    configPath: '/test/config.json',
    result: { success: true, warnings: [], errors: [] },
  })),
  validateConfig: vi.fn(() => ({ valid: true, warnings: [], errors: [] })),
}));

vi.mock('../../websocket-manager.js', () => ({
  DebugWebSocketManager: {
    getInstance: vi.fn(() => ({
      setMCPStatusProvider: vi.fn(),
      setTaskCommandHandler: vi.fn(),
      broadcast: vi.fn(),
    })),
  },
}));

vi.mock('../../services/action-executor.js', () => ({
  ActionExecutor: class {
    setMCPClient = vi.fn();
    execute = vi.fn().mockResolvedValue({ success: true });
  },
}));

vi.mock('../../services/step-runner.js', () => ({
  StepRunner: class {},
}));

vi.mock('../../services/task-orchestrator.js', () => ({
  TaskOrchestrator: class {
    execute = mockOrchestratorExecute;
    getHistory = vi.fn().mockReturnValue([]);
    getHistoryById = vi.fn().mockReturnValue(null);
    clearHistory = vi.fn();
  },
}));

vi.mock('../../clients/mcp/sdk-client.js', () => ({
  MCPSDKClient: class {
    initialize = vi.fn().mockResolvedValue(undefined);
    isEnabled = vi.fn().mockReturnValue(false);
    getServerList = vi.fn().mockReturnValue([]);
    getAvailableTools = vi.fn().mockReturnValue([]);
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../clients/vercel-ai/streaming.js', () => ({
  streamTask: vi.fn().mockResolvedValue(undefined),
}));

import { TaskService } from '../task-service.js';

describe('TaskService — session config propagation', () => {
  let taskService: TaskService;

  beforeEach(async () => {
    vi.clearAllMocks();
    TaskService['instance'] = null;
    taskService = new TaskService();
    await taskService.initialize();

    mockOrchestratorExecute.mockResolvedValue({
      success: true,
      url: 'https://example.com',
      actions: [],
      result: 'Task completed',
    });
  });

  it('passes request with session in context to orchestrator', async () => {
    const request: TaskRequest = {
      url: 'https://example.com',
      instruction: 'test',
      context: {
        session: {
          provider: 'openai',
          model: 'gpt-4o',
          vision_provider: 'anthropic',
          vision_model: 'claude-3-5-sonnet',
        },
      },
    };

    await taskService.execute(request);

    expect(mockOrchestratorExecute).toHaveBeenCalledWith(request);
  });

  it('passes request without session to orchestrator unchanged', async () => {
    const request: TaskRequest = {
      url: 'https://example.com',
      instruction: 'test',
      context: { maxSteps: 5 },
    };

    await taskService.execute(request);

    expect(mockOrchestratorExecute).toHaveBeenCalledWith(request);
  });

  it('passes request with null vision session fields to orchestrator', async () => {
    const request: TaskRequest = {
      url: 'https://example.com',
      instruction: 'test',
      context: {
        session: {
          provider: 'glm',
          model: 'glm-4.7-flash',
          vision_provider: null,
          vision_model: null,
        },
      },
    };

    await taskService.execute(request);

    expect(mockOrchestratorExecute).toHaveBeenCalledWith(request);
    const calledRequest = mockOrchestratorExecute.mock.calls[0]![0] as TaskRequest;
    expect(calledRequest.context!.session).toEqual({
      provider: 'glm',
      model: 'glm-4.7-flash',
      vision_provider: null,
      vision_model: null,
    });
  });

  it('does not import from clients/vision or clients/decision', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const taskServiceSrc = fs.readFileSync(
      path.resolve('src/services/task-service.ts'),
      'utf-8',
    );

    expect(taskServiceSrc).not.toContain('clients/vision/');
    expect(taskServiceSrc).not.toContain('clients/decision/');
  });
});
