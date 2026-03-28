import { describe, expect, it } from 'vitest';
import type {
  AssistantDeltaEvent,
  AssistantToolCallEvent,
  AssistantToolResultEvent,
  MessageCreatedEvent,
  RunErrorEvent,
  SessionEvent,
} from '../../../../../shared/types/sse-events.js';

type EventSourceRole = 'user' | 'assistant' | 'system';

function resolveEventSourceRole(event: SessionEvent): EventSourceRole {
  if (event.type === 'message.created') {
    return 'user';
  }

  if (
    event.type === 'assistant.started' ||
    event.type === 'assistant.delta' ||
    event.type === 'assistant.completed' ||
    event.type === 'assistant.thinking' ||
    event.type === 'assistant.tool_call' ||
    event.type === 'assistant.tool_result'
  ) {
    return 'assistant';
  }

  return 'system';
}

function groupByRunId(events: SessionEvent[]): Map<string, SessionEvent[]> {
  const grouped = new Map<string, SessionEvent[]>();

  for (const event of events) {
    if (!('runId' in event) || typeof event.runId !== 'string') {
      continue;
    }
    const bucket = grouped.get(event.runId) ?? [];
    bucket.push(event);
    grouped.set(event.runId, bucket);
  }

  return grouped;
}

describe('conversation event origin contract', () => {
  it('tracks runtime-event origin by runId when present', () => {
    const runAUserEvent = {
      type: 'message.created',
      sessionId: 'session-1',
      messageId: 'msg-user-1',
      content: 'hello',
      runId: 'run-a',
    } satisfies MessageCreatedEvent;

    const runAAssistantEvent = {
      type: 'assistant.delta',
      sessionId: 'session-1',
      messageId: 'msg-assistant-1',
      text: 'world',
      runId: 'run-a',
    } satisfies AssistantDeltaEvent;

    const runBErrorEvent = {
      type: 'run.error',
      sessionId: 'session-1',
      error: 'failed',
      runId: 'run-b',
    } satisfies RunErrorEvent;

    const grouped = groupByRunId([runAUserEvent, runAAssistantEvent, runBErrorEvent]);

    expect(grouped.get('run-a')?.map((event) => event.type)).toEqual([
      'message.created',
      'assistant.delta',
    ]);
    expect(grouped.get('run-b')?.map((event) => event.type)).toEqual(['run.error']);
  });

  it('keeps runtime events valid when runId is omitted for backward compatibility', () => {
    const legacyEvent = {
      type: 'assistant.delta',
      sessionId: 'session-legacy',
      messageId: 'msg-legacy',
      text: 'legacy payload',
    } satisfies AssistantDeltaEvent;

    expect((legacyEvent as AssistantDeltaEvent).runId).toBeUndefined();
    expect(groupByRunId([legacyEvent]).size).toBe(0);
  });

  it('supports toolCallId on both tool_call and tool_result payloads', () => {
    const toolCallEvent = {
      type: 'assistant.tool_call',
      sessionId: 'session-1',
      messageId: 'msg-assistant-1',
      runId: 'run-a',
      toolCallId: 'tool-call-001',
      toolCall: {
        function: {
          name: 'browser_navigate',
        },
      },
    } satisfies AssistantToolCallEvent;

    const toolResultEvent = {
      type: 'assistant.tool_result',
      sessionId: 'session-1',
      messageId: 'msg-assistant-1',
      runId: 'run-a',
      toolCallId: 'tool-call-001',
      result: '{"ok":true}',
    } satisfies AssistantToolResultEvent;

    expect(toolCallEvent.toolCallId).toBe('tool-call-001');
    expect(toolResultEvent.toolCallId).toBe('tool-call-001');
  });

  it('keeps role/source mapping deterministic for all runtime events', () => {
    const samples: SessionEvent[] = [
      {
        type: 'message.created',
        sessionId: 'session-1',
        messageId: 'msg-user-1',
        content: 'hello',
      },
      {
        type: 'assistant.started',
        sessionId: 'session-1',
        messageId: 'msg-assistant-1',
      },
      {
        type: 'assistant.tool_result',
        sessionId: 'session-1',
        messageId: 'msg-assistant-1',
        result: '{}',
      },
      {
        type: 'run.error',
        sessionId: 'session-1',
        error: 'oops',
      },
    ];

    expect(samples.map((event) => resolveEventSourceRole(event))).toEqual([
      'user',
      'assistant',
      'assistant',
      'system',
    ]);
  });
});
