/**
 * Shared Types Index
 *
 * Central export point for all shared type definitions.
 * This module re-exports all types from the shared/types directory.
 */
// Action types (precise discriminated union)
export type {
  Action,
  ActionType,
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
  ClickActionParams,
  TypeActionParams,
  FocusActionParams,
  BlurActionParams,
  HoverActionParams,
  ValueActionParams,
  DispatchActionParams,
  ScrollActionParams,
  NavigateActionParams,
  WaitActionParams,
  MCPActionParams,
  FinishActionParams,
  ActionParams,
  ResolvedTarget,
} from './action.js';

// Action guards (available from './action-guards.js' if needed)
// None currently consumed externally - exported on demand.

// Vision Marker types (DOM, elements, locators)
export type {
  BoundingBox,
  LocatorBundle,
  ElementLocator,
  SimplifiedElement,
  SimplifiedDOM,
  DOMSnapshotResponse,
  ElementInfo,
} from './vision-marker.js';

export { VISION_MARKER_API_VERSION } from './vision-marker.js';

// TaskContext types (immutable state container)
export type {
  TaskContext,
  TaskMetadata,
  TaskStatus,
  TaskContextOptions,
  ExecutedAction,
} from './task-context.js';

// TaskContext helpers (available from './task-context.js' if needed)
// None currently consumed externally - exported on demand.

// TaskHistory types (history tracking)
export type {
  TaskHistory,
  Step,
  TaskHistoryStatus,
} from './task-history.js';

// TaskHistory helpers (available from './task-history.js' if needed)
// None currently consumed externally - exported on demand.

// SSE event types
export type {
  SessionEvent,
  SessionEventType,
  SessionSnapshotEvent,
  MessageCreatedEvent,
  AssistantStartedEvent,
  AssistantDeltaEvent,
  AssistantCompletedEvent,
  AssistantThinkingEvent,
  AssistantToolCallEvent,
  AssistantToolResultEvent,
  RunErrorEvent,
  SSEFormattedEvent,
  SessionState,
  SessionAgentState,
  ToolCall,
} from './sse-events.js';

export {
  eventToSSEFormat,
} from './sse-events.js';

// Constants
export { MAX_SCREENSHOT_SIZE_BYTES } from './constants.js';
