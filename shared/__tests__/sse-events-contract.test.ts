import { describe, it, expect } from 'vitest';
import type {
  SessionSnapshotEvent,
  MessageCreatedEvent,
  AssistantStartedEvent,
  AssistantDeltaEvent,
  AssistantCompletedEvent,
  AssistantThinkingEvent,
  AssistantToolCallEvent,
  AssistantToolResultEvent,
  RunErrorEvent,
  SessionEvent,
} from '../types/sse-events.js';

describe('SSE Events Contract - JSON Decode Validation', () => {
  it('decodes session.snapshot event from JSON', () => {
    const json = JSON.stringify({
      type: 'session.snapshot',
      sessionId: 'sess-123',
      seq: 1,
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          created_at: new Date().toISOString(),
        },
      ],
      state: 'idle',
      jobId: 'job-456',
      agentState: {
        schema_version: 1,
        currentTask: {
          description: 'Task description',
          startedAt: new Date().toISOString(),
          completedSteps: 1,
        },
      },
    });

    const event = JSON.parse(json) as SessionSnapshotEvent;

    expect(event.type).toBe('session.snapshot');
    expect(event.sessionId).toBe('sess-123');
    expect(event.seq).toBe(1);
    expect(event.messages).toHaveLength(1);
    expect(event.messages[0].id).toBe('msg-1');
    expect(event.messages[0].role).toBe('user');
    expect(event.messages[0].content).toBe('Hello');
    expect(typeof event.messages[0].created_at).toBe('string');
    expect(event.state).toBe('idle');
    expect(event.jobId).toBe('job-456');
    expect(event.agentState?.schema_version).toBe(1);
  });

  it('decodes message.created event from JSON', () => {
    const json = JSON.stringify({
      type: 'message.created',
      sessionId: 'sess-123',
      runId: 'run-456',
      messageId: 'msg-789',
      content: 'User message',
      seq: 2,
    });

    const event = JSON.parse(json) as MessageCreatedEvent;

    expect(event.type).toBe('message.created');
    expect(event.sessionId).toBe('sess-123');
    expect(event.runId).toBe('run-456');
    expect(event.messageId).toBe('msg-789');
    expect(event.content).toBe('User message');
    expect(event.seq).toBe(2);
  });

  it('decodes assistant.started event from JSON', () => {
    const json = JSON.stringify({
      type: 'assistant.started',
      sessionId: 'sess-123',
      runId: 'run-456',
      messageId: 'msg-789',
      seq: 3,
    });

    const event = JSON.parse(json) as AssistantStartedEvent;

    expect(event.type).toBe('assistant.started');
    expect(event.sessionId).toBe('sess-123');
    expect(event.runId).toBe('run-456');
    expect(event.messageId).toBe('msg-789');
    expect(event.seq).toBe(3);
  });

  it('decodes assistant.delta event from JSON', () => {
    const json = JSON.stringify({
      type: 'assistant.delta',
      sessionId: 'sess-123',
      runId: 'run-456',
      messageId: 'msg-789',
      text: 'Hello world',
      seq: 4,
    });

    const event = JSON.parse(json) as AssistantDeltaEvent;

    expect(event.type).toBe('assistant.delta');
    expect(event.sessionId).toBe('sess-123');
    expect(event.runId).toBe('run-456');
    expect(event.messageId).toBe('msg-789');
    expect(event.text).toBe('Hello world');
    expect(event.seq).toBe(4);
  });

  it('decodes assistant.completed event from JSON', () => {
    const json = JSON.stringify({
      type: 'assistant.completed',
      sessionId: 'sess-123',
      runId: 'run-456',
      messageId: 'msg-789',
      terminal_reason: 'stop',
      seq: 5,
    });

    const event = JSON.parse(json) as AssistantCompletedEvent;

    expect(event.type).toBe('assistant.completed');
    expect(event.sessionId).toBe('sess-123');
    expect(event.runId).toBe('run-456');
    expect(event.messageId).toBe('msg-789');
    expect(event.terminal_reason).toBe('stop');
    expect(event.seq).toBe(5);
  });

  it('decodes assistant.thinking event from JSON', () => {
    const json = JSON.stringify({
      type: 'assistant.thinking',
      sessionId: 'sess-123',
      runId: 'run-456',
      messageId: 'msg-789',
      text: 'Thinking about the task...',
      seq: 6,
    });

    const event = JSON.parse(json) as AssistantThinkingEvent;

    expect(event.type).toBe('assistant.thinking');
    expect(event.sessionId).toBe('sess-123');
    expect(event.runId).toBe('run-456');
    expect(event.messageId).toBe('msg-789');
    expect(event.text).toBe('Thinking about the task...');
    expect(event.seq).toBe(6);
  });

  it('decodes assistant.tool_call event from JSON', () => {
    const json = JSON.stringify({
      type: 'assistant.tool_call',
      sessionId: 'sess-123',
      runId: 'run-456',
      messageId: 'msg-789',
      toolCallId: 'tc-101',
      toolCall: {
        function: { name: 'click' },
        arguments: '{"x": 100, "y": 200}',
        id: 'tc-101',
      },
      seq: 7,
    });

    const event = JSON.parse(json) as AssistantToolCallEvent;

    expect(event.type).toBe('assistant.tool_call');
    expect(event.sessionId).toBe('sess-123');
    expect(event.runId).toBe('run-456');
    expect(event.messageId).toBe('msg-789');
    expect(event.toolCallId).toBe('tc-101');
    expect(event.toolCall.function?.name).toBe('click');
    expect(typeof event.toolCall.arguments).toBe('string');
    expect(event.seq).toBe(7);
  });

  it('decodes assistant.tool_result event from JSON', () => {
    const json = JSON.stringify({
      type: 'assistant.tool_result',
      sessionId: 'sess-123',
      runId: 'run-456',
      messageId: 'msg-789',
      toolCallId: 'tc-101',
      result: 'Click successful',
      seq: 8,
    });

    const event = JSON.parse(json) as AssistantToolResultEvent;

    expect(event.type).toBe('assistant.tool_result');
    expect(event.sessionId).toBe('sess-123');
    expect(event.runId).toBe('run-456');
    expect(event.messageId).toBe('msg-789');
    expect(event.toolCallId).toBe('tc-101');
    expect(event.result).toBe('Click successful');
    expect(event.seq).toBe(8);
  });

  it('decodes run.error event from JSON', () => {
    const json = JSON.stringify({
      type: 'run.error',
      sessionId: 'sess-123',
      runId: 'run-456',
      error: 'Something went wrong',
      seq: 9,
    });

    const event = JSON.parse(json) as RunErrorEvent;

    expect(event.type).toBe('run.error');
    expect(event.sessionId).toBe('sess-123');
    expect(event.runId).toBe('run-456');
    expect(event.error).toBe('Something went wrong');
    expect(event.seq).toBe(9);
  });

  it('validates all 9 event variants in discriminated union', () => {
    const events: SessionEvent[] = [
      {
        type: 'session.snapshot',
        sessionId: 'sess-1',
        messages: [],
        state: 'idle',
      },
      {
        type: 'message.created',
        sessionId: 'sess-1',
        messageId: 'msg-1',
        content: 'content',
      },
      {
        type: 'assistant.started',
        sessionId: 'sess-1',
        messageId: 'msg-1',
      },
      {
        type: 'assistant.delta',
        sessionId: 'sess-1',
        messageId: 'msg-1',
        text: 'text',
      },
      {
        type: 'assistant.completed',
        sessionId: 'sess-1',
        messageId: 'msg-1',
      },
      {
        type: 'assistant.thinking',
        sessionId: 'sess-1',
        messageId: 'msg-1',
        text: 'thinking',
      },
      {
        type: 'assistant.tool_call',
        sessionId: 'sess-1',
        messageId: 'msg-1',
        toolCall: { function: { name: 'click' } },
      },
      {
        type: 'assistant.tool_result',
        sessionId: 'sess-1',
        messageId: 'msg-1',
        result: 'result',
      },
      {
        type: 'run.error',
        sessionId: 'sess-1',
        error: 'error',
      },
    ];

    expect(events).toHaveLength(9);
    events.forEach((event, index) => {
      expect(event).toBeDefined();
      expect(typeof event.type).toBe('string');
    });
  });
});
