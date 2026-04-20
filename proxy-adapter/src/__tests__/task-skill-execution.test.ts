import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskService } from '../services/index.js';
import { SkillManager } from '../skills/manager.js';
import { Skill } from '../skills/schema.js';
import { browserClient } from '../browser-client.js';
import type { ResolvedConfig } from '../config/schema.js';
import type { Action, TaskRequest } from '../types.js';

vi.mock('../config/index.js', () => ({
  loadConfig: vi.fn(() => ({
    config: {
      version: '1.0',
      providers: {},
      mcp: { enabled: false, servers: {} },
      defaults: {
        vision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
        decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
      },
    } as ResolvedConfig,
    configPath: '/mock/config.json',
    result: { errors: [] },
  })),
  validateConfig: vi.fn(() => ({ valid: true, warnings: [], errors: [] })),
}));
describe('TaskExecutor - Skill Execution', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    vi.spyOn(browserClient, 'closeBrowser').mockResolvedValue(undefined);
    
    // Initialize TaskService to set up taskOrchestrator
    await TaskService.getInstance().initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('execute with skillId', () => {
    it('should execute skill steps when skillId is provided', async () => {
      const skill: Skill = {
        id: 'test-skill',
        name: 'Test Skill',
        steps: [
          { type: 'click', params: { x: 100, y: 100 } },
          { type: 'wait', params: { delay: 500 } },
          { type: 'finish', params: {} },
        ] as Action[],
      };

      const mockGetSkill = vi.spyOn(SkillManager.prototype, 'getSkill').mockReturnValue(skill);
      vi.spyOn(TaskService.getInstance().getActionExecutor(), 'execute').mockResolvedValue({
        action: { type: 'finish', params: {} },
        success: true,
        message: 'Success',
      });

      const request: TaskRequest = {
        url: 'https://example.com',
        instruction: 'execute skill',
        skillId: 'test-skill',
      };

      const result = await TaskService.getInstance().execute(request);

      expect(result.success).toBe(true);
      expect(result.actions).toHaveLength(3);
      expect(mockGetSkill).toHaveBeenCalledWith('test-skill');
    });

    it('should load skill from SkillManager when skillId is provided', async () => {
      const skill: Skill = {
        id: 'load-test',
        name: 'Load Test',
        steps: [{ type: 'finish', params: {} }] as Action[],
      };

      const mockGetSkill = vi.spyOn(SkillManager.prototype, 'getSkill').mockReturnValue(skill);
      vi.spyOn(TaskService.getInstance().getActionExecutor(), 'execute').mockResolvedValue({
        action: { type: 'finish', params: {} },
        success: true,
        message: 'Success',
      });

      const request: TaskRequest = {
        url: 'https://example.com',
        instruction: '',
        skillId: 'load-test',
      };

      await TaskService.getInstance().execute(request);

      expect(mockGetSkill).toHaveBeenCalledWith('load-test');
    });

    it('should use context.params for parameter substitution', async () => {
      const skill: Skill = {
        id: 'param-test',
        name: 'Parameter Test',
        steps: [
          {
            type: 'click',
            params: { x: '{{x}}', y: '{{y}}' },
          } as Action,
        ] as Action[],
      };

      const mockGetSkill = vi.spyOn(SkillManager.prototype, 'getSkill').mockReturnValue(skill);
      const mockExecuteAction = vi.spyOn(
        TaskService.getInstance().getActionExecutor(),
        'execute'
      ).mockResolvedValue({
        action: { type: 'click', params: { x: '100', y: '200' } },
        success: true,
        message: 'Success',
      });
      const request: TaskRequest = {
        url: 'https://example.com',
        instruction: '',
        skillId: 'param-test',
        context: {
          params: { x: '100', y: '200' },
        },
      };

      await TaskService.getInstance().execute(request);

      expect(mockGetSkill).toHaveBeenCalled();
      expect(mockExecuteAction).toHaveBeenCalledWith({
        type: 'click',
        params: { x: '100', y: '200' },
        reasoning: undefined,
      });
    });
  });

  describe('skill execution bypasses AI planning', () => {
    it('should execute skill steps directly without calling AI', async () => {
      const skill: Skill = {
        id: 'bypass-test',
        name: 'Bypass Test',
        steps: [{ type: 'finish', params: {} }] as Action[],
      };

      const mockGetSkill = vi.spyOn(SkillManager.prototype, 'getSkill').mockReturnValue(skill);

      const request: TaskRequest = {
        url: 'https://example.com',
        instruction: '',
        skillId: 'bypass-test',
      };

      await TaskService.getInstance().execute(request);

      expect(mockGetSkill).toHaveBeenCalledWith('bypass-test');
    });
  });

  describe('skill with missing steps', () => {
    it('should handle skill with no steps', async () => {
      const skill: Skill = {
        id: 'empty-steps',
        name: 'Empty Steps',
        steps: [] as Action[],
      };

      vi.spyOn(SkillManager.prototype, 'getSkill').mockReturnValue(skill);

      const request: TaskRequest = {
        url: 'https://example.com',
        instruction: '',
        skillId: 'empty-steps',
      };

      const result = await TaskService.getInstance().execute(request);

      expect(result.success).toBe(true);
      expect(result.actions).toHaveLength(0);
      expect(result.result).toContain('all steps');
    });
  });

  describe('skill execution error handling', () => {
    it('should return error when skill is not found', async () => {
      vi.spyOn(SkillManager.prototype, 'getSkill').mockReturnValue(undefined);

      const request: TaskRequest = {
        url: 'https://example.com',
        instruction: '',
        skillId: 'non-existent-skill',
      };

      const result = await TaskService.getInstance().execute(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
