/**
 * Skills Tool - Vercel AI SDK tool for loading and executing YAML skills
 */

import { tool } from 'ai';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import { SkillManager } from '../../skills/manager.js';
import type { TaskOrchestrator } from '../../services/task-orchestrator.js';
import type { ActionExecutor, ActionResult } from '../../services/action-executor.js';

/**
 * Create a tool for loading and executing YAML-defined skills
 */
export function createLoadSkillTool(
  executor: ActionExecutor,
  taskOrchestrator: TaskOrchestrator,
  skillManager?: SkillManager
) {
  const manager = skillManager || new SkillManager('skills');
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (!loaded) {
      await manager.loadSkills();
      loaded = true;
    }
  }

  return tool({
    description: 'Load and execute a skill by ID. Skills are YAML-defined automation workflows.',
    inputSchema: z.object({
      skillId: z.string().describe('The ID of the skill to load (e.g., "google-search", "extract-data")'),
      params: z.record(z.string(), z.string()).describe('Parameters to substitute into the skill steps'),
    }),
    execute: async ({ skillId, params }, _options: ToolExecutionOptions): Promise<ActionResult> => {
      try {
        // Ensure skills are loaded (cached after first call)
        await ensureLoaded();

        // Get the skill
        const skill = manager.getSkill(skillId);
        if (!skill) {
          return {
            action: { type: 'loadSkill', params: { skillId, params } },
            success: false,
            message: `Skill not found: ${skillId}. Available skills: ${Object.keys(manager.listSkills()).join(', ')}`,
          };
        }

        // Substitute parameters using TaskOrchestrator
        const skillWithParams = taskOrchestrator.substituteSkillParams(skill, params);

        // Execute each step
        const results: ActionResult[] = [];
        for (const step of skillWithParams.steps) {
          const actionType = step.type;
          if (!actionType) {
            return {
              action: { type: 'loadSkill', params: { skillId, params } },
              success: false,
              message: `Step missing type/action in skill ${skillId}`,
            };
          }

          const result = await executor.execute({
            type: actionType,
            params: step.params,
          });

          results.push(result);

          // Stop execution if a step fails
          if (!result.success) {
            return {
              action: { type: 'loadSkill', params: { skillId, params } },
              success: false,
              message: `Skill ${skillId} failed at step: ${result.message}`,
            };
          }
        }

        return {
          action: { type: 'loadSkill', params: { skillId, params } },
          success: true,
          message: `Successfully executed skill "${skillId}" with ${results.length} steps`,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          action: { type: 'loadSkill', params: { skillId, params } },
          success: false,
          message: `Error executing skill ${skillId}: ${errorMessage}`,
        };
      }
    },
  });
}
