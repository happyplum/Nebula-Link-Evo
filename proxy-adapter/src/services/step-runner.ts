/**
 * StepRunner - Step loop execution with AI decision logic
 *
 * Handles the iterative step execution process: capture screenshot,
 * get DOM, decide action via AI, execute action, repeat until finish.
 */

import type { Action } from '../types.js';
import type { UIElement, ResolvedConfig, DOMSnapshotResponse } from '../config/schema.js';

import { browserClient } from '../browser-client.js';
import type { ClientFactory } from '../clients/index.js';
import type { MCPTool } from '../clients/types.js';
import type { ActionExecutor, ActionResult } from './action-executor.js';

export interface StepContext {
  taskId: string;
  url: string;
  instruction: string;
  maxSteps: number;
  previousActions: ActionResult[];
}

export interface StepResult {
  action: Action;
  result: ActionResult;
  screenshot?: string;
  dom?: DOMSnapshotResponse;
  isFinished: boolean;
}

export interface StepRunnerDeps {
  actionExecutor: ActionExecutor;
  clientFactory: ClientFactory;
  getMCPTools: () => MCPTool[];
}

export class StepRunner {
  private actionExecutor: ActionExecutor;
  private clientFactory: ClientFactory;
  private getMCPTools: () => MCPTool[];

  constructor(deps: StepRunnerDeps) {
    this.actionExecutor = deps.actionExecutor;
    this.clientFactory = deps.clientFactory;
    this.getMCPTools = deps.getMCPTools;
  }

  async runStep(context: StepContext, currentStep: number): Promise<StepResult> {
    console.log(`\n=== Step ${currentStep + 1}/${context.maxSteps} ===`);

    const screenshotData = await browserClient.screenshot();
    const dom = await browserClient.getSimplifiedDOM();

    let elements: UIElement[] = [];
    let action: Action;

    const mcpTools = this.getMCPTools();
    if (mcpTools.length > 0) {
      console.log(`Available MCP tools: ${mcpTools.map((t) => t.name).join(', ')}`);
    }

    if (this.clientFactory.isUnifiedMode()) {
      const result = await this.clientFactory.decideAction(
        {
          screenshot: screenshotData.screenshot,
          dom,
          elements,
          instruction: context.instruction,
          previousActions: context.previousActions,
        },
        mcpTools
      );

      action =
        result.success && result.data ? result.data : { type: 'wait', params: { delay: 2000 } };
    } else {
      const detectResult = await this.clientFactory.detectWithFallback(
        screenshotData.screenshot,
        screenshotData.viewport,
        '检测页面中可交互的UI元素'
      );

      if (detectResult.success && detectResult.data) {
        elements = detectResult.data;
        console.log(`Detected ${elements.length} UI elements`);
      }

      const decideResult = await this.clientFactory.decideAction(
        {
          screenshot: screenshotData.screenshot,
          dom,
          elements,
          instruction: context.instruction,
          previousActions: context.previousActions,
        },
        mcpTools
      );

      action =
        decideResult.success && decideResult.data
          ? decideResult.data
          : { type: 'wait', params: { delay: 2000 } };
    }

    console.log(`Action: ${action.type}`, action.params);

    const result = await this.actionExecutor.execute(action);

    const isFinished = action.type === 'finish';

    return {
      action,
      result,
      screenshot: screenshotData.screenshot,
      dom,
      isFinished,
    };
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}