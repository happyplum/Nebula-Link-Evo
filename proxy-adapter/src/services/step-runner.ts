/**
 * StepRunner - Step loop execution with AI decision logic
 *
 * Handles the iterative step execution process: capture screenshot,
 * get DOM, decide action via AI, execute action, repeat until finish.
 */

import { streamText, tool } from 'ai';
import { z } from 'zod';

import type { Action } from '../types.js';
import type { DOMSnapshotResponse } from '../config/schema.js';

import { browserClient } from '../browser-client.js';
import type { MCPTool } from '../clients/types.js';
import type { ActionExecutor, ActionResult } from './action-executor.js';
import type { ProviderRegistry } from './provider/registry.js';
import { resolveSessionModels } from './provider/resolver.js';
import { createVisionTool } from './provider/vision-tool.js';
import { createWorkerLogger } from './logger.js';
import type { LoopGuardService } from './loop-guard/loop-guard-service.js';
import { InterventionEngine } from './loop-guard/intervention.js';
import { hashArgs, hashResult } from './loop-guard/fingerprint.js';

const logger = createWorkerLogger('StepRunner');

export interface ConfigDefaults {
  decision: string;
  vision: string;
}

export interface StepSessionModelConfig {
  provider: string | null;
  model: string | null;
  vision_provider: string | null;
  vision_model: string | null;
}

export interface StepContext {
  taskId: string;
  url: string;
  instruction: string;
  maxSteps: number;
  previousActions: ActionResult[];
  session?: StepSessionModelConfig;
  loopGuard?: LoopGuardService;
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
  registry: ProviderRegistry;
  defaults: ConfigDefaults;
  getMCPTools: () => MCPTool[];
  visionTool?: { maxCallsPerStep?: number; timeoutMs?: number; screenshotQuality?: number };
}

export class StepRunner {
  private actionExecutor: ActionExecutor;
  private registry: ProviderRegistry;
  private defaults: ConfigDefaults;
  private getMCPTools: () => MCPTool[];
  private visionTool?: { maxCallsPerStep?: number; timeoutMs?: number; screenshotQuality?: number };
  private intervention: InterventionEngine;

  constructor(deps: StepRunnerDeps) {
    this.actionExecutor = deps.actionExecutor;
    this.registry = deps.registry;
    this.defaults = deps.defaults;
    this.getMCPTools = deps.getMCPTools;
    this.visionTool = deps.visionTool;
    this.intervention = new InterventionEngine();
  }

