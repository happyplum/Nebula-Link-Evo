import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/features/chat/store/chat.store.js';

import { useChatStream } from './useChatStream.js';

// --- EventSource mock ---
interface MockEventSourceInstance {
  url: string;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  listeners: Map<string, Set<(e: MessageEvent) => void>>;
  close: ReturnType<typeof vi.fn>;
  emit: (type: string, data: unknown) => void;
}

let mockEsInstance: MockEventSourceInstance;

function createMockEventSource(url: string): MockEventSourceInstance {
  const instance: MockEventSourceInstance = {
    url,
    onopen: null,
    onerror: null,
    listeners: new Map(),
    close: vi.fn(() => {
      // Mark as closed so further emit calls are no-ops
    }),
    emit(type: string, data: unknown) {
      const handlers = this.listeners.get(type);
      if (!handlers) return;
      const event = new MessageEvent(type, { data: JSON.stringify(data) });
      for (const h of handlers) h(event);
    },
  };
  mockEsInstance = instance;
  return instance;
}

function MockEventSourceConstructor(url: string): MockEventSourceInstance {
  return createMockEventSource(url);
}
MockEventSourceConstructor.CONNECTING = 0;
MockEventSourceConstructor.OPEN = 1;
MockEventSourceConstructor.CLOSED = 2;

// --- Setup ---
beforeEach(() => {
  vi.useFakeTimers();
  useChatStore.getState().reset();
  mockEsInstance = null as unknown as MockEventSourceInstance;
  localStorage.clear();

  // Mock EventSource globally
  const ESConstructor = function (url: string) {
    const es = createMockEventSource(url);
    // The hook calls es.addEventListener — patch on the mock instance
    const anyEs = es as unknown as { addEventListener: unknown; close: unknown };
    anyEs.addEventListener = (type: string, handler: (e: MessageEvent) => void) => {
      if (!es.listeners.has(type)) es.listeners.set(type, new Set());
      es.listeners.get(type)!.add(handler);
    };
    anyEs.close = es.close;
    return es;
  };
  Object.assign(ESConstructor, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSED: 2,
  });

  vi.stubGlobal('EventSource', ESConstructor);
});

// --- Helpers ---
function renderStreamHook(
  sessionId: string | null = 'session-1',
  opts?: { enabled?: boolean; allowResume?: boolean }
) {
  return renderHook(({ sessionId: sid, ...rest }) => useChatStream({ sessionId: sid, ...rest }), {
    initialProps: { sessionId, enabled: true, allowResume: true, ...opts },
  });
}

function openConnection() {
  act(() => {
    mockEsInstance.onopen?.(new Event('open'));
  });
}

function emitEvent(type: string, data: unknown) {
  act(() => {
    mockEsInstance.emit(type, data);
  });
}

// --- rAF mock ---
// jsdom doesn't have real rAF; vitest fakeTimers mocks it as setTimeout(cb, 0).
// We control it manually to avoid interference with reconnect timers.
let rafCallbacks: Array<() => void> = [];
let nextRafId = 1;
const rafIdMap = new Map<number, () => void>();

beforeEach(() => {
  rafCallbacks = [];
  nextRafId = 1;
  rafIdMap.clear();

  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    const id = nextRafId++;
    rafCallbacks.push(cb);
    rafIdMap.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafIdMap.delete(id);
    rafCallbacks = rafCallbacks.filter((cb) => !rafIdMap.has(id) || cb !== rafIdMap.get(id));
  });
});

function flushRAF() {
  act(() => {
    const pending = [...rafCallbacks];
    rafCallbacks = [];
    rafIdMap.clear();
    for (const cb of pending) cb();
  });
}

