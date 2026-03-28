import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../../../../../shared/types/sse-events.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function isRuntimeWritableSessionEvent(value: unknown): value is SessionEvent {
  if (!isObject(value) || typeof value.type !== 'string') {
    return false;
  }

  if (value.type === 'session.snapshot') {
    return false;
  }

  if (typeof value.sessionId !== 'string' || !isOptionalNumber(value.seq) || !isOptionalString(value.runId)) {
    return false;
  }

  switch (value.type) {
    case 'message.created':
      return typeof value.messageId === 'string' && typeof value.content === 'string';
    case 'assistant.started':
      return typeof value.messageId === 'string';
    case 'assistant.delta':
    case 'assistant.thinking':
      return typeof value.messageId === 'string' && typeof value.text === 'string';
    case 'assistant.completed':
      return typeof value.messageId === 'string';
    case 'assistant.tool_call':
      return (
        typeof value.messageId === 'string' &&
        isOptionalString(value.toolCallId) &&
        isObject(value.toolCall)
      );
    case 'assistant.tool_result':
      return (
        typeof value.messageId === 'string' &&
        typeof value.result === 'string' &&
        isOptionalString(value.toolCallId)
      );
    case 'run.error':
      return typeof value.error === 'string';
    default:
      return false;
  }
}

describe('invalid event write contract', () => {
  it('accepts runtime events with runId and also legacy payloads without runId', () => {
    const withRunId = {
      type: 'assistant.completed',
      sessionId: 'session-1',
      messageId: 'msg-1',
      runId: 'run-1',
    };

    const legacyWithoutRunId = {
      type: 'assistant.completed',
      sessionId: 'session-1',
      messageId: 'msg-1',
    };

    expect(isRuntimeWritableSessionEvent(withRunId)).toBe(true);
    expect(isRuntimeWritableSessionEvent(legacyWithoutRunId)).toBe(true);
  });

  it('accepts tool_call and tool_result with toolCallId', () => {
    const toolCall = {
      type: 'assistant.tool_call',
      sessionId: 'session-1',
      messageId: 'msg-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      toolCall: {
        function: {
          name: 'browser_click',
        },
      },
    };

    const toolResult = {
      type: 'assistant.tool_result',
      sessionId: 'session-1',
      messageId: 'msg-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      result: '{"success":true}',
    };

    expect(isRuntimeWritableSessionEvent(toolCall)).toBe(true);
    expect(isRuntimeWritableSessionEvent(toolResult)).toBe(true);
  });

  it('rejects invalid payloads with wrong field types', () => {
    const invalidRunIdType = {
      type: 'assistant.started',
      sessionId: 'session-1',
      messageId: 'msg-1',
      runId: 123,
    };

    const invalidToolCallIdType = {
      type: 'assistant.tool_result',
      sessionId: 'session-1',
      messageId: 'msg-1',
      result: '{}',
      toolCallId: { id: 'call-1' },
    };

    expect(isRuntimeWritableSessionEvent(invalidRunIdType)).toBe(false);
    expect(isRuntimeWritableSessionEvent(invalidToolCallIdType)).toBe(false);
  });

  it('rejects payloads missing required fields', () => {
    const missingMessageId = {
      type: 'assistant.delta',
      sessionId: 'session-1',
      text: 'chunk',
    };

    const missingSessionId = {
      type: 'run.error',
      error: 'boom',
    };

    expect(isRuntimeWritableSessionEvent(missingMessageId)).toBe(false);
    expect(isRuntimeWritableSessionEvent(missingSessionId)).toBe(false);
  });

  it('rejects unknown event types and session snapshot writes', () => {
    const unknownType = {
      type: 'assistant.unknown',
      sessionId: 'session-1',
    };

    const snapshotEvent = {
      type: 'session.snapshot',
      sessionId: 'session-1',
      messages: [],
      state: 'idle',
    };

    expect(isRuntimeWritableSessionEvent(unknownType)).toBe(false);
    expect(isRuntimeWritableSessionEvent(snapshotEvent)).toBe(false);
  });
});
