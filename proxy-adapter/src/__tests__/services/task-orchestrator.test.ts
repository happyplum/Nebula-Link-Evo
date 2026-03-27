import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../types.js';
import type { Skill } from '../../skills/schema.js';
import { createWebSocketMock } from '../../../../shared/test-utils/mocks/WebSocket.mock.js';

const {
  mockOpenBrowser,
  mockCloseBrowser,
  mockNavigate,
  mockGetSkill,
  mockBroadcast,
  mockRunStep,
  mockSleep,
  mockSend,
} = vi.hoisted(() => ({
  mockOpenBrowser: vi.fn(async () => undefined),
  mockCloseBrowser: vi.fn(async () => undefined),
  mockNavigate: vi.fn(async () => undefined),
  mockGetSkill: vi.fn(),
  mockBroadcast: vi.fn(),
  mockRunStep: vi.fn(),
  mockSleep: vi.fn(async () => undefined),
  mockSend: vi.fn(),
}));

vi.mock('../../browser-client.js', () => ({
  browserClient: {
    openBrowser: mockOpenBrowser,
    closeBrowser: mockCloseBrowser,
    navigate: mockNavigate,
  },
}));

vi.mock('../../skills/manager.js', () => ({
  SkillManager: class {
    getSkill(id: string) {
      return mockGetSkill(id);
    }
  },
}));

vi.mock('../../websocket-manager.js', () => ({
  DebugWebSocketManager: {
    getInstance: () => ({
      broadcast: mockBroadcast,
    }),
  },
}));

import { TaskOrchestrator } from '../../services/task-orchestrator.js';

