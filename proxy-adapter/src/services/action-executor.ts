/**
 * ActionExecutor - Browser action execution with error capture
 *
 * Handles all browser automation actions including click, type, scroll,
 * navigate, wait, MCP calls, and finish actions.
 */

import type { Action, ActionResult } from '../types.js';
import type {
  ClickAction,
  TypeAction,
  FocusAction,
  BlurAction,
  HoverAction,
  ValueAction,
  DispatchAction,
  ScrollAction,
  NavigateAction,
  WaitAction,
  MCPAction,
} from '@nebula-link-evo/shared';
import { browserClient } from '../browser-client.js';
import { interactionLogger } from './interaction-logger.js';
import { failureSampleCollector } from './failure-sample-collector.js';
import type { CreateInteractionParams } from '../conversation/types.js';
import type { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import { createWorkerLogger } from './logger.js';

const logger = createWorkerLogger('ActionExecutor');

export type { ActionResult };

/** Union of action types that carry target-resolution fields. */
type TargetableAction =
  | ClickAction
  | TypeAction
  | FocusAction
  | BlurAction
  | HoverAction
  | ValueAction
  | DispatchAction;

export type ResolvedTargetAction = 
  | { type: 'marker'; snapshotId: string; nebulaId: number }
  | { type: 'selector'; selector: string };

export function resolveTargetAction(action: TargetableAction, actionName: string): ResolvedTargetAction {
  const params = action.params;
  const resolvedTarget = params.resolved_target;

  if (resolvedTarget) {
    const resolvedType = resolvedTarget.type;
    // `format` is a legacy runtime field not present in the ResolvedTarget type definition
    const format = (resolvedTarget as unknown as Record<string, unknown>).format as string | undefined;

    if (resolvedType === 'marker' || format === 'target_id') {
      const snapshotId = resolvedTarget.snapshot_id ?? params.snapshot_id;
      const nebulaIdRaw = resolvedTarget.nebula_id ?? resolvedTarget.target_id ?? params.target_id;
      const nebulaId = Number(nebulaIdRaw);

      if (snapshotId != null && Number.isFinite(nebulaId)) {
        return { type: 'marker', snapshotId, nebulaId };
      }
      const prefix = actionName === 'click' ? 'Marker action' : `Marker ${actionName} action`;
      throw new Error(`${prefix} requires snapshot_id and nebula_id/target_id`);
    }

    if (resolvedType === 'selector' || format === 'selector') {
      const selector = resolvedTarget.selector ?? params.selector;
      if (selector && selector.length > 0) {
        return { type: 'selector', selector };
      }
      const prefix = actionName === 'click' ? 'Selector click' : `Selector ${actionName} action`;
      throw new Error(`${prefix} requires selector`);
    }
  }

  const selector = params.selector;
  if (selector) {
    return { type: 'selector', selector };
  }

  throw new Error(`${actionName.charAt(0).toUpperCase() + actionName.slice(1)} action requires selector`);
}

export type ResolvedClickAction = 
  | { type: 'coordinates'; x: number; y: number }
  | ResolvedTargetAction;

export function resolveClickAction(action: ClickAction): ResolvedClickAction {
  const params = action.params;
  const x = params.x;
  const y = params.y;

  if (x !== undefined && y !== undefined) {
    return { type: 'coordinates', x, y };
  }

  try {
    return resolveTargetAction(action, 'click');
  } catch (e) {
    if (e instanceof Error && e.message === 'Click action requires selector') {
      throw new Error('Click action requires x,y, marker target, or selector');
    }
    throw e;
  }
}

export type ResolvedTypeAction = ResolvedTargetAction & { text: string };

export function resolveTypeAction(action: TypeAction): ResolvedTypeAction {
  const params = action.params;
  const text = params.text ?? params.param ?? '';
  
  const resolvedTarget = params.resolved_target;
  if (resolvedTarget) {
    const format = (resolvedTarget as unknown as Record<string, unknown>).format as string | undefined;
    if (resolvedTarget.type === 'selector' || format === 'selector') {
      const target = resolveTargetAction(action, 'type');
      if (target.type === 'selector' && !text) {
        throw new Error('Selector type action requires selector and text');
      }
      return { ...target, text };
    }
  }

  try {
    const target = resolveTargetAction(action, 'type');
    if (target.type === 'selector' && !text) {
      throw new Error('Type action requires selector and text');
    }
    return { ...target, text };
  } catch (e) {
    if (e instanceof Error && e.message === 'Type action requires selector') {
      throw new Error('Type action requires selector and text');
    }
    throw e;
  }
}

export type ResolvedValueAction = ResolvedTargetAction & { value: string };

export function resolveValueAction(action: ValueAction): ResolvedValueAction {
  const params = action.params;
  const value = params.value ?? params.param ?? '';
  const target = resolveTargetAction(action, 'value');
  return { ...target, value };
}

export type ResolvedDispatchAction = ResolvedTargetAction & { eventType: string };

export function resolveDispatchAction(action: DispatchAction): ResolvedDispatchAction {
  const params = action.params;
  const eventType = params.eventType ?? params.param ?? '';
  
  const resolvedTarget = params.resolved_target;
  if (resolvedTarget) {
    const format = (resolvedTarget as unknown as Record<string, unknown>).format as string | undefined;
    if (resolvedTarget.type === 'selector' || format === 'selector') {
      const target = resolveTargetAction(action, 'dispatch');
      if (target.type === 'selector' && !eventType) {
        throw new Error('Selector dispatch action requires selector and eventType');
      }
      return { ...target, eventType };
    }
  }

  try {
    const target = resolveTargetAction(action, 'dispatch');
    if (target.type === 'selector' && !eventType) {
      throw new Error('Dispatch action requires selector and eventType');
    }
    return { ...target, eventType };
  } catch (e) {
    if (e instanceof Error && e.message === 'Dispatch action requires selector') {
      throw new Error('Dispatch action requires selector and eventType');
    }
    throw e;
  }
}

export function resolveScrollAction(action: ScrollAction): { x: number; y: number } {
  const params = action.params;
  const x = params.x ?? 0;
  const y = params.y ?? 0;
  return { x, y };
}

export function resolveNavigateAction(action: NavigateAction): { url: string } {
  const url = action.params.url;
  if (url) {
    return { url };
  }
  throw new Error('Navigate action requires url');
}

export function resolveWaitAction(action: WaitAction): { delay: number } {
  const params = action.params;
  const delay = params.delay ?? params.duration ?? 1000;
  return { delay };
}

export function resolveMCPCallAction(action: MCPAction): { serverName: string; toolName: string; args: Record<string, unknown> } {
  const params = action.params;
  const server = params.server;
  const tool = params.tool;

  if (server && tool) {
    let serverName = server;
    let toolName = tool;

    if (toolName.includes('.')) {
      const [extractedServer, ...nameParts] = toolName.split('.');
      if (extractedServer && nameParts.length > 0) {
        serverName = extractedServer;
        toolName = nameParts.join('.');
      }
    }

    const args = params.args ?? {};
    return { serverName, toolName, args };
  }
  throw new Error('MCP call requires server and tool');
}

export interface ActionExecutorDeps {
  mcpClient: MCPSDKClient | null;
}

export class ActionExecutor {
  private mcpClient: MCPSDKClient | null;

  constructor(deps: ActionExecutorDeps) {
    this.mcpClient = deps.mcpClient;
  }

  setMCPClient(client: MCPSDKClient | null): void {
    this.mcpClient = client;
  }

  async execute(action: Action): Promise<ActionResult> {
    const startedAt = Date.now();
    let result: ActionResult = {
      action,
      success: false,
      message: 'Action failed: unknown error',
    };
    let executionError: Error | null = null;
    let failureSamplePath: string | null = null;
    let currentUrl = '';

    try {
      currentUrl = (await browserClient.getStatus()).url || '';

      switch (action.type) {
        case 'click':
          result = await this.executeClick(action);
          break;
        case 'type':
          result = await this.executeType(action);
          break;
        case 'focus':
          result = await this.executeFocus(action);
          break;
        case 'blur':
          result = await this.executeBlur(action);
          break;
        case 'hover':
          result = await this.executeHover(action);
          break;
        case 'value':
          result = await this.executeValue(action);
          break;
        case 'dispatch':
          result = await this.executeDispatch(action);
          break;
        case 'scroll':
          result = await this.executeScroll(action);
          break;
        case 'navigate':
          result = await this.executeNavigate(action);
          break;
        case 'wait':
          result = await this.executeWait(action);
          break;
        case 'screenshot':
          result = await this.executeScreenshot(action);
          break;
        case 'mcp_call':
          result = await this.executeMCPCall(action);
          break;
        case 'finish':
          result = { action, success: true, message: 'Task finished' };
          break;
        default:
          throw new Error(`Unknown action type: ${(action as Action).type}`);
      }
    } catch (error) {
      executionError = error as Error;
      result = { action, success: false, message: `Action failed: ${executionError.message}` };
      failureSamplePath = await failureSampleCollector.saveFailureSample(
        action,
        executionError,
        currentUrl
      );
    } finally {
      const latencyMs = Date.now() - startedAt;
      const logPayload = this.buildInteractionLog(
        action,
        result,
        latencyMs,
        executionError,
        failureSamplePath
      );
      void interactionLogger.log(logPayload).catch((error) => {
        logger.error({ err: error }, 'Failed to enqueue interaction log');
      });
    }

    return result;
  }

  private async executeClick(action: Action): Promise<ActionResult> {
    const resolved = resolveClickAction(action as unknown as ClickAction);

    if (resolved.type === 'coordinates') {
      await browserClient.click(resolved.x, resolved.y);
      return { action, success: true, message: `Clicked at (${resolved.x}, ${resolved.y})` };
    }

    if (resolved.type === 'marker') {
      await browserClient.clickByMarker(resolved.snapshotId, resolved.nebulaId);
      return { action, success: true, message: `Clicked marker: ${resolved.snapshotId}/${resolved.nebulaId}` };
    }

    await browserClient.clickBySelector(resolved.selector);
    return { action, success: true, message: `Clicked selector: ${resolved.selector}` };
  }

  private async executeType(action: Action): Promise<ActionResult> {
    const resolved = resolveTypeAction(action as unknown as TypeAction);

    if (resolved.type === 'marker') {
      await browserClient.typeByMarker(resolved.snapshotId, resolved.nebulaId, resolved.text);
      return { action, success: true, message: `Typed "${resolved.text}" into marker: ${resolved.snapshotId}/${resolved.nebulaId}` };
    }

    await browserClient.type(resolved.selector, resolved.text);
    return { action, success: true, message: `Typed "${resolved.text}" into ${resolved.selector}` };
  }

  private async executeFocus(action: Action): Promise<ActionResult> {
    const resolved = resolveTargetAction(action as unknown as FocusAction, 'focus');

    if (resolved.type === 'marker') {
      await browserClient.focusByMarker(resolved.snapshotId, resolved.nebulaId);
      return { action, success: true, message: `Focused marker: ${resolved.snapshotId}/${resolved.nebulaId}` };
    }

    await browserClient.focus(resolved.selector);
    return { action, success: true, message: `Focused selector: ${resolved.selector}` };
  }

  private async executeBlur(action: Action): Promise<ActionResult> {
    const resolved = resolveTargetAction(action as unknown as BlurAction, 'blur');

    if (resolved.type === 'marker') {
      await browserClient.blurByMarker(resolved.snapshotId, resolved.nebulaId);
      return { action, success: true, message: `Blurred marker: ${resolved.snapshotId}/${resolved.nebulaId}` };
    }

    await browserClient.blur(resolved.selector);
    return { action, success: true, message: `Blurred selector: ${resolved.selector}` };
  }

  private async executeHover(action: Action): Promise<ActionResult> {
    const resolved = resolveTargetAction(action as unknown as HoverAction, 'hover');

    if (resolved.type === 'marker') {
      await browserClient.hoverByMarker(resolved.snapshotId, resolved.nebulaId);
      return { action, success: true, message: `Hovered marker: ${resolved.snapshotId}/${resolved.nebulaId}` };
    }

    await browserClient.hover(resolved.selector);
    return { action, success: true, message: `Hovered selector: ${resolved.selector}` };
  }

  private async executeValue(action: Action): Promise<ActionResult> {
    const resolved = resolveValueAction(action as unknown as ValueAction);

    if (resolved.type === 'marker') {
      await browserClient.setValueByMarker(resolved.snapshotId, resolved.nebulaId, resolved.value);
      return { action, success: true, message: `Set value "${resolved.value}" for marker: ${resolved.snapshotId}/${resolved.nebulaId}` };
    }

    await browserClient.setValue(resolved.selector, resolved.value);
    return { action, success: true, message: `Set value "${resolved.value}" for selector: ${resolved.selector}` };
  }

  private async executeDispatch(action: Action): Promise<ActionResult> {
    const resolved = resolveDispatchAction(action as unknown as DispatchAction);

    if (resolved.type === 'marker') {
      await browserClient.dispatchEventByMarker(resolved.snapshotId, resolved.nebulaId, resolved.eventType);
      return { action, success: true, message: `Dispatched event "${resolved.eventType}" on marker: ${resolved.snapshotId}/${resolved.nebulaId}` };
    }

    await browserClient.dispatchEvent(resolved.selector, resolved.eventType);
    return { action, success: true, message: `Dispatched event "${resolved.eventType}" on selector: ${resolved.selector}` };
  }

  private async executeScroll(action: Action): Promise<ActionResult> {
    const resolved = resolveScrollAction(action as unknown as ScrollAction);
    await browserClient.scroll(resolved.x, resolved.y);
    return { action, success: true, message: `Scrolled by (${resolved.x}, ${resolved.y})` };
  }

  private async executeNavigate(action: Action): Promise<ActionResult> {
    const resolved = resolveNavigateAction(action as unknown as NavigateAction);
    await browserClient.navigate(resolved.url);
    return { action, success: true, message: `Navigated to ${resolved.url}` };
  }

  private async executeWait(action: Action): Promise<ActionResult> {
    const resolved = resolveWaitAction(action as unknown as WaitAction);
    await this.sleep(resolved.delay);
    return { action, success: true, message: `Waited ${resolved.delay}ms` };
  }

  private async executeScreenshot(action: Action): Promise<ActionResult> {
    const screenshotData = await browserClient.screenshot();
    return {
      action,
      success: true,
      message: 'Screenshot captured',
      screenshot: screenshotData.screenshot,
    };
  }

  private async executeMCPCall(action: Action): Promise<ActionResult> {
    const resolved = resolveMCPCallAction(action as unknown as MCPAction);

    if (this.mcpClient) {
      const toolResult = await this.mcpClient.callTool(resolved.serverName, resolved.toolName, resolved.args);
      return {
        action,
        success: true,
        message: `MCP call succeeded: ${JSON.stringify(toolResult)}`,
      };
    }
    throw new Error('MCP call requires server and tool');
  }

  private buildInteractionLog(
    action: Action,
    result: ActionResult,
    latencyMs: number,
    executionError: Error | null,
    failureSamplePath: string | null = null
  ): CreateInteractionParams {
    const targetType = this.resolveTargetType(action);
    const locatorStrategy = this.resolveLocatorStrategy(action);
    const snapshotId = this.resolveSnapshotId(action);
    const nebulaId = this.resolveNebulaId(action);

    return {
      action_type: action.type,
      target_type: targetType,
      locator_strategy: locatorStrategy,
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      success: result.success,
      attempts: 1,
      latency_ms: latencyMs,
      error_code: result.success ? undefined : 'ACTION_EXECUTION_FAILED',
      error_message: result.success ? undefined : executionError?.message || result.message,
      failure_sample_path: failureSamplePath,
    };
  }

  private resolveTargetType(action: Action): string {
    const params = action.params;
    if (action.type === 'click') {
      if (typeof params.x === 'number' && typeof params.y === 'number') {
        return 'coordinates';
      }
      if ((typeof params.selector === 'string' && params.selector) || this.getResolvedTarget(action).selector) {
        return 'selector';
      }
      if (this.resolveSnapshotId(action) || this.resolveNebulaId(action) !== undefined) {
        return 'marker';
      }
      return 'unknown';
    }

    if (action.type === 'type') {
      return 'input';
    }
    if (action.type === 'mcp_call') {
      return 'tool';
    }
    if (action.type === 'finish') {
      return 'task';
    }
    return 'page';
  }

  private resolveLocatorStrategy(action: Action): string | undefined {
    const params = action.params;
    if (action.type === 'click') {
      if (typeof params.x === 'number' && typeof params.y === 'number') {
        return 'coordinates';
      }
      if ((typeof params.selector === 'string' && params.selector) || this.getResolvedTarget(action).selector) {
        return 'selector';
      }
      if (this.resolveSnapshotId(action) || this.resolveNebulaId(action) !== undefined) {
        return 'marker';
      }
      return undefined;
    }
    if (action.type === 'type') {
      return 'selector';
    }
    if (action.type === 'navigate') {
      return 'url';
    }
    if (action.type === 'wait') {
      return 'delay';
    }
    if (action.type === 'mcp_call') {
      return 'tool';
    }
    return undefined;
  }

  private resolveSnapshotId(action: Action): string | undefined {
    const resolvedTarget = this.getResolvedTarget(action);
    const snapshotId = resolvedTarget.snapshot_id ?? this.getParamsSnapshotId(action);
    return typeof snapshotId === 'string' ? snapshotId : undefined;
  }

  private resolveNebulaId(action: Action): number | undefined {
    const resolvedTarget = this.getResolvedTarget(action);
    const rawNebulaId = resolvedTarget.nebula_id ?? resolvedTarget.target_id ?? this.getParamsTargetId(action);
    const nebulaId = Number(rawNebulaId);
    return Number.isFinite(nebulaId) ? nebulaId : undefined;
  }

  private getResolvedTarget(action: Action): {
    type?: string;
    nebula_id?: number | string;
    target_id?: number | string;
    snapshot_id?: string;
    selector?: string;
  } {
    const resolvedTargetUnknown = action.params.resolved_target;
    if (!resolvedTargetUnknown || typeof resolvedTargetUnknown !== 'object') {
      return {};
    }

    const resolvedTarget = resolvedTargetUnknown as Record<string, unknown>;
    return {
      type: typeof resolvedTarget.type === 'string' ? resolvedTarget.type : undefined,
      nebula_id:
        typeof resolvedTarget.nebula_id === 'number' || typeof resolvedTarget.nebula_id === 'string'
          ? resolvedTarget.nebula_id
          : undefined,
      target_id:
        typeof resolvedTarget.target_id === 'number' || typeof resolvedTarget.target_id === 'string'
          ? resolvedTarget.target_id
          : undefined,
      snapshot_id:
        typeof resolvedTarget.snapshot_id === 'string' ? resolvedTarget.snapshot_id : undefined,
      selector: typeof resolvedTarget.selector === 'string' ? resolvedTarget.selector : undefined,
    };
  }

  /** Extract snapshot_id from action params. */
  private getParamsSnapshotId(action: Action): string | undefined {
    const val = action.params.snapshot_id;
    return typeof val === 'string' ? val : undefined;
  }

  /** Extract target_id from action params. */
  private getParamsTargetId(action: Action): number | undefined {
    const val = action.params.target_id;
    return typeof val === 'number' ? val : undefined;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}