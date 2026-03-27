/**
 * Action Type Guards
 *
 * Runtime type guards for Action discriminated unions.
 * Use these to safely narrow Action types at runtime.
 */

import type {
  Action,
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
  FinishAction,
  ActionType,
} from './action.js';

// ========== ACTION TYPE GUARDS ==========

/**
 * Type guard for ClickAction.
 */
export function isClickAction(action: Action): action is ClickAction {
  return action.type === 'click';
}

/**
 * Type guard for TypeAction.
 */
export function isTypeAction(action: Action): action is TypeAction {
  return action.type === 'type';
}

/**
 * Type guard for FocusAction.
 */
export function isFocusAction(action: Action): action is FocusAction {
  return action.type === 'focus';
}

/**
 * Type guard for BlurAction.
 */
export function isBlurAction(action: Action): action is BlurAction {
  return action.type === 'blur';
}

/**
 * Type guard for HoverAction.
 */
export function isHoverAction(action: Action): action is HoverAction {
  return action.type === 'hover';
}

/**
 * Type guard for ValueAction.
 */
export function isValueAction(action: Action): action is ValueAction {
  return action.type === 'value';
}

/**
 * Type guard for DispatchAction.
 */
export function isDispatchAction(action: Action): action is DispatchAction {
  return action.type === 'dispatch';
}

/**
 * Type guard for ScrollAction.
 */
export function isScrollAction(action: Action): action is ScrollAction {
  return action.type === 'scroll';
}

/**
 * Type guard for NavigateAction.
 */
export function isNavigateAction(action: Action): action is NavigateAction {
  return action.type === 'navigate';
}

/**
 * Type guard for WaitAction.
 */
export function isWaitAction(action: Action): action is WaitAction {
  return action.type === 'wait';
}

/**
 * Type guard for MCPAction.
 */
export function isMCPAction(action: Action): action is MCPAction {
  return action.type === 'mcp_call';
}

/**
 * Type guard for FinishAction.
 */
export function isFinishAction(action: Action): action is FinishAction {
  return action.type === 'finish';
}

// ========== ACTION TYPE VALIDATION ==========

/**
 * Validates if a string is a valid ActionType.
 */
export function isValidActionType(type: string): type is ActionType {
  const validTypes: ActionType[] = [
    'click',
    'type',
    'focus',
    'blur',
    'hover',
    'value',
    'dispatch',
    'scroll',
    'navigate',
    'wait',
    'mcp_call',
    'finish',
  ];
  return validTypes.includes(type as ActionType);
}

/**
 * Validates if an object is a valid Action.
 */
export function isAction(value: unknown): value is Action {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const action = value as Partial<Action>;

  // Check type field exists and is valid
  if (typeof action.type !== 'string' || !isValidActionType(action.type)) {
    return false;
  }

  // Check params field exists
  if (typeof action.params !== 'object' || action.params === null) {
    return false;
  }

  // Validate specific action type requirements
  switch (action.type) {
    case 'navigate':
      return 'url' in action.params && typeof action.params.url === 'string';

    case 'mcp_call':
      return (
        'server' in action.params &&
        typeof action.params.server === 'string' &&
        'tool' in action.params &&
        typeof action.params.tool === 'string'
      );

    default:
      // Other action types have optional params, just check params is an object
      return true;
  }
}

// ========== ACTION HELPER FUNCTIONS ==========

/**
 * Gets the action type as a literal string.
 */
export function getActionType(action: Action): ActionType {
  return action.type;
}

/**
 * Creates a type-safe action object.
 */
export function createAction<T extends Action>(action: T): T {
  return action;
}

/**
 * Maps over an array of unknown values and filters to valid Actions.
 */
export function filterActions(values: unknown[]): Action[] {
  return values.filter(isAction);
}

/**
 * Validates an Action and returns error message if invalid.
 */
export function validateAction(value: unknown): { valid: boolean; error?: string } {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Action must be an object' };
  }

  const action = value as Partial<Action>;

  if (typeof action.type !== 'string') {
    return { valid: false, error: 'Action type must be a string' };
  }

  if (!isValidActionType(action.type)) {
    return {
      valid: false,
      error: `Invalid action type: ${action.type}. Valid types are: click, type, focus, blur, hover, value, dispatch, scroll, navigate, wait, mcp_call, finish`,
    };
  }

  if (typeof action.params !== 'object' || action.params === null) {
    return { valid: false, error: 'Action params must be an object' };
  }

  // Validate required params for specific action types
  switch (action.type) {
    case 'navigate':
      if (typeof action.params.url !== 'string' || !action.params.url) {
        return { valid: false, error: 'Navigate action requires non-empty url param' };
      }
      break;

    case 'mcp_call':
      if (typeof action.params.server !== 'string' || !action.params.server) {
        return { valid: false, error: 'MCP call action requires non-empty server param' };
      }
      if (typeof action.params.tool !== 'string' || !action.params.tool) {
        return { valid: false, error: 'MCP call action requires non-empty tool param' };
      }
      break;
  }

  return { valid: true };
}