describe('TaskOrchestrator', () => {
  const actionExecutor = {
    execute: vi.fn(),
  };

  const stepRunner = {
    runStep: mockRunStep,
    sleep: mockSleep,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const ws = createWebSocketMock({ initialState: 'OPEN', autoConnect: false });
    mockBroadcast.mockImplementation((payload: unknown) => {
      ws.send(JSON.stringify(payload));
      mockSend(JSON.stringify(payload));
    });

    actionExecutor.execute.mockReset();
    actionExecutor.execute.mockResolvedValue({
      action: { type: 'wait', params: { delay: 100 } },
      success: true,
      message: 'ok',
    });

    mockGetSkill.mockReset();
    mockRunStep.mockReset();
    mockSleep.mockReset();
    mockSleep.mockResolvedValue(undefined);
  });

  it('executes skill flow and transitions to completed', async () => {
    const orchestrator = new TaskOrchestrator({
      actionExecutor: actionExecutor as never,
      stepRunner: stepRunner as never,
      getConfig: () => null,
    });

    const skill: Skill = {
      id: 'skill-1',
      name: 'Skill 1',
      steps: [
        { type: 'click', params: { x: 100, y: 120 } as Record<string, unknown> },
        { type: 'finish', params: { result: 'done' } as Record<string, unknown> },
      ] as Action[],
    };
    mockGetSkill.mockReturnValue(skill);

    actionExecutor.execute
      .mockResolvedValueOnce({
        action: skill.steps[0],
        success: true,
        message: 'clicked',
      })
      .mockResolvedValueOnce({
        action: skill.steps[1],
        success: true,
        message: 'finished',
      });

    const result = await orchestrator.execute({
      url: 'https://example.com',
      instruction: 'run skill',
      skillId: 'skill-1',
      context: {},
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe('done');
    expect(result.actions).toHaveLength(2);
    expect(mockCloseBrowser).toHaveBeenCalledTimes(1);

    const history = orchestrator.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('completed');
    expect(history[0].stepCount).toBe(2);

    const eventTypes = mockBroadcast.mock.calls.map(([arg]) => (arg as { type: string }).type);
    expect(eventTypes[0]).toBe('task_started');
    expect(eventTypes).toContain('step_completed');
    expect(eventTypes[eventTypes.length - 1]).toBe('task_completed');
  });

  it('executes skill flow and transitions to completed when no finish action is present', async () => {
    const orchestrator = new TaskOrchestrator({
      actionExecutor: actionExecutor as never,
      stepRunner: stepRunner as never,
      getConfig: () => null,
    });

    const skill: Skill = {
      id: 'skill-no-finish',
      name: 'Skill No Finish',
      steps: [
        { type: 'click', params: { x: 100, y: 120 } as Record<string, unknown> },
      ] as Action[],
    };
    mockGetSkill.mockReturnValue(skill);

    actionExecutor.execute.mockResolvedValueOnce({
      action: skill.steps[0],
      success: true,
      message: 'clicked',
    });

    const result = await orchestrator.execute({
      url: 'https://example.com',
      instruction: 'run skill without finish',
      skillId: 'skill-no-finish',
      context: {},
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe('Skill completed all steps');
    expect(result.actions).toHaveLength(1);
    expect(mockCloseBrowser).toHaveBeenCalledTimes(1);

    const history = orchestrator.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('completed');
    expect(history[0].stepCount).toBe(1);

    const eventTypes = mockBroadcast.mock.calls.map(([arg]) => (arg as { type: string }).type);
    expect(eventTypes[0]).toBe('task_started');
    expect(eventTypes).toContain('step_completed');
    expect(eventTypes[eventTypes.length - 1]).toBe('task_completed');
  });

  it('fails when skill is missing and transitions to failed', async () => {
    const orchestrator = new TaskOrchestrator({
      actionExecutor: actionExecutor as never,
      stepRunner: stepRunner as never,
      getConfig: () => null,
    });

    mockGetSkill.mockReturnValue(undefined);

    const result = await orchestrator.execute({
      url: 'https://example.com',
      instruction: 'missing skill',
      skillId: 'missing',
      context: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Skill not found');
    expect(mockCloseBrowser).toHaveBeenCalledTimes(1);

    const history = orchestrator.getHistory();
    expect(history[0].status).toBe('failed');
    expect(history[0].error).toContain('Skill not found');

    const eventTypes = mockBroadcast.mock.calls.map(([arg]) => (arg as { type: string }).type);
    expect(eventTypes[0]).toBe('task_started');
    expect(eventTypes[eventTypes.length - 1]).toBe('task_failed');
  });

  it('executes AI flow and transitions to completed when finish action returned', async () => {
    const orchestrator = new TaskOrchestrator({
      actionExecutor: actionExecutor as never,
      stepRunner: stepRunner as never,
      getConfig: () => ({ settings: { maxSteps: 3 } } as never),
    });

    mockRunStep.mockResolvedValue({
      action: { type: 'finish', params: { result: 'task-ok' } },
      result: { action: { type: 'finish', params: {} }, success: true, message: 'done' },
      screenshot: 'img',
      dom: { url: 'https://example.com', title: '', elements: [], viewport: { width: 1, height: 1 } },
      isFinished: true,
    });

    const result = await orchestrator.execute({
      url: 'https://example.com',
      instruction: 'ai run',
      context: { maxSteps: 1 },
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe('task-ok');
    expect(mockOpenBrowser).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('https://example.com');
    expect(mockCloseBrowser).toHaveBeenCalledTimes(1);

    const history = orchestrator.getHistory();
    expect(history[0].status).toBe('running');

    const eventTypes = mockBroadcast.mock.calls.map(([arg]) => (arg as { type: string }).type);
    expect(eventTypes[0]).toBe('task_started');
    expect(eventTypes[eventTypes.length - 1]).toBe('task_completed');
  });

  it('fails AI flow when max steps reached without finish', async () => {
    const orchestrator = new TaskOrchestrator({
      actionExecutor: actionExecutor as never,
      stepRunner: stepRunner as never,
      getConfig: () => ({ settings: { maxSteps: 1 } } as never),
    });

    mockRunStep.mockResolvedValue({
      action: { type: 'wait', params: { delay: 100 } },
      result: { action: { type: 'wait', params: { delay: 100 } }, success: true, message: 'waited' },
      screenshot: 'img',
      dom: { url: 'https://example.com', title: '', elements: [], viewport: { width: 1, height: 1 } },
      isFinished: false,
    });

    const result = await orchestrator.execute({
      url: 'https://example.com',
      instruction: 'ai run',
      context: { maxSteps: 1 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Reached maximum number of steps');

    const history = orchestrator.getHistory();
    expect(history[0].status).toBe('failed');

    const eventTypes = mockBroadcast.mock.calls.map(([arg]) => (arg as { type: string }).type);
    expect(eventTypes[eventTypes.length - 1]).toBe('task_failed');
  });

  it('fails AI flow on thrown error and records failure state', async () => {
    const orchestrator = new TaskOrchestrator({
      actionExecutor: actionExecutor as never,
      stepRunner: stepRunner as never,
      getConfig: () => ({ settings: { maxSteps: 1 } } as never),
    });

    mockRunStep.mockRejectedValue(new Error('runner crash'));

    const result = await orchestrator.execute({
      url: 'https://example.com',
      instruction: 'ai run',
      context: { maxSteps: 1 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('runner crash');

    const history = orchestrator.getHistory();
    expect(history[0].status).toBe('failed');
    expect(history[0].error).toBe('runner crash');
  });

  it('substituteParams replaces nested placeholders', () => {
    const orchestrator = new TaskOrchestrator({
      actionExecutor: actionExecutor as never,
      stepRunner: stepRunner as never,
      getConfig: () => null,
    });

    const substituted = orchestrator.substituteParams(
      {
        selector: '#{{id}}',
        nested: { text: 'hello {{name}}' },
        list: ['{{id}}', { value: '{{name}}' }, 1],
      },
      { id: 'login', name: 'nebula' }
    );

    expect(substituted).toEqual({
      selector: '#login',
      nested: { text: 'hello nebula' },
      list: ['login', { value: 'nebula' }, 1],
    });
  });

  it('substituteSkillParams updates all step params', () => {
    const orchestrator = new TaskOrchestrator({
      actionExecutor: actionExecutor as never,
      stepRunner: stepRunner as never,
      getConfig: () => null,
    });

    const skill: Skill = {
      id: 's1',
      name: 'skill',
      steps: [
        { type: 'type', params: { selector: '#{{field}}', text: '{{value}}' } as Record<string, unknown> },
      ] as Action[],
    };

    const substituted = orchestrator.substituteSkillParams(skill, {
      field: 'email',
      value: 'hello@example.com',
    });

    expect(substituted.steps[0].params).toEqual({
      selector: '#email',
      text: 'hello@example.com',
    });
  });

  it('supports history retrieval by id and clearHistory', async () => {
    const orchestrator = new TaskOrchestrator({
      actionExecutor: actionExecutor as never,
      stepRunner: stepRunner as never,
      getConfig: () => null,
    });

    mockGetSkill.mockReturnValue({
      id: 's2',
      name: 's2',
      steps: [{ type: 'finish', params: {} }],
    });

    actionExecutor.execute.mockResolvedValue({
      action: { type: 'finish', params: {} },
      success: true,
      message: 'done',
    });

    await orchestrator.execute({
      url: 'https://example.com',
      instruction: 'history',
      skillId: 's2',
      context: {},
    });

    const history = orchestrator.getHistory();
    expect(history).toHaveLength(1);

    const byId = orchestrator.getHistoryById(history[0].taskId);
    expect(byId?.taskId).toBe(history[0].taskId);

    orchestrator.clearHistory();
    expect(orchestrator.getHistory()).toHaveLength(0);
  });
});