  async runStep(context: StepContext, currentStep: number): Promise<StepResult> {
    logger.info({ step: currentStep + 1, maxSteps: context.maxSteps }, 'Step');

    const [screenshotData, dom] = await Promise.all([
      browserClient.screenshot(),
      browserClient.getSimplifiedDOM(),
    ]);

    const { decision, vision } = await resolveSessionModels(
      context.session ?? {
        provider: null,
        model: null,
        vision_provider: null,
        vision_model: null,
      },
      this.registry,
      this.defaults,
    );

    const mcpTools = this.createMCPTools(this.getMCPTools());
    const visionTool = createVisionTool(
      vision,
      async () => {
        const latestScreenshot = await browserClient.screenshot();
        return {
          screenshot: this.base64ToBuffer(latestScreenshot.screenshot),
          viewport: latestScreenshot.viewport,
        };
      },
      {
        timeoutMs: this.visionTool?.timeoutMs ?? 30000,
        maxCallsPerStep: this.visionTool?.maxCallsPerStep ?? 2,
      },
    );

    // Check loop guard before AI decision
    if (context.loopGuard) {
      const verdict = context.loopGuard.check();
      if (this.intervention.shouldBlockExecution(verdict)) {
        const errorMsg = this.intervention.formatBlockError(verdict);
        const waitAction: Action = { type: 'wait', params: { delay: 2000 } };
        logger.warn({ verdict: verdict.detector, count: verdict.repeatedCount }, 'Loop guard blocked');
        return {
          action: waitAction,
          result: { success: false, message: errorMsg, action: waitAction },
          screenshot: screenshotData.screenshot,
          dom,
          isFinished: false,
        };
      }
    }

    // Collect nudge if warning
    let warningNudge: string | undefined;
    if (context.loopGuard) {
      const verdict = context.loopGuard.check();
      if (verdict.level === 'warning') {
        warningNudge = this.intervention.getNudge(verdict);
      }
    }

    const streamResult = await streamText({
      model: decision,
      messages: this.buildMessages(context, currentStep, dom, warningNudge),
      tools: {
        ...mcpTools,
        analyze_page: visionTool,
      },
      maxSteps: 10,
    } as Parameters<typeof streamText>[0] & { maxSteps: number });

    let textOutput = '';
    for await (const part of streamResult.fullStream) {
      if (part.type === 'text-delta') {
        textOutput += part.text;
      }
    }

    logger.info(
      {
        phase: 'decision',
        provider: decision.provider,
        model: decision.modelId,
        runId: context.taskId,
      },
      'Decision phase'
    );

    const action = this.parseActionFromOutput(textOutput);

    logger.info({ actionType: action.type, params: action.params }, 'Action');

    const executionResult = await this.actionExecutor.execute(action);

    // Record action for loop guard
    if (context.loopGuard) {
      context.loopGuard.recordAction({
        toolName: action.type,
        argsHash: hashArgs(action.params as Record<string, unknown>),
        resultHash: hashResult(executionResult),
        timestamp: Date.now(),
      });
    }

    const isFinished = action.type === 'finish';

    return {
      action,
      result: executionResult,
      screenshot: screenshotData.screenshot,
      dom,
      isFinished,
    };
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildMessages(
    context: StepContext,
    currentStep: number,
    dom: DOMSnapshotResponse,
    nudge?: string,
  ): Parameters<typeof streamText>[0]['messages'] {
    let systemContent = [
      'You are a browser automation action planner.',
      'Use tool "analyze_page" when visual understanding is needed.',
      'You may call available MCP tools when necessary.',
      'Output only valid JSON for the next action.',
      'JSON format: {"type":"click|type|scroll|wait|navigate|screenshot|loadSkill|finish|mcp_call|focus|blur|hover|value|dispatch","params":{...},"reasoning":"optional"}',
      'Do not include markdown fences or extra prose.',
    ].join(' ');

    if (nudge) {
      systemContent += `\n\n${nudge}`;
    }

    const user = {
      taskId: context.taskId,
      url: context.url,
      instruction: context.instruction,
      step: currentStep + 1,
      maxSteps: context.maxSteps,
      previousActions: context.previousActions,
      dom,
    };

    return [
      {
        role: 'system',
        content: systemContent,
      },
      {
        role: 'user',
        content: JSON.stringify(user),
      },
    ];
  }

  private parseActionFromOutput(output: string): Action {
    const fallbackAction: Action = { type: 'wait', params: { delay: 2000 } };
    const json = output.match(/\{[\s\S]*\}/)?.[0];
    if (!json) {
      return fallbackAction;
    }

    try {
      const parsed = JSON.parse(json) as {
        type?: string;
        params?: unknown;
        reasoning?: unknown;
      };

      if (!parsed.type || typeof parsed.type !== 'string') {
        return fallbackAction;
      }

      if (!parsed.params || typeof parsed.params !== 'object' || Array.isArray(parsed.params)) {
        return fallbackAction;
      }

      return {
        type: parsed.type as Action['type'],
        params: parsed.params as Record<string, unknown>,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
      };
    } catch {
      return fallbackAction;
    }
  }

  private createMCPTools(mcpTools: MCPTool[]): Record<string, unknown> {
    const tools: Record<string, unknown> = {};

    for (const mcpTool of mcpTools) {
      const fullToolName = mcpTool.name;
      tools[fullToolName] = tool({
        description: mcpTool.description || fullToolName,
        inputSchema: this.buildInputSchema(mcpTool.inputSchema),
        execute: async (rawArgs: unknown) => {
          const args = this.normalizeToRecord(rawArgs);
          const result = await this.actionExecutor.execute({
            type: 'mcp_call',
            params: {
              tool: fullToolName,
              ...args,
            },
          });

          return {
            success: result.success,
            message: result.message,
          };
        },
      });
    }

    return tools;
  }

  private buildInputSchema(schema: unknown): z.ZodTypeAny {
    const jsonSchema = schema as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };

    if (jsonSchema.type !== 'object' || !jsonSchema.properties) {
      return z.object({}).passthrough();
    }

    const required = new Set(jsonSchema.required || []);
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, property] of Object.entries(jsonSchema.properties)) {
      const propertySchema = this.buildPropertySchema(property);
      shape[key] = required.has(key) ? propertySchema : propertySchema.optional();
    }

    return z.object(shape).passthrough();
  }

  private buildPropertySchema(property: unknown): z.ZodTypeAny {
    if (!property || typeof property !== 'object') {
      return z.unknown();
    }

    const definition = property as {
      type?: string;
      enum?: unknown[];
      items?: unknown;
    };

    if (Array.isArray(definition.enum) && definition.enum.every((value) => typeof value === 'string')) {
      const enumValues = definition.enum as string[];
      return z.string().refine((value) => enumValues.includes(value), {
        message: `Expected one of: ${enumValues.join(', ')}`,
      });
    }

    switch (definition.type) {
      case 'string':
        return z.string();
      case 'number':
      case 'integer':
        return z.number();
      case 'boolean':
        return z.boolean();
      case 'array':
        return z.array(this.buildPropertySchema(definition.items));
      case 'object':
        return z.record(z.string(), z.unknown());
      default:
        return z.unknown();
    }
  }

  private normalizeToRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private base64ToBuffer(base64: string): Buffer {
    const cleaned = base64.includes(',') ? base64.split(',')[1] : base64;
    return Buffer.from(cleaned, 'base64');
  }
}