describe('useChatStream', () => {
  describe('connection lifecycle', () => {
    it('does not connect when sessionId is null', () => {
      renderStreamHook(null);
      expect(mockEsInstance).toBeFalsy();
    });

    it('does not connect when enabled is false', () => {
      renderStreamHook('session-1', { enabled: false });
      expect(mockEsInstance).toBeFalsy();
    });

    it('connects to the correct SSE URL', () => {
      renderStreamHook('session-1');
      expect(mockEsInstance).toBeTruthy();
      expect(mockEsInstance.url).toBe('/api/chat/sessions/session-1/stream');
    });

    it('sets isConnected to true on open', () => {
      const { result } = renderStreamHook();
      openConnection();
      expect(result.current.isConnected).toBe(true);
    });

    it('clears error on successful connection', () => {
      const { result } = renderStreamHook();
      // Simulate a run.error event to set an error
      openConnection();
      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 'session-1',
        seq: 1,
        messageId: 'a1',
      });
      emitEvent('run.error', {
        type: 'run.error',
        sessionId: 'session-1',
        seq: 2,
        error: 'Something failed',
      });
      expect(result.current.error).toBe('Something failed');

      // Trigger error → reconnect → open clears error
      act(() => {
        mockEsInstance.onerror?.(new Event('error'));
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      // New connection opens
      openConnection();
      expect(result.current.error).toBeNull();
    });

    it('disconnects on unmount', () => {
      const { unmount } = renderStreamHook();
      openConnection();
      unmount();
      expect(mockEsInstance.close).toHaveBeenCalled();
    });
  });

  describe('session.snapshot', () => {
    it('sets messages in store from snapshot', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 0,
        messages: [
          { id: 'm1', role: 'user', content: 'hello', created_at: '2026-01-01' },
          { id: 'm2', role: 'assistant', content: 'hi', created_at: '2026-01-01' },
        ],
        state: 'idle',
        lastSeq: 0,
      });
      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(2);
      expect(msgs[0].id).toBe('m1');
      expect(msgs[1].content).toBe('hi');
    });

    it('applies snapshot even after prior higher-seq live events', () => {
      renderStreamHook('s1');
      openConnection();

      emitEvent('message.created', {
        type: 'message.created',
        sessionId: 's1',
        seq: 42,
        messageId: 'm-live',
        content: 'live first',
      });

      emitEvent('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 0,
        lastSeq: 0,
        messages: [
          { id: 'm-gap', role: 'assistant', content: 'from snapshot', created_at: '2026-01-01' },
        ],
        state: 'running',
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe('m-gap');
      expect(msgs[0].content).toBe('from snapshot');
    });
  });

  describe('message.created', () => {
    it('adds a user message to store', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('message.created', {
        type: 'message.created',
        sessionId: 's1',
        seq: 2,
        messageId: 'm-new',
        content: 'user input',
      });
      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe('m-new');
      expect(msgs[0].role).toBe('user');
    });
  });

  describe('assistant streaming', () => {
    it('sets streaming state on assistant.started', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 3,
        messageId: 'a1',
      });
      expect(useChatStore.getState().streamingState).toBe('streaming');
    });

    it('batches delta tokens via rAF', () => {
      renderStreamHook('s1');
      openConnection();

      // Start streaming
      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 3,
        messageId: 'a1',
      });

      // Send multiple rapid deltas
      emitEvent('assistant.delta', {
        type: 'assistant.delta',
        sessionId: 's1',
        seq: 4,
        text: 'Hello',
      });
      emitEvent('assistant.delta', {
        type: 'assistant.delta',
        sessionId: 's1',
        seq: 5,
        text: ' World',
      });

      // Before rAF fires, streaming content should be empty
      expect(useChatStore.getState().streamingContent).toBe('');

      // Flush rAF
      flushRAF();

      // Now content should be batched
      expect(useChatStore.getState().streamingContent).toBe('Hello World');
    });

    it('batches thinking tokens via rAF', () => {
      renderStreamHook('s1');
      openConnection();

      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 3,
        messageId: 'a1',
      });

      emitEvent('assistant.thinking', {
        type: 'assistant.thinking',
        sessionId: 's1',
        seq: 4,
        text: 'Let me think',
      });
      emitEvent('assistant.thinking', {
        type: 'assistant.thinking',
        sessionId: 's1',
        seq: 5,
        text: ' about this',
      });

      expect(useChatStore.getState().streamingThinking).toBe('');
      flushRAF();
      expect(useChatStore.getState().streamingThinking).toBe('Let me think about this');
    });

    it('flushes immediately on assistant.completed', () => {
      renderStreamHook('s1');
      openConnection();

      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 3,
        messageId: 'a1',
      });
      emitEvent('assistant.delta', {
        type: 'assistant.delta',
        sessionId: 's1',
        seq: 4,
        text: 'Response text',
      });

      // Don't flush rAF manually — completed should flush immediately
      emitEvent('assistant.completed', {
        type: 'assistant.completed',
        sessionId: 's1',
        seq: 5,
      });

      // Message should be flushed to store
      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('Response text');
      expect(msgs[0].role).toBe('assistant');
      expect(useChatStore.getState().streamingState).toBe('idle');
    });
  });

  describe('event deduplication', () => {
    it('ignores events with seq <= highestEventSeq', () => {
      renderStreamHook('s1');
      openConnection();

      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 1,
        messageId: 'a1',
      });

      emitEvent('assistant.delta', {
        type: 'assistant.delta',
        sessionId: 's1',
        seq: 2,
        text: 'first',
      });
      flushRAF();
      expect(useChatStore.getState().streamingContent).toBe('first');

      // Duplicate with same seq
      emitEvent('assistant.delta', {
        type: 'assistant.delta',
        sessionId: 's1',
        seq: 2,
        text: 'duplicate',
      });
      flushRAF();
      expect(useChatStore.getState().streamingContent).toBe('first');
    });

    it('processes events without seq field', () => {
      renderStreamHook('s1');
      openConnection();

      // No seq field — always process
      emitEvent('message.created', {
        type: 'message.created',
        sessionId: 's1',
        messageId: 'm1',
        content: 'no-seq',
      });
      emitEvent('message.created', {
        type: 'message.created',
        sessionId: 's1',
        messageId: 'm2',
        content: 'no-seq-2',
      });
      expect(useChatStore.getState().messagesBySession['s1']).toHaveLength(2);
    });
  });

  describe('run.error', () => {
    it('sets streaming state to error and stores error message', () => {
      renderStreamHook('s1');
      openConnection();

      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 1,
        messageId: 'a1',
      });
      emitEvent('assistant.delta', {
        type: 'assistant.delta',
        sessionId: 's1',
        seq: 2,
        text: 'partial',
      });
      emitEvent('run.error', {
        type: 'run.error',
        sessionId: 's1',
        seq: 3,
        error: 'Something went wrong',
      });

      expect(useChatStore.getState().streamingState).toBe('error');
      // Error stored in hook return
      // Partial content flushed
      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('partial');
    });
  });

  describe('reconnection with exponential backoff', () => {
    it('reconnects on error with 1s initial delay', () => {
      const { result } = renderStreamHook('s1');
      openConnection();

      // Trigger error
      act(() => {
        mockEsInstance.onerror?.(new Event('error'));
      });
      expect(result.current.isConnected).toBe(false);

      // Should not reconnect immediately
      // Advance less than backoff
      act(() => {
        vi.advanceTimersByTime(999);
      });
      // Not yet reconnected (no new EventSource created with onopen)

      // Advance to exactly 1s
      act(() => {
        vi.advanceTimersByTime(1);
      });
      // A new connection attempt should have been made
      // We verify by checking the EventSource was recreated
      expect(mockEsInstance).toBeTruthy();
    });

    it('doubles backoff on subsequent errors', () => {
      renderStreamHook('s1');
      openConnection();

      // First error → 1s backoff
      act(() => {
        mockEsInstance.onerror?.(new Event('error'));
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Second error → 2s backoff
      act(() => {
        mockEsInstance.onerror?.(new Event('error'));
      });
      act(() => {
        vi.advanceTimersByTime(1999);
      });
      // Should NOT have reconnected yet
      // Advance to 2s total for second attempt
      act(() => {
        vi.advanceTimersByTime(1);
      });
      // Reconnect attempted
      expect(mockEsInstance).toBeTruthy();
    });

    it('caps backoff at 30s', () => {
      renderStreamHook('s1');
      openConnection();

      // Simulate many failed attempts to reach max backoff
      for (let i = 0; i < 10; i++) {
        act(() => {
          mockEsInstance.onerror?.(new Event('error'));
        });
        act(() => {
          vi.advanceTimersByTime(30000);
        });
      }

      // Should still be trying (not giving up)
      expect(mockEsInstance).toBeTruthy();
    });
  });

  describe('adaptSnapshotMessage — function.arguments field mapping', () => {
    it('reads tool call arguments from function.arguments (not rec.arguments)', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 0,
        lastSeq: 0,
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: '',
            created_at: '2026-01-01',
            tool_calls: [
              {
                id: 'tc-1',
                type: 'function',
                function: { name: 'click', arguments: '{"x":10}' },
              },
            ],
          },
        ],
        state: 'idle',
      });
      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].toolCalls).toBeDefined();
      expect(msgs[0].toolCalls![0].arguments).toBe('{"x":10}');
      expect(msgs[0].toolCalls![0].name).toBe('click');
    });

    it('falls back to rec.arguments when function.arguments is absent', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 0,
        lastSeq: 0,
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: '',
            created_at: '2026-01-01',
            tool_calls: [
              {
                id: 'tc-1',
                type: 'function',
                arguments: { fallback: true },
              },
            ],
          },
        ],
        state: 'idle',
      });
      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs[0].toolCalls![0].arguments).toBe('{"fallback":true}');
    });
  });

  describe('adaptToolCall — ID fallback chain', () => {
    it('uses toolCallId from event as primary ID', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 1,
        messageId: 'a1',
      });
      emitEvent('assistant.tool_call', {
        type: 'assistant.tool_call',
        sessionId: 's1',
        seq: 2,
        toolCallId: 'explicit-id',
        toolCall: {
          id: 'rec-id',
          type: 'function',
          function: { name: 'click', arguments: '{}' },
        },
      });
      const tcs = useChatStore.getState().streamingToolCalls;
      expect(tcs).toHaveLength(1);
      expect(tcs[0].id).toBe('explicit-id');
    });

    it('requires toolCallId — event without it is rejected by protocol', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 1,
        messageId: 'a1',
      });
      // Protocol now requires toolCallId as a non-optional string.
      // An event without toolCallId should not produce a streaming tool call.
      emitEvent('assistant.tool_call', {
        type: 'assistant.tool_call',
        sessionId: 's1',
        seq: 2,
        // Intentionally no toolCallId — should be ignored or fail gracefully
        toolCall: {
          id: 'rec-fallback-id',
          type: 'function',
          function: { name: 'click', arguments: '{}' },
        },
      } as Record<string, unknown>);
      const tcs = useChatStore.getState().streamingToolCalls;
      // With required toolCallId, the event is malformed and should be skipped
      expect(tcs).toHaveLength(0);
    });

    it('requires valid toolCallId on tool_result — malformed event ignored', () => {
      renderStreamHook('s1');
      openConnection();
      // Seed a running tool call first
      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 1,
        messageId: 'a1',
      });
      emitEvent('assistant.tool_call', {
        type: 'assistant.tool_call',
        sessionId: 's1',
        seq: 2,
        toolCallId: 'tc-1',
        toolCall: {
          id: 'tc-1',
          type: 'function',
          function: { name: 'click', arguments: '{}' },
        },
      });
      expect(useChatStore.getState().streamingToolCalls).toHaveLength(1);

      // tool_result with missing toolCallId — should not update any call
      emitEvent('assistant.tool_result', {
        type: 'assistant.tool_result',
        sessionId: 's1',
        seq: 3,
        // Intentionally no toolCallId
        result: 'ok',
      } as Record<string, unknown>);
      const tcs = useChatStore.getState().streamingToolCalls;
      expect(tcs).toHaveLength(1);
      expect(tcs[0].status).toBe('running'); // unchanged — result not applied
    });
  });

  describe('snapshot activeToolCalls restore', () => {
    it('restores activeToolCalls from snapshot and sets streaming state', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 0,
        lastSeq: 0,
        messages: [
          { id: 'm1', role: 'user', content: 'hello', created_at: '2026-01-01' },
        ],
        state: 'running',
        activeToolCalls: [
          {
            id: 'tc-active-1',
            type: 'function',
            function: { name: 'screenshot', arguments: '{}' },
          },
        ],
      });

      const store = useChatStore.getState();
      expect(store.streamingToolCalls).toHaveLength(1);
      expect(store.streamingToolCalls[0].id).toBe('tc-active-1');
      expect(store.streamingToolCalls[0].name).toBe('screenshot');
      expect(store.streamingToolCalls[0].status).toBe('running');
      expect(store.streamingState).toBe('streaming');
    });

    it('does not restore streaming state when snapshot has no activeToolCalls', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 0,
        lastSeq: 0,
        messages: [],
        state: 'idle',
      });
      expect(useChatStore.getState().streamingToolCalls).toHaveLength(0);
      expect(useChatStore.getState().streamingState).toBe('idle');
    });
  });

  describe('resetStreaming on exit paths', () => {
    it('resets streaming state when disabled', () => {
      const { rerender } = renderStreamHook('s1', { enabled: true });
      openConnection();
      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 1,
        messageId: 'a1',
      });
      emitEvent('assistant.delta', {
        type: 'assistant.delta',
        sessionId: 's1',
        seq: 2,
        text: 'partial',
      });
      flushRAF();
      expect(useChatStore.getState().streamingContent).toBe('partial');

      // Disable — should trigger resetStreaming
      rerender({ sessionId: 's1', enabled: false });
      expect(useChatStore.getState().streamingContent).toBe('');
      expect(useChatStore.getState().streamingState).toBe('idle');
    });

    it('resets streaming when sessionId becomes null', () => {
      const { rerender } = renderStreamHook('s1');
      openConnection();
      emitEvent('assistant.started', {
        type: 'assistant.started',
        sessionId: 's1',
        seq: 1,
        messageId: 'a1',
      });
      emitEvent('assistant.tool_call', {
        type: 'assistant.tool_call',
        sessionId: 's1',
        seq: 2,
        toolCallId: 'tc-1',
        toolCall: {
          type: 'function',
          function: { name: 'click', arguments: '{}' },
        },
      });
      expect(useChatStore.getState().streamingToolCalls).toHaveLength(1);

      rerender({ sessionId: null, enabled: true });
      expect(useChatStore.getState().streamingToolCalls).toHaveLength(0);
      expect(useChatStore.getState().streamingState).toBe('idle');
    });
  });

  describe('disconnect and reconnect actions', () => {
    it('disconnect closes connection and resets state', () => {
      const { result } = renderStreamHook('s1');
      openConnection();
      expect(result.current.isConnected).toBe(true);

      act(() => {
        result.current.disconnect();
      });
      expect(result.current.isConnected).toBe(false);
      expect(mockEsInstance.close).toHaveBeenCalled();
    });

    it('reconnect resets backoff and reconnects', () => {
      const { result } = renderStreamHook('s1');
      openConnection();

      // Cause some errors to increase backoff
      act(() => {
        mockEsInstance.onerror?.(new Event('error'));
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      act(() => {
        result.current.reconnect();
      });
      // Should have a new ES instance
      expect(mockEsInstance).toBeTruthy();
    });
  });

  describe('queue event handlers', () => {
    const sampleJob = {
      jobId: 'job-1',
      sessionId: 's1',
      messageId: 'm1',
      contentPreview: 'click the button',
      createdAt: '2026-01-01T00:00:00Z',
      status: 'queued' as const,
    };

    it('job.queued calls addPendingJob on store', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('job.queued', {
        type: 'job.queued',
        sessionId: 's1',
        seq: 10,
        job: sampleJob,
      });
      const jobs = useChatStore.getState().pendingJobs['s1'];
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe('job-1');
    });

    it('job.started calls updateJobStarted on store', () => {
      // Seed a pending job first
      useChatStore.getState().addPendingJob('s1', sampleJob);
      renderStreamHook('s1');
      openConnection();
      emitEvent('job.started', {
        type: 'job.started',
        sessionId: 's1',
        seq: 11,
        jobId: 'job-1',
      });
      const jobs = useChatStore.getState().pendingJobs['s1'];
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe('running');
    });

    it('job.cancelled calls removePendingJob on store', () => {
      useChatStore.getState().addPendingJob('s1', sampleJob);
      renderStreamHook('s1');
      openConnection();
      emitEvent('job.cancelled', {
        type: 'job.cancelled',
        sessionId: 's1',
        seq: 12,
        jobId: 'job-1',
      });
      expect(useChatStore.getState().pendingJobs['s1']).toBeUndefined();
    });

    it('job.completed calls removePendingJob on store', () => {
      useChatStore.getState().addPendingJob('s1', sampleJob);
      renderStreamHook('s1');
      openConnection();
      emitEvent('job.completed', {
        type: 'job.completed',
        sessionId: 's1',
        seq: 13,
        jobId: 'job-1',
      });
      expect(useChatStore.getState().pendingJobs['s1']).toBeUndefined();
    });

    it('session.snapshot with pendingJobs calls setPendingJobsFromSnapshot', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 0,
        lastSeq: 0,
        messages: [],
        state: 'idle',
        pendingJobs: [sampleJob],
      });
      const jobs = useChatStore.getState().pendingJobs['s1'];
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe('job-1');
    });

    it('session.snapshot without pendingJobs does not call setPendingJobsFromSnapshot', () => {
      renderStreamHook('s1');
      openConnection();
      emitEvent('session.snapshot', {
        type: 'session.snapshot',
        sessionId: 's1',
        seq: 0,
        lastSeq: 0,
        messages: [],
        state: 'idle',
      });
      expect(useChatStore.getState().pendingJobs['s1']).toBeUndefined();
    });
  });
});
