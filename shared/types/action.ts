/**
 * Browser Action Types
 *
 * Precise discriminated union types for all browser automation actions.
 * Used by task execution services (TaskService, ActionExecutor) to enforce type-safe action execution.
 */

// ========== BASE INTERFACES ==========

/**
 * Common action base fields.
 */
interface BaseAction {
  /** Optional reasoning for this action (for AI logging) */
  reasoning?: string;
}

/**
 * Resolved target with multiple locator strategies.
 */
export interface ResolvedTarget {
  /** Target format type */
  type: 'marker' | 'selector';
  /** Snapshot ID for marker-based targeting */
  snapshot_id?: string;
  /** Element ID for marker-based targeting (legacy: target_id, nebula_id) */
  target_id?: number | string;
  nebula_id?: number | string;
  /** CSS selector for selector-based targeting */
  selector?: string;
}

// ========== ACTION PARAMETER TYPES ==========

/**
 * Parameters for click action.
 */
export interface ClickActionParams {
  /** X coordinate (pixel) */
  x?: number;
  /** Y coordinate (pixel) */
  y?: number;
  /** CSS selector string */
  selector?: string;
  /** Resolved target (marker or selector) */
  resolved_target?: ResolvedTarget;
  /** Snapshot ID (legacy, for backward compatibility) */
  snapshot_id?: string;
  /** Target ID (legacy, for backward compatibility) */
  target_id?: number;
}

/**
 * Parameters for type action.
 */
export interface TypeActionParams {
  /** CSS selector string */
  selector?: string;
  /** Text to type */
  text?: string;
  /** Resolved target (marker or selector) */
  resolved_target?: ResolvedTarget;
  /** Snapshot ID (legacy) */
  snapshot_id?: string;
  /** Target ID (legacy) */
  target_id?: number;
  /** Parameter alias for text (legacy) */
  param?: string;
}

/**
 * Parameters for focus action.
 */
export interface FocusActionParams {
  /** CSS selector string */
  selector?: string;
  /** Resolved target (marker or selector) */
  resolved_target?: ResolvedTarget;
  /** Snapshot ID (legacy) */
  snapshot_id?: string;
  /** Target ID (legacy) */
  target_id?: number;
}

/**
 * Parameters for blur action.
 */
export interface BlurActionParams {
  /** CSS selector string */
  selector?: string;
  /** Resolved target (marker or selector) */
  resolved_target?: ResolvedTarget;
  /** Snapshot ID (legacy) */
  snapshot_id?: string;
  /** Target ID (legacy) */
  target_id?: number;
}

/**
 * Parameters for hover action.
 */
export interface HoverActionParams {
  /** CSS selector string */
  selector?: string;
  /** Resolved target (marker or selector) */
  resolved_target?: ResolvedTarget;
  /** Snapshot ID (legacy) */
  snapshot_id?: string;
  /** Target ID (legacy) */
  target_id?: number;
}

/**
 * Parameters for value action.
 */
export interface ValueActionParams {
  /** CSS selector string */
  selector?: string;
  /** Value to set */
  value?: string;
  /** Resolved target (marker or selector) */
  resolved_target?: ResolvedTarget;
  /** Snapshot ID (legacy) */
  snapshot_id?: string;
  /** Target ID (legacy) */
  target_id?: number;
  /** Parameter alias for value (legacy) */
  param?: string;
}

/**
 * Parameters for dispatch action.
 */
export interface DispatchActionParams {
  /** CSS selector string */
  selector?: string;
  /** Event type to dispatch */
  eventType?: string;
  /** Resolved target (marker or selector) */
  resolved_target?: ResolvedTarget;
  /** Snapshot ID (legacy) */
  snapshot_id?: string;
  /** Target ID (legacy) */
  target_id?: number;
  /** Parameter alias for eventType (legacy) */
  param?: string;
}

/**
 * Parameters for scroll action.
 */
export interface ScrollActionParams {
  /** X scroll amount (pixels) */
  x?: number;
  /** Y scroll amount (pixels) */
  y?: number;
}

/**
 * Parameters for navigate action.
 */
export interface NavigateActionParams {
  /** URL to navigate to */
  url: string;
  /** Wait until condition (networkidle, load, domcontentloaded) */
  waitUntil?: 'networkidle' | 'load' | 'domcontentloaded' | 'commit';
}

/**
 * Parameters for wait action.
 */
export interface WaitActionParams {
  /** Delay in milliseconds */
  delay?: number;
  /** Duration alias for delay (legacy, used in skills) */
  duration?: number;
}

/**
 * Parameters for MCP call action.
 */
export interface MCPActionParams {
  /** MCP server name */
  server: string;
  /** Tool name to call (format: "server.tool" or just "tool") */
  tool: string;
  /** Arguments to pass to the tool */
  args?: Record<string, unknown>;
}

/**
 * Parameters for finish action.
 */
export interface FinishActionParams {
  /** Optional result message */
  result?: string;
}

// ========== ACTION TYPES ==========

/**
 * Click action - clicks at coordinates, selector, or marker.
 */
export interface ClickAction extends BaseAction {
  type: 'click';
  params: ClickActionParams;
}

/**
 * Type action - enters text into input field.
 */
export interface TypeAction extends BaseAction {
  type: 'type';
  params: TypeActionParams;
}

/**
 * Focus action - focuses an element.
 */
export interface FocusAction extends BaseAction {
  type: 'focus';
  params: FocusActionParams;
}

/**
 * Blur action - blurs (removes focus from) an element.
 */
export interface BlurAction extends BaseAction {
  type: 'blur';
  params: BlurActionParams;
}

/**
 * Hover action - hovers over an element.
 */
export interface HoverAction extends BaseAction {
  type: 'hover';
  params: HoverActionParams;
}

/**
 * Value action - sets value of form element.
 */
export interface ValueAction extends BaseAction {
  type: 'value';
  params: ValueActionParams;
}

/**
 * Dispatch action - dispatches DOM event on element.
 */
export interface DispatchAction extends BaseAction {
  type: 'dispatch';
  params: DispatchActionParams;
}

/**
 * Scroll action - scrolls the page.
 */
export interface ScrollAction extends BaseAction {
  type: 'scroll';
  params: ScrollActionParams;
}

/**
 * Navigate action - navigates to a URL.
 */
export interface NavigateAction extends BaseAction {
  type: 'navigate';
  params: NavigateActionParams;
}

/**
 * Wait action - waits for specified duration.
 */
export interface WaitAction extends BaseAction {
  type: 'wait';
  params: WaitActionParams;
}

/**
 * MCP call action - calls an MCP server tool.
 */
export interface MCPAction extends BaseAction {
  type: 'mcp_call';
  params: MCPActionParams;
}

/**
 * Finish action - completes the task.
 */
export interface FinishAction extends BaseAction {
  type: 'finish';
  params: FinishActionParams;
}

// ========== ACTION UNION ==========

/**
 * Discriminated union of all action types.
 */
export type Action =
  | ClickAction
  | TypeAction
  | FocusAction
  | BlurAction
  | HoverAction
  | ValueAction
  | DispatchAction
  | ScrollAction
  | NavigateAction
  | WaitAction
  | MCPAction
  | FinishAction;


