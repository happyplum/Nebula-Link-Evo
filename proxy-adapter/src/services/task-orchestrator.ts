/**
 * TaskOrchestrator - Main task execution orchestration
 *
 * Coordinates task execution flow: skill-based or AI-driven task execution,
 * step iteration, WebSocket broadcasts, and history management.
 */

import type { TaskRequest, TaskResponse, ResolvedConfig } from '../config/schema.js';
import type { Action } from '../types.js';
import { browserClient } from '../browser-client.js';
import { SkillManager } from '../skills/manager.js';
import { DebugWebSocketManager } from '../websocket-manager.js';
import { HistoryManager, TaskHistory, Step } from '../debug/history.js';
import type { ActionExecutor, ActionResult } from './action-executor.js';
import type { StepRunner } from './step-runner.js';
import type { Skill } from '../skills/schema.js';


export interface TaskOrchestratorDeps {
  actionExecutor: ActionExecutor;
  stepRunner: StepRunner;
  getConfig: () => ResolvedConfig | null;
}

export class TaskOrchestrator {
  private actionExecutor: ActionExecutor;
  private stepRunner: StepRunner;
  private getConfig: () => ResolvedConfig | null;
  private wsManager: DebugWebSocketManager;
  private historyManager: HistoryManager;

  constructor(deps: TaskOrchestratorDeps) {
    this.actionExecutor = deps.actionExecutor;
    this.stepRunner = deps.stepRunner;
    this.getConfig = deps.getConfig;
    this.wsManager = DebugWebSocketManager.getInstance();
    this.historyManager = new HistoryManager();
  }

  async execute(request: TaskRequest): Promise<TaskResponse> {
    const { url, instruction, skillId, context = {} } = request;
    const previousActions: ActionResult[] = [];
    const taskId = crypto.randomUUID();
    const startTime = new Date().toISOString();

    this.wsManager.broadcast({
      type: 'task_started',
      taskId,
      url,
      instruction: instruction || (skillId ? `Execute skill: ${skillId}` : ''),
      timestamp: startTime,
    });

    const taskHistory: TaskHistory = {
      taskId,
      url,
      instruction,
      startTime,
      status: 'running',
      stepCount: 0,
      steps: [],
    };
    this.historyManager.add(taskHistory);

    if (skillId) {
      return this.executeSkill(
        taskId,
        url,
        instruction,
        skillId,
        context,
        previousActions,
        taskHistory
      );
    }

    return this.executeAITask(
      taskId,
      url,
      instruction,
      context,
      previousActions,
      taskHistory
    );
  }

  private async executeSkill(
    taskId: string,
    url: string,
    instruction: string | undefined,
    skillId: string,
    context: Record<string, unknown>,
    previousActions: ActionResult[],
    taskHistory: TaskHistory
  ): Promise<TaskResponse> {
    const skillManager = new SkillManager();
    const skill = skillManager.getSkill(skillId);

    if (!skill) {
      await browserClient.closeBrowser();
      const endTime = new Date().toISOString();
      const errorMsg = `Skill not found: ${skillId}`;

      this.historyManager.update(taskId, {
        endTime,
        status: 'failed',
        error: errorMsg,
      });

      this.wsManager.broadcast({
        type: 'task_failed',
        taskId,
        url,
        instruction: instruction || `Execute skill: ${skillId}`,
        error: errorMsg,
        timestamp: endTime,
      });

      return {
        success: false,
        url,
        actions: previousActions,
        error: errorMsg,
      };
    }

    const params = (context.params as Record<string, string>) || {};
    let currentStep = 0;
    const maxSteps = skill.steps.length;

    for (; currentStep < maxSteps; currentStep++) {
      console.log(`\n=== Step ${currentStep + 1}/${maxSteps} ===`);
      const step = skill.steps[currentStep];

      console.log(`Action: ${step.type}`, step.params);

      const substitutedParams = this.substituteParams(step.params, params);
      const result = await this.actionExecutor.execute({
        type: step.type,
        params: substitutedParams,
        reasoning: step.reasoning,
      });

      previousActions.push({
        action: step,
        success: result.success,
        message: result.message,
      });

      const stepData: Step = {
        step: currentStep,
        action: step,
        success: result.success,
        message: result.message,
        timestamp: new Date().toISOString(),
      };
      taskHistory.steps.push(stepData);
      taskHistory.stepCount = currentStep + 1;
      this.historyManager.update(taskId, taskHistory);

      this.wsManager.broadcast({
        type: 'step_completed',
        taskId,
        step: currentStep,
        action: step,
        screenshot: '',
        dom: { url, title: '', elements: [], viewport: { width: 1920, height: 1080 } },
        success: result.success,
        message: result.message,
        timestamp: new Date().toISOString(),
      });

      if (step.type === 'finish') {
        await browserClient.closeBrowser();

const endTime = new Date().toISOString();
        const resultValue = step.params?.result;
        const resultText = typeof resultValue === 'string' ? resultValue : 'Skill execution completed';

        this.historyManager.update(taskId, {
          endTime,
          status: 'completed',
          result: resultText,
        });

        this.wsManager.broadcast({
          type: 'task_completed',
          taskId,
          url,
          instruction: instruction || `Execute skill: ${skillId}`,
          result: resultText,
          timestamp: endTime,
        });

        return {
          success: true,
          url,
          actions: previousActions,
          result: resultText,
        };
      }

      await this.stepRunner.sleep(1000);
    }

    await browserClient.closeBrowser();

    const endTime = new Date().toISOString();
    const errorMsg = 'Skill completed all steps';

    this.historyManager.update(taskId, {
      endTime,
      status: 'completed',
      result: errorMsg,
    });

    this.wsManager.broadcast({
      type: 'task_completed',
      taskId,
      url,
      instruction: instruction || `Execute skill: ${skillId}`,
      result: errorMsg,
      timestamp: endTime,
    });

    return {
      success: true,
      url,
      actions: previousActions,
      result: errorMsg,
    };
  }

