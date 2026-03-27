import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLoadSkillTool } from '../../clients/vercel-ai/skills-tool.js';
import type { ActionExecutor, ActionResult } from '../../services/action-executor.js';
import type { TaskOrchestrator } from '../../services/task-orchestrator.js';
import type { Skill } from '../../skills/schema.js';
import { SkillManager } from '../../skills/manager.js';

/**
 * Type guard to distinguish ActionResult from AsyncIterable<ActionResult>
 * In AI SDK v6, tool.execute can return either ActionResult or AsyncIterable<ActionResult>
 */
function isActionResult(value: unknown): value is ActionResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    'message' in value
  );
}

describe('createLoadSkillTool', () => {
  let mockExecutor: ActionExecutor;
  let mockTaskOrchestrator: TaskOrchestrator;
  let mockSkillManager: SkillManager;
  let loadSkillTool: ReturnType<typeof createLoadSkillTool>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        action: { type: 'click', params: {} },
        success: true,
        message: 'Action executed',
      } as ActionResult),
    } as unknown as ActionExecutor;

    mockTaskOrchestrator = {
      substituteSkillParams: vi.fn().mockImplementation((skill: Skill, _params: Record<string, string>) => skill),
    } as unknown as TaskOrchestrator;

    mockSkillManager = {
      loadSkills: vi.fn().mockResolvedValue(undefined),
      getSkill: vi.fn(),
      listSkills: vi.fn().mockReturnValue({}),
      validateSkill: vi.fn(),
      saveSkill: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    } as unknown as SkillManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('tool creation', () => {
    it('should return tool with correct structure', async () => {
      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      expect(loadSkillTool).toBeDefined();
      expect(loadSkillTool).toHaveProperty('description');
      expect(loadSkillTool).toHaveProperty('inputSchema');
      expect(loadSkillTool).toHaveProperty('execute');
    });

    it('should have correct description', async () => {
      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      expect(loadSkillTool.description).toContain('Load and execute a skill by ID');
    });

    it('should have valid input schema', async () => {
      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      const schema = loadSkillTool.inputSchema;
      // Check that schema is defined and has the right methods
      expect(schema).toBeDefined();
      expect(typeof schema).toBe('object');
      expect(schema).toHaveProperty('parse');
      expect(schema).toHaveProperty('safeParse');
    });
  });

  describe('skill execution', () => {
    it('should return error for non-existent skill', async () => {
      vi.mocked(mockSkillManager.getSkill).mockReturnValue(undefined);
      vi.mocked(mockSkillManager.listSkills).mockReturnValue({});
      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      const rawResult = await loadSkillTool.execute!({ skillId: 'non-existent', params: {} }, {} as any);
      if (!isActionResult(rawResult)) {
        throw new Error('Expected ActionResult, got AsyncIterable');
      }
      const result = rawResult;

      expect(result.success).toBe(false);
      expect(result.message).toContain('Skill not found');
    });

    it('should execute single-step skill successfully', async () => {
      const mockSkill: Skill = {
        id: 'test-skill',
        name: 'Test Skill',
        steps: [{ type: 'click', params: { x: 100, y: 200 } }],
      };

      vi.mocked(mockSkillManager.getSkill).mockReturnValue(mockSkill);
      vi.mocked(mockTaskOrchestrator.substituteSkillParams).mockReturnValue(mockSkill);
      vi.mocked(mockExecutor.execute).mockResolvedValue({
        action: { type: 'click', params: { x: 100, y: 200 } },
        success: true,
        message: 'Clicked at (100, 200)',
      } as ActionResult);

      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      const rawResult = await loadSkillTool.execute!({ skillId: 'test-skill', params: {} }, {} as any);
      if (!isActionResult(rawResult)) {
        throw new Error('Expected ActionResult, got AsyncIterable');
      }
      const result = rawResult;

      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully executed skill');
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    });

    it('should execute multi-step skill successfully', async () => {
      const mockSkill: Skill = {
        id: 'multi-step-skill',
        name: 'Multi Step Skill',
        steps: [
          { type: 'navigate', params: { url: 'https://example.com' } },
          { type: 'type', params: { selector: '#input', text: 'hello' } },
          { type: 'click', params: { selector: '#submit' } },
        ],
      };

      vi.mocked(mockSkillManager.getSkill).mockReturnValue(mockSkill);
      vi.mocked(mockTaskOrchestrator.substituteSkillParams).mockReturnValue(mockSkill);
      vi.mocked(mockExecutor.execute)
        .mockResolvedValueOnce({ action: { type: 'navigate', params: {} }, success: true, message: 'Navigated' } as ActionResult)
        .mockResolvedValueOnce({ action: { type: 'type', params: {} }, success: true, message: 'Typed' } as ActionResult)
        .mockResolvedValueOnce({ action: { type: 'click', params: {} }, success: true, message: 'Clicked' } as ActionResult);

      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      const rawResult = await loadSkillTool.execute!({ skillId: 'multi-step-skill', params: {} }, {} as any);
      if (!isActionResult(rawResult)) {
        throw new Error('Expected ActionResult, got AsyncIterable');
      }
      const result = rawResult;

      expect(result.success).toBe(true);
      expect(result.message).toContain('3 steps');
      expect(mockExecutor.execute).toHaveBeenCalledTimes(3);
    });

    it('should stop execution when step fails', async () => {
      const mockSkill: Skill = {
        id: 'failing-skill',
        name: 'Failing Skill',
        steps: [
          { type: 'navigate', params: { url: 'https://example.com' } },
          { type: 'click', params: { selector: '#non-existent' } },
          { type: 'type', params: { selector: '#input', text: 'hello' } },
        ],
      };

      vi.mocked(mockSkillManager.getSkill).mockReturnValue(mockSkill);
      vi.mocked(mockTaskOrchestrator.substituteSkillParams).mockReturnValue(mockSkill);
      vi.mocked(mockExecutor.execute)
        .mockResolvedValueOnce({ action: { type: 'navigate', params: {} }, success: true, message: 'Navigated' } as ActionResult)
        .mockResolvedValueOnce({ action: { type: 'click', params: {} }, success: false, message: 'Element not found' } as ActionResult);

      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      const rawResult = await loadSkillTool.execute!({ skillId: 'failing-skill', params: {} }, {} as any);
      if (!isActionResult(rawResult)) {
        throw new Error('Expected ActionResult, got AsyncIterable');
      }
      const result = rawResult;

      expect(result.success).toBe(false);
      expect(result.message).toContain('failed at step');
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('parameter substitution', () => {
    it('should call substituteSkillParams with correct params', async () => {
      const mockSkill: Skill = {
        id: 'param-skill',
        name: 'Param Skill',
        steps: [{ type: 'navigate', params: { url: '{{baseUrl}}' } }],
      };

      const substitutedSkill: Skill = {
        id: 'param-skill',
        name: 'Param Skill',
        steps: [{ type: 'navigate', params: { url: 'https://example.com' } }],
      };

      vi.mocked(mockSkillManager.getSkill).mockReturnValue(mockSkill);
      vi.mocked(mockTaskOrchestrator.substituteSkillParams).mockReturnValue(substitutedSkill);
      vi.mocked(mockExecutor.execute).mockResolvedValue({
        action: { type: 'navigate', params: {} },
        success: true,
        message: 'Navigated',
      } as ActionResult);

      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      const rawResult = await loadSkillTool.execute!({
        skillId: 'param-skill',
        params: { baseUrl: 'https://example.com' },
      }, {} as any);
      if (!isActionResult(rawResult)) {
        throw new Error('Expected ActionResult, got AsyncIterable');
      }
      const result = rawResult;

      expect(mockTaskOrchestrator.substituteSkillParams).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should handle empty params', async () => {
      const mockSkill: Skill = {
        id: 'no-param-skill',
        name: 'No Param Skill',
        steps: [{ type: 'wait', params: { duration: 1000 } }],
      };

      vi.mocked(mockSkillManager.getSkill).mockReturnValue(mockSkill);
      vi.mocked(mockTaskOrchestrator.substituteSkillParams).mockReturnValue(mockSkill);
      vi.mocked(mockExecutor.execute).mockResolvedValue({
        action: { type: 'wait', params: {} },
        success: true,
        message: 'Waited',
      } as ActionResult);

      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      const rawResult = await loadSkillTool.execute!({ skillId: 'no-param-skill', params: {} }, {} as any);
      if (!isActionResult(rawResult)) {
        throw new Error('Expected ActionResult, got AsyncIterable');
      }
      const result = rawResult;

      expect(mockTaskOrchestrator.substituteSkillParams).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle step missing type', async () => {
      const mockSkill: Skill = {
        id: 'invalid-step-skill',
        name: 'Invalid Step Skill',
        steps: [{ type: undefined as unknown as 'click', params: {} }],
      };

      vi.mocked(mockSkillManager.getSkill).mockReturnValue(mockSkill);
      vi.mocked(mockTaskOrchestrator.substituteSkillParams).mockReturnValue(mockSkill);

      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      const rawResult = await loadSkillTool.execute!({ skillId: 'invalid-step-skill', params: {} }, {} as any);
      if (!isActionResult(rawResult)) {
        throw new Error('Expected ActionResult, got AsyncIterable');
      }
      const result = rawResult;

      expect(result.success).toBe(false);
      expect(result.message).toContain('missing type');
    });

    it('should handle executor exceptions', async () => {
      const mockSkill: Skill = {
        id: 'exception-skill',
        name: 'Exception Skill',
        steps: [{ type: 'click', params: { x: 100, y: 200 } }],
      };

      vi.mocked(mockSkillManager.getSkill).mockReturnValue(mockSkill);
      vi.mocked(mockTaskOrchestrator.substituteSkillParams).mockReturnValue(mockSkill);
      vi.mocked(mockExecutor.execute).mockRejectedValue(new Error('Network error'));

      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      const rawResult = await loadSkillTool.execute!({ skillId: 'exception-skill', params: {} }, {} as any);
      if (!isActionResult(rawResult)) {
        throw new Error('Expected ActionResult, got AsyncIterable');
      }
      const result = rawResult;

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error executing skill');
      expect(result.message).toContain('Network error');
    });

    it('should handle non-Error exceptions', async () => {
      const mockSkill: Skill = {
        id: 'string-error-skill',
        name: 'String Error Skill',
        steps: [{ type: 'click', params: { x: 100, y: 200 } }],
      };

      vi.mocked(mockSkillManager.getSkill).mockReturnValue(mockSkill);
      vi.mocked(mockTaskOrchestrator.substituteSkillParams).mockReturnValue(mockSkill);
      vi.mocked(mockExecutor.execute).mockRejectedValue('String error');

      loadSkillTool = createLoadSkillTool(mockExecutor, mockTaskOrchestrator, mockSkillManager);
      const rawResult = await loadSkillTool.execute!({ skillId: 'string-error-skill', params: {} }, {} as any);
      if (!isActionResult(rawResult)) {
        throw new Error('Expected ActionResult, got AsyncIterable');
      }
      const result = rawResult;

      expect(result.success).toBe(false);
      expect(result.message).toContain('String error');
    });
  });
});
