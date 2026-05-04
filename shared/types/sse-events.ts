/**
 * SSE Event Types
 *
 * Discriminated union types for Server-Sent Events in chat sessions.
 * Provides type-safe event handling for streaming AI responses.
 */

// ========== BASE TYPES ==========

/**
 * Tool call information for assistant events.
 *
 * Wire format for JSON serialization:
 * ```json
 * {
 *   "function": { "name": "string" },
 *   "arguments": "...",
 *   "id": "..."
 * }
 * ```
 *
 * The `function` field contains the tool name. Additional fields are captured
 * by the index signature to support arbitrary tool call metadata.
 */
export interface ToolCall {
  /** Tool function name */
  function?: {
    name: string;
  };
  /** Additional tool call metadata */
  [key: string]: unknown;
}

/**
 * Session state for snapshot events.
 */
export type SessionState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'interrupted'
  | 'cancelled'
  | 'completed';

/**
 * Runtime agent recovery state exposed on snapshots.
 */
export interface SessionAgentState {
  schema_version: 1;
  currentTask?: {
    description: string;
    startedAt: string;
    estimatedSteps?: number;
    completedSteps: number;
  };
  blockReason?:
    | 'waiting_for_user_input'
    | 'api_error'
    | 'rate_limit'
    | 'validation_failed'
    | 'timeout'
    | 'job_error';
  waitingFor?: 'user_message' | 'api_retry' | 'external_confirmation';
  retryCount?: number;
  lastError?: string;
}

// ========== EVENT INTERFACES ==========

/**
 * Session snapshot event - full session state.
 */
export interface SessionSnapshotEvent {
  type: 'session.snapshot';
  /** Sequence number (set when reading from database) */
  seq?: number;
  /** Session identifier */
  sessionId: string;
  /** All messages in the session */
  messages: Array<{
    id: string;
    role: string;
    content: string;
    thinking?: string;
    tool_calls?: ToolCall[];
    created_at: string;
  }>;
  /** Current session state */
  state: SessionState;
  /** Current runtime job identifier */
  jobId?: string;
  /** Runtime agent recovery state */
  agentState?: SessionAgentState;
  /** In-progress tool calls (only present when session is running) */
  activeToolCalls?: ToolCall[];
}

/**
 * Message created event - new message added to session.
 */
export interface MessageCreatedEvent {
  type: 'message.created';
  /** Sequence number (set when reading from database) */
  seq?: number;
  /** Session identifier */
  sessionId: string;
  /** Runtime execution identifier that produced this event */
  runId?: string;
  /** Message identifier */
  messageId: string;
  /** Message content */
  content: string;
}

/**
 * Assistant started event - beginning of assistant response.
 */
export interface AssistantStartedEvent {
  type: 'assistant.started';
  /** Sequence number (set when reading from database) */
  seq?: number;
  /** Session identifier */
  sessionId: string;
  /** Runtime execution identifier that produced this event */
  runId?: string;
  /** Message identifier */
  messageId: string;
}

/**
 * Assistant delta event - incremental text chunk.
 */
export interface AssistantDeltaEvent {
  type: 'assistant.delta';
  /** Sequence number (set when reading from database) */
  seq?: number;
  /** Session identifier */
  sessionId: string;
  /** Runtime execution identifier that produced this event */
  runId?: string;
  /** Message identifier */
  messageId: string;
  /** Text chunk */
  text: string;
}

/**
 * Assistant completed event - assistant finished response.
 */
export interface AssistantCompletedEvent {
  type: 'assistant.completed';
  /** Sequence number (set when reading from database) */
  seq?: number;
  /** Session identifier */
  sessionId: string;
  /** Runtime execution identifier that produced this event */
  runId?: string;
  /** Message identifier */
  messageId: string;
  /** Terminal reason for assistant run completion */
  terminal_reason?: 'stop' | 'max_steps_reached' | 'tool_error' | 'abort' | 'pause';
}

/**
 * Assistant thinking event - internal reasoning output.
 */
export interface AssistantThinkingEvent {
  type: 'assistant.thinking';
  /** Sequence number (set when reading from database) */
  seq?: number;
  /** Session identifier */
  sessionId: string;
  /** Runtime execution identifier that produced this event */
  runId?: string;
  /** Message identifier */
  messageId: string;
  /** Thinking content */
  text: string;
}

/**
 * Assistant tool call event - tool invocation.
 */
export interface AssistantToolCallEvent {
  type: 'assistant.tool_call';
  /** Sequence number (set when reading from database) */
  seq?: number;
  /** Session identifier */
  sessionId: string;
  /** Runtime execution identifier that produced this event */
  runId?: string;
  /** Message identifier */
  messageId: string;
  /** Unique tool invocation identifier within a run */
  toolCallId?: string;
  /** Tool call details */
  toolCall: ToolCall;
}

/**
 * Assistant tool result event - tool execution result.
 */
export interface AssistantToolResultEvent {
  type: 'assistant.tool_result';
  /** Sequence number (set when reading from database) */
  seq?: number;
  /** Session identifier */
  sessionId: string;
  /** Runtime execution identifier that produced this event */
  runId?: string;
  /** Message identifier */
  messageId: string;
  /** Unique tool invocation identifier within a run */
  toolCallId?: string;
  /** Tool execution result */
  result: string;
}

/**
 * Run error event - execution failure.
 */
export interface RunErrorEvent {
  type: 'run.error';
  /** Sequence number (set when reading from database) */
  seq?: number;
  /** Session identifier */
  sessionId: string;
  /** Runtime execution identifier that produced this event */
  runId?: string;
  /** Error message */
  error: string;
}

// ========== EVENT UNION ==========

/**
 * Discriminated union of all SSE event types.
 * Type field provides discriminant for type narrowing.
 */
export type SessionEvent =
  | SessionSnapshotEvent
  | MessageCreatedEvent
  | AssistantStartedEvent
  | AssistantDeltaEvent
  | AssistantCompletedEvent
  | AssistantThinkingEvent
  | AssistantToolCallEvent
  | AssistantToolResultEvent
  | RunErrorEvent;

// ========== EVENT TYPE LITERALS ==========

/**
 * All valid event type literals.
 */
export type SessionEventType = SessionEvent['type'];

// ========== SSE FORMATTING ==========

/**
 * SSE formatted event for sending over Server-Sent Events.
 */
export interface SSEFormattedEvent {
  /** Event type (event field in SSE) */
  event: string;
  /** Event data (data field in SSE) */
  data: string;
  /** Optional event ID (id field in SSE) */
  id?: string;
}

/**
 * Converts a SessionEvent to SSE format.
 *
 * @param event - The session event to format
 * @param eventId - Optional event ID
 * @returns SSE formatted event object
 */
export function eventToSSEFormat<T extends { type: string }>(
  event: T,
  eventId?: string
): SSEFormattedEvent {
  return {
    event: event.type,
    data: JSON.stringify(event),
    id: eventId,
  };
}
