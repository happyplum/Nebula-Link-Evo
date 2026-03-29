import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../action-executor.js';
import type { StepContext, StepResult } from '../step-runner.js';
import type { ResolvedConfig } from '../../config/schema.js';

const {
  mockRunStep,
  mockExecute,
  mockSleep,
  mockOpenBrowser,
  mockNavigate,
  mockCloseBrowser,
} = vi.hoisted(() => ({
  mockRunStep: vi.fn(),
  mockExecute: vi.fn(),
  mockSleep: vi.fn().mockResolvedValue(undefined),
  mockOpenBrowser: vi.fn().mockResolvedValue(undefined),
  mockNavigate: vi.fn().mockResolvedValue(undefined),
  mockCloseBrowser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../step-runner.js', () => ({
  StepRunner: vi.fn().mockImplementation(() => ({
    runStep: mockRunStep,
    sleep: mockSleep,
  })),
}));

vi.mock('../action-executor.js', () => ({
  ActionExecutor: vi.fn().mockImplementation(() => ({
    execute: mockExecute,
  })),
}));

vi.mock('../../browser-client.js', () => ({
  browserClient: {
    openBrowser: mockOpenBrowser,
    navigate: mockNavigate,
    closeBrowser: mockCloseBrowser,
  },
}));

vi.mock('../../websocket-manager.js', () => ({
  DebugWebSocketManager: {
    getInstance: vi.fn(() => ({
      broadcast: vi.fn(),
    })),
  },
}));

vi.mock('../../skills/manager.js', () => ({
  SkillManager: vi.fn(),
}));

vi.mock('../../debug/history.js', () => ({
  HistoryManager: class {
    add = vi.fn();
    update = vi.fn();
    get = vi.fn().mockReturnValue([]);
    getById = vi.fn().mockReturnValue(null);
    clear = vi.fn();
  },
}));

import { TaskOrchestrator } from '../task-orchestrator.js';

function createStepResult(overrides?: Partial<StepResult>): StepResult {
  return {
    action: { type: 'click', params: { x: 1, y: 2 }, reasoning: 'test' },
    result: {
      action: { type: 'click', params: { x: 1, y: 2 } },
      success: true,
      message: 'ok',
    },
    screenshot: 'base64data',
    dom: {
      snapshot_id: 'snap-1',
      version: '2.0',
      annotated_screenshot_base64: '',
      elements_map: {},
      simplified_dom: { elements: [], viewport: { width: 1280, height: 720 } },
    },
    isFinished: true,
    ...overrides,
  };
}

describe('TaskOrchestrator', () => {
  let orchestrator: TaskOrchestrator;

  const mockConfig = {
    settings: { maxSteps: 5, timeout: 30, maxRetries: 3, temperature: 0.7, maxTokens: 4096 },
    defaults: { mode: 'separation' as const, vision: { provider: 'glm', model: 'glm-4v' }, decision: { provider: 'glm', model: 'glm-4' } },
    providers: {},
    mcp: { enabled: false, servers: {} },
    version: '1',
    _resolved: { providers: {}, settings: { maxSteps: 5, timeout: 30, maxRetries: 3, temperature: 0.7, maxTokens: 4096 } },
  } as unknown as ResolvedConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    orchestrator = new TaskOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      actionExecutor: { execute: mockExecute } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stepRunner: { runStep: mockRunStep, sleep: mockSleep } as any,
      getConfig: () => mockConfig,
    });
  });

  describe('executeAITask — session model config propagation', () => {
    it('passes session from context to stepRunner.runStep', async () => {
      const session = {
        provider: 'openai',
        model: 'gpt-4o',
        vision_provider: 'anthropic',
        vision_model: 'claude-3-5-sonnet',
      };

      mockRunStep.mockResolvedValue(createStepResult());

      await orchestrator.execute({
        url: 'https://example.com',
        instruction: 'test',
        context: { session },
      });

      expect(mockRunStep).toHaveBeenCalledTimes(1);
      const stepContext = mockRunStep.mock.calls[0]![0] as StepContext;
      expect(stepContext.session).toEqual(session);
    });

    it('passes session with null vision fields to stepRunner.runStep (fallback scenario)', async () => {
      const session = {
        provider: 'glm',
        model: 'glm-4.7-flash',
        vision_provider: null,
        vision_model: null,
      };

      mockRunStep.mockResolvedValue(createStepResult());

      await orchestrator.execute({
        url: 'https://example.com',
        instruction: 'test',
        context: { session },
      });

      const stepContext = mockRunStep.mock.calls[0]![0] as StepContext;
      expect(stepContext.session).toEqual(session);
      expect(stepContext.session!.vision_provider).toBeNull();
      expect(stepContext.session!.vision_model).toBeNull();
    });

    it('passes undefined session when context has no session', async () => {
      mockRunStep.mockResolvedValue(createStepResult());

      await orchestrator.execute({
        url: 'https://example.com',
        instruction: 'test',
        context: { maxSteps: 2 },
      });

      const stepContext = mockRunStep.mock.calls[0]![0] as StepContext;
      expect(stepContext.session).toBeUndefined();
    });

    it('passes undefined session when context is empty', async () => {
      mockRunStep.mockResolvedValue(createStepResult());

      await orchestrator.execute({
        url: 'https://example.com',
        instruction: 'test',
      });

      const stepContext = mockRunStep.mock.calls[0]![0] as StepContext;
      expect(stepContext.session).toBeUndefined();
    });

    it('passes all StepContext fields alongside session', async () => {
      const session = {
        provider: 'kimi',
        model: 'moonshot-v1',
        vision_provider: 'openai',
        vision_model: 'gpt-4.1-mini',
      };

      mockRunStep.mockResolvedValue(createStepResult());

      await orchestrator.execute({
        url: 'https://example.com',
        instruction: 'do stuff',
        context: { session, maxSteps: 3 },
      });

      const stepContext = mockRunStep.mock.calls[0]![0] as StepContext;
      expect(stepContext.taskId).toBeDefined();
      expect(stepContext.url).toBe('https://example.com');
      expect(stepContext.instruction).toBe('do stuff');
      expect(stepContext.maxSteps).toBe(3);
      expect(Array.isArray(stepContext.previousActions)).toBe(true);
      expect(stepContext.session).toEqual(session);
    });
  });
});
