import type {
  SessionSnapshotEvent,
  MessageCreatedEvent,
  AssistantDeltaEvent,
  AssistantStartedEvent,
  AssistantCompletedEvent,
  AssistantThinkingEvent,
  AssistantToolCallEvent,
  AssistantToolResultEvent,
  RunErrorEvent,
} from '../../../shared/types/sse-events.js';

/**
 * Create a mock session.snapshot event
 *
 * @param overrides - Optional overrides for event properties
 * @returns Mock SessionSnapshotEvent
 */
export function mockSnapshotEvent(overrides?: Partial<SessionSnapshotEvent>): SessionSnapshotEvent {
  return {
    type: 'session.snapshot',
    sessionId: 'test-session-id',
    messages: [],
    state: 'idle',
    ...overrides,
  };
}

/**
 * Create a mock message.created event
 *
 * @param overrides - Optional overrides for event properties
 * @returns Mock MessageCreatedEvent
 */
export function mockMessageCreatedEvent(overrides?: Partial<MessageCreatedEvent>): MessageCreatedEvent {
  return {
    type: 'message.created',
    sessionId: 'test-session-id',
    messageId: 'msg-test-123',
    content: 'Test message content',
    ...overrides,
  };
}

/**
 * Create a mock assistant.started event
 *
 * @param overrides - Optional overrides for event properties
 * @returns Mock AssistantStartedEvent
 */
export function mockAssistantStartedEvent(overrides?: Partial<AssistantStartedEvent>): AssistantStartedEvent {
  return {
    type: 'assistant.started',
    sessionId: 'test-session-id',
    messageId: 'msg-assistant-456',
    ...overrides,
  };
}

/**
 * Create a mock assistant.delta event
 *
 * @param overrides - Optional overrides for event properties
 * @returns Mock AssistantDeltaEvent
 */
export function mockAssistantDeltaEvent(overrides?: Partial<AssistantDeltaEvent>): AssistantDeltaEvent {
  return {
    type: 'assistant.delta',
    sessionId: 'test-session-id',
    messageId: 'msg-assistant-456',
    text: 'Test delta text',
    ...overrides,
  };
}

/**
 * Create a mock assistant.completed event
 *
 * @param overrides - Optional overrides for event properties
 * @returns Mock AssistantCompletedEvent
 */
export function mockAssistantCompletedEvent(overrides?: Partial<AssistantCompletedEvent>): AssistantCompletedEvent {
  return {
    type: 'assistant.completed',
    sessionId: 'test-session-id',
    messageId: 'msg-assistant-456',
    ...overrides,
  };
}

/**
 * Create a mock assistant.thinking event
 *
 * @param overrides - Optional overrides for event properties
 * @returns Mock AssistantThinkingEvent
 */
export function mockAssistantThinkingEvent(overrides?: Partial<AssistantThinkingEvent>): AssistantThinkingEvent {
  return {
    type: 'assistant.thinking',
    sessionId: 'test-session-id',
    messageId: 'msg-assistant-456',
    text: 'Thinking about the request...',
    ...overrides,
  };
}

/**
 * Create a mock assistant.tool_call event
 *
 * @param overrides - Optional overrides for event properties
 * @returns Mock AssistantToolCallEvent
 */
export function mockAssistantToolCallEvent(overrides?: Partial<AssistantToolCallEvent>): AssistantToolCallEvent {
  return {
    type: 'assistant.tool_call',
    sessionId: 'test-session-id',
    messageId: 'msg-assistant-456',
    toolCall: {
      function: {
        name: 'browser_navigate',
      },
    },
    ...overrides,
  };
}

/**
 * Create a mock assistant.tool_result event
 *
 * @param overrides - Optional overrides for event properties
 * @returns Mock AssistantToolResultEvent
 */
export function mockAssistantToolResultEvent(overrides?: Partial<AssistantToolResultEvent>): AssistantToolResultEvent {
  return {
    type: 'assistant.tool_result',
    sessionId: 'test-session-id',
    messageId: 'msg-assistant-456',
    result: 'Tool execution succeeded',
    ...overrides,
  };
}

/**
 * Create a mock run.error event
 *
 * @param overrides - Optional overrides for event properties
 * @returns Mock RunErrorEvent
 */
export function mockRunErrorEvent(overrides?: Partial<RunErrorEvent>): RunErrorEvent {
  return {
    type: 'run.error',
    sessionId: 'test-session-id',
    error: 'Test error message',
    ...overrides,
  };
}

/**
 * Create a sequence of mock events for testing complete flow
 *
 * @param sessionId - Session ID for all events
 * @returns Array of mock events in typical execution order
 */
export function createMockEventSequence(sessionId: string = 'test-session-id'): Array<{
  event: ReturnType<typeof mockMessageCreatedEvent | typeof mockAssistantStartedEvent | typeof mockAssistantThinkingEvent | typeof mockAssistantDeltaEvent | typeof mockAssistantCompletedEvent>;
  delay?: number;
}> {
  const messageId = `msg-${Date.now()}`;

  return [
    { event: mockMessageCreatedEvent({ sessionId, messageId: `${messageId}-user` }) },
    { event: mockAssistantStartedEvent({ sessionId, messageId }), delay: 10 },
    { event: mockAssistantThinkingEvent({ sessionId, messageId, text: 'Analyzing request...' }), delay: 20 },
    { event: mockAssistantDeltaEvent({ sessionId, messageId, text: 'Hello!' }), delay: 30 },
    { event: mockAssistantDeltaEvent({ sessionId, messageId, text: ' How can I help?' }), delay: 40 },
    { event: mockAssistantCompletedEvent({ sessionId, messageId }), delay: 50 },
  ];
}
