/**
 * @nebula-link-evo/shared
 *
 * Central entry point for shared types and utilities.
 * Re-exports all public modules for convenient imports.
 */

// Types module
export * from './types/index.js';

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
  ToolCall,
} from './types/sse-events.js';
export {
  eventToSSEFormat,
} from './types/sse-events.js';

// Utilities module
export * from './utils/index.js';
