import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionEventHub, type SessionEvent, type SSESubscriber } from '../services/session-event-hub.js';

describe('SessionEventHub', () => {
  let hub: SessionEventHub;

  beforeEach(() => {
    // Reset singleton between tests
    SessionEventHub.resetInstance();
    hub = SessionEventHub.getInstance();
  });

  describe('singleton pattern', () => {
    it('returns the same instance', () => {
      const instance1 = SessionEventHub.getInstance();
      const instance2 = SessionEventHub.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('subscribe', () => {
    it('returns unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = hub.subscribe('session-1', callback);
      expect(typeof unsubscribe).toBe('function');
    });

    it('registers subscriber and receives events', () => {
      const callback = vi.fn();
      hub.subscribe('session-1', callback);

      const event: SessionEvent = { type: 'message.created', sessionId: 'session-1', messageId: 'msg-1', content: 'hello' };
      hub.publish('session-1', event);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(event);
    });

    it('supports multiple subscribers for same session', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      hub.subscribe('session-1', callback1);
      hub.subscribe('session-1', callback2);
      hub.subscribe('session-1', callback3);

      const event: SessionEvent = { type: 'message.created', sessionId: 'session-1', messageId: 'msg-1', content: 'hello' };
      hub.publish('session-1', event);

      expect(callback1).toHaveBeenCalledWith(event);
      expect(callback2).toHaveBeenCalledWith(event);
      expect(callback3).toHaveBeenCalledWith(event);
    });

    it('returns correct subscriber count', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      hub.subscribe('session-1', callback1);
      expect(hub.getSubscriberCount('session-1')).toBe(1);

      hub.subscribe('session-1', callback2);
      expect(hub.getSubscriberCount('session-1')).toBe(2);
    });

    it('returns 0 for non-existent session', () => {
      expect(hub.getSubscriberCount('non-existent')).toBe(0);
    });
  });

  describe('unsubscribe', () => {
    it('removes subscriber when unsubscribe is called', () => {
      const callback = vi.fn();
      const unsubscribe = hub.subscribe('session-1', callback);

      unsubscribe();

      const event: SessionEvent = { type: 'message.created', sessionId: 'session-1', messageId: 'msg-1', content: 'hello' };
      hub.publish('session-1', event);

      expect(callback).not.toHaveBeenCalled();
    });

    it('cleans up session from Map when last subscriber disconnects', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      const unsub1 = hub.subscribe('session-1', callback1);
      const unsub2 = hub.subscribe('session-1', callback2);
      const unsub3 = hub.subscribe('session-1', callback3);

      expect(hub.getSubscriberCount('session-1')).toBe(3);

      unsub1();
      expect(hub.getSubscriberCount('session-1')).toBe(2);

      unsub2();
      expect(hub.getSubscriberCount('session-1')).toBe(1);

      // Last unsubscribe should remove session from Map
      unsub3();
      expect(hub.getSubscriberCount('session-1')).toBe(0);
    });

    it('does not affect other sessions when unsubscribing', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsub1 = hub.subscribe('session-1', callback1);
      hub.subscribe('session-2', callback2);

      unsub1();

      expect(hub.getSubscriberCount('session-1')).toBe(0);
      expect(hub.getSubscriberCount('session-2')).toBe(1);
    });
  });

  describe('publish', () => {
    it('does nothing for non-existent session', () => {
      // Should not throw
      const event: SessionEvent = { type: 'message.created', sessionId: 'non-existent', messageId: 'msg-1', content: 'hello' };
      expect(() => hub.publish('non-existent', event)).not.toThrow();
    });

    it('delivers event to all subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      hub.subscribe('session-1', callback1);
      hub.subscribe('session-1', callback2);

      const event: SessionEvent = { type: 'assistant.delta', sessionId: 'session-1', messageId: 'msg-1', text: 'world' };
      hub.publish('session-1', event);

      expect(callback1).toHaveBeenCalledWith(event);
      expect(callback2).toHaveBeenCalledWith(event);
    });

    it('continues delivering to other subscribers if one throws', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Subscriber error');
      });
      const normalCallback = vi.fn();

      hub.subscribe('session-1', errorCallback);
      hub.subscribe('session-1', normalCallback);

      const event: SessionEvent = { type: 'message.created', sessionId: 'session-1', messageId: 'msg-1', content: 'hello' };

      // Should not throw and should continue to other subscribers
      expect(() => hub.publish('session-1', event)).not.toThrow();

      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
    });

    it('handles multiple events in sequence', () => {
      const callback = vi.fn();
      hub.subscribe('session-1', callback);

      const events: SessionEvent[] = [
        { type: 'assistant.started', sessionId: 'session-1', messageId: 'msg-1' },
        { type: 'assistant.delta', sessionId: 'session-1', messageId: 'msg-1', text: 'Hello' },
        { type: 'assistant.delta', sessionId: 'session-1', messageId: 'msg-1', text: ' World' },
        { type: 'assistant.completed', sessionId: 'session-1', messageId: 'msg-1' },
      ];

      for (const event of events) {
        hub.publish('session-1', event);
      }

      expect(callback).toHaveBeenCalledTimes(4);
      events.forEach((event, index) => {
        expect(callback).toHaveBeenNthCalledWith(index + 1, event);
      });
    });
  });

  describe('memory management', () => {
    it('releases all resources after unsubscribe', () => {
      const callback = vi.fn();
      const unsubscribe = hub.subscribe('session-1', callback);

      // Verify subscriber exists
      expect(hub.getSubscriberCount('session-1')).toBe(1);

      // Unsubscribe
      unsubscribe();

      // Verify cleanup
      expect(hub.getSubscriberCount('session-1')).toBe(0);
    });

    it('handles double unsubscribe gracefully', () => {
      const callback = vi.fn();
      const unsubscribe = hub.subscribe('session-1', callback);

      unsubscribe();
      // Second unsubscribe should be idempotent
      expect(() => unsubscribe()).not.toThrow();
      expect(hub.getSubscriberCount('session-1')).toBe(0);
    });
  });

  describe('error handling', () => {
    it('catches errors in subscriber callbacks', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Test error');
      });
      const successCallback = vi.fn();

      hub.subscribe('session-1', errorCallback);
      hub.subscribe('session-1', successCallback);

      const event: SessionEvent = { type: 'message.created', sessionId: 'session-1', messageId: 'msg-1', content: 'hello' };

      // Should not throw
      expect(() => hub.publish('session-1', event)).not.toThrow();

      // Both should be called despite error in first
      expect(errorCallback).toHaveBeenCalled();
      expect(successCallback).toHaveBeenCalled();
    });

    it('handles unsubscribe when session was externally removed', () => {
      const callback = vi.fn();
      const unsubscribe = hub.subscribe('session-1', callback);

      // Simulate external cleanup (e.g., clearAll or session expiry)
      (hub as unknown as { subscribers: Map<string, Map<string, SSESubscriber>> }).subscribers.clear();

      // Should not throw when unsubscribing from cleared session
      expect(() => unsubscribe()).not.toThrow();
      expect(hub.getSubscriberCount('session-1')).toBe(0);
    });
  });

  describe('multiple sessions', () => {
    it('isolates events between sessions', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      hub.subscribe('session-1', callback1);
      hub.subscribe('session-2', callback2);

      const event1: SessionEvent = { type: 'message.created', sessionId: 'session-1', messageId: 'msg-1', content: 'session-1-data' };
      const event2: SessionEvent = { type: 'message.created', sessionId: 'session-2', messageId: 'msg-2', content: 'session-2-data' };

      hub.publish('session-1', event1);
      hub.publish('session-2', event2);

      expect(callback1).toHaveBeenCalledWith(event1);
      expect(callback1).toHaveBeenCalledTimes(1);

      expect(callback2).toHaveBeenCalledWith(event2);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('tracks subscriber counts independently', () => {
      hub.subscribe('session-1', vi.fn());
      hub.subscribe('session-1', vi.fn());
      hub.subscribe('session-2', vi.fn());
      hub.subscribe('session-2', vi.fn());
      hub.subscribe('session-2', vi.fn());

      expect(hub.getSubscriberCount('session-1')).toBe(2);
      expect(hub.getSubscriberCount('session-2')).toBe(3);
    });
  });

  describe('emit methods', () => {
    it('emitJobQueued publishes job.queued event with correct shape', () => {
      const callback = vi.fn();
      hub.subscribe('session-1', callback);

      const now = Date.now();
      hub.emitJobQueued('session-1', {
        jobId: 'job-1',
        messageId: 'msg-1',
        contentPreview: 'Hello world',
        createdAt: now,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('job.queued');
      expect(event.sessionId).toBe('session-1');
      expect(event.job).toEqual({
        jobId: 'job-1',
        sessionId: 'session-1',
        messageId: 'msg-1',
        contentPreview: 'Hello world',
        createdAt: new Date(now).toISOString(),
        status: 'queued',
      });
    });

    it('emitJobStarted publishes job.started event with correct shape', () => {
      const callback = vi.fn();
      hub.subscribe('session-1', callback);

      hub.emitJobStarted('session-1', 'job-1');

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('job.started');
      expect(event.sessionId).toBe('session-1');
      expect(event.jobId).toBe('job-1');
    });

    it('emitJobCancelled publishes job.cancelled event with correct shape', () => {
      const callback = vi.fn();
      hub.subscribe('session-1', callback);

      hub.emitJobCancelled('session-1', 'job-1');

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('job.cancelled');
      expect(event.sessionId).toBe('session-1');
      expect(event.jobId).toBe('job-1');
    });

    it('emitJobCompleted publishes job.completed event with correct shape', () => {
      const callback = vi.fn();
      hub.subscribe('session-1', callback);

      hub.emitJobCompleted('session-1', 'job-1');

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0];
      expect(event.type).toBe('job.completed');
      expect(event.sessionId).toBe('session-1');
      expect(event.jobId).toBe('job-1');
    });

    it('emit methods do nothing when no subscribers exist', () => {
      // Should not throw for any emit method without subscribers
      expect(() => {
        hub.emitJobQueued('no-subs', { jobId: 'j1', messageId: 'm1', contentPreview: 'c', createdAt: Date.now() });
        hub.emitJobStarted('no-subs', 'j1');
        hub.emitJobCancelled('no-subs', 'j1');
        hub.emitJobCompleted('no-subs', 'j1');
      }).not.toThrow();
    });
  });
});