  private async executeAITask(
    taskId: string,
    url: string,
    instruction: string | undefined,
    context: Record<string, unknown>,
    previousActions: ActionResult[],
    taskHistory: TaskHistory
  ): Promise<TaskResponse> {
    const config = this.getConfig();
    const maxSteps = (context.maxSteps as number) || config?.settings?.maxSteps || 1;

    try {
      await browserClient.openBrowser();
      await browserClient.navigate(url);
      await this.stepRunner.sleep(2000);

      for (let step = 0; step < maxSteps; step++) {
        const stepResult = await this.stepRunner.runStep(
          {
            taskId,
            url,
            instruction: instruction || '',
            maxSteps,
            previousActions,
          },
          step
        );

        previousActions.push({
          action: stepResult.action,
          success: stepResult.result.success,
          message: stepResult.result.message,
        });

        const stepData: Step = {
          step,
          action: stepResult.action,
          success: stepResult.result.success,
          message: stepResult.result.message,
          screenshot: stepResult.screenshot,
          timestamp: new Date().toISOString(),
        };
        taskHistory.steps.push(stepData);
        taskHistory.stepCount = step + 1;
        this.historyManager.update(taskId, taskHistory);

        this.wsManager.broadcast({
          type: 'step_completed',
          taskId,
          step,
          action: stepResult.action,
          screenshot: stepResult.screenshot || '',
          dom: stepResult.dom,
          success: stepResult.result.success,
          message: stepResult.result.message,
          timestamp: new Date().toISOString(),
        });

        if (stepResult.isFinished) {
          await browserClient.closeBrowser();

const endTime = new Date().toISOString();
          const resultValue = stepResult.action.params?.result;
          const resultText = typeof resultValue === 'string' ? resultValue : 'Task completed';

          this.wsManager.broadcast({
            type: 'task_completed',
            taskId,
            url,
            instruction,
            result: resultText,
            timestamp: endTime,
          });

          return {
            success: true,
            url,
            actions: previousActions,
            result: resultText,
          };
        }

        await this.stepRunner.sleep(stepResult.action.type === 'wait' ? 2000 : 1000);
      }

      await browserClient.closeBrowser();

      const endTime = new Date().toISOString();
      const errorMsg = 'Reached maximum number of steps';

      this.historyManager.update(taskId, {
        endTime,
        status: 'failed',
        error: errorMsg,
      });

      this.wsManager.broadcast({
        type: 'task_failed',
        taskId,
        url,
        instruction,
        error: errorMsg,
        timestamp: endTime,
      });

      return {
        success: false,
        url,
        actions: previousActions,
        error: errorMsg,
      };
    } catch (error) {
      await browserClient.closeBrowser();

      const endTime = new Date().toISOString();
      const errorMsg = (error as Error).message;

      this.historyManager.update(taskId, {
        endTime,
        status: 'failed',
        error: errorMsg,
      });

      this.wsManager.broadcast({
        type: 'task_failed',
        taskId,
        url,
        instruction,
        error: errorMsg,
        timestamp: endTime,
      });

      return {
        success: false,
        url,
        actions: previousActions,
        error: errorMsg,
      };
    }
  }

  public substituteParams(
    params: Record<string, unknown>,
    paramValues: Record<string, string>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        // Support both full and partial parameter replacement
        const paramPattern = /\{\{(\w+)\}\}/g;
        const resultValue = value.replace(paramPattern, (match, paramName) => {
          return paramValues[paramName] ?? match;
        });
        result[key] = resultValue;
      } else if (Array.isArray(value)) {
        result[key] = value.map(item => {
          if (typeof item === 'string') {
            const paramPattern = /\{\{(\w+)\}\}/g;
            return item.replace(paramPattern, (match, paramName) => {
              return paramValues[paramName] ?? match;
            });
          } else if (typeof item === 'object' && item !== null) {
            return this.substituteParams(item as Record<string, unknown>, paramValues);
          } else {
            return item;
          }
        });
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.substituteParams(
          value as Record<string, unknown>,
          paramValues
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  public substituteSkillParams(
    skill: Skill,
    paramValues: Record<string, string>
  ): Skill {
    return {
      ...skill,
      steps: skill.steps.map(step => ({
        ...step,
        params: this.substituteParams(step.params, paramValues)
      }))
    };
  }

  getHistory(limit?: number) {
    return this.historyManager.get(limit);
  }

  getHistoryById(id: string) {
    return this.historyManager.getById(id);
  }

  clearHistory() {
    this.historyManager.clear();
  }
}