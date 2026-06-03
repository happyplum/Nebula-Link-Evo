/**
 * @nebula-link-evo/shared
 *
 * Central entry point for shared types and utilities.
 * Re-exports all public modules for convenient imports.
 */

// Types module
export * from './types/index.js';

// Constants
export { MAX_SCREENSHOT_SIZE_BYTES } from './types/constants.js';

// SSE Events - export all interfaces and types
export type {
  SessionEvent,
  SessionState,
  SSEFormattedEvent,
  SessionEventType,
  SessionSnapshotEvent,
  SessionAgentState,
  MessageCreatedEvent,
  AssistantStartedEvent,
  AssistantDeltaEvent,
  AssistantCompletedEvent,
  AssistantThinkingEvent,
  AssistantToolCallEvent,
  AssistantToolResultEvent,
  RunErrorEvent,
  JobQueuedEvent,
  JobStartedEvent,
  JobCancelledEvent,
  JobCompletedEvent,
  PendingJobInfo,
  ToolCall,
} from './types/sse-events.js';
export {
  eventToSSEFormat,
} from './types/sse-events.js';

// Debug SSE Events
export type {
  DebugStreamEvent,
  DebugPlaywrightState,
  DebugServiceStatus,
  DebugStatusReason,
  DebugSnapshotEvent,
  DebugStatusEvent,
  DebugErrorEvent,
  DebugMarkerEvent,
  DebugMarkerPayload,
  DebugOverlayEvent,
  DebugOverlayPayload,
  DebugMcpInvalidatedEvent,
  DebugKeepaliveEvent,
} from './types/debug-events.js';

// Utilities module
export * from './utils/index.js';
