import { describe, it, expect, vi } from 'vitest';
import {
  createMockSessionEventHub,
  createMockConversationManager,
  createMockSessionLock,
  cleanupMockMocks,
} from './utils/sse-test-utils.js';
import {
  mockSnapshotEvent,
  mockMessageCreatedEvent,
  mockAssistantDeltaEvent,
  mockRunErrorEvent,
  createMockEventSequence,
} from '@mocks/sse-event-mocks.js';

describe('SSE Test Utils', () => {
  afterEach(() => {
    cleanupMockMocks();
  });

  describe('createMockSessionEventHub', () => {
    it('should create a mock hub with subscribe method', () => {
      const hub = createMockSessionEventHub();
      expect(hub.subscribe).toBeDefined();
      expect(hub.publish).toBeDefined();
      expect(hub.getSubscriberCount).toBeDefined();
      expect(hub._subscribers).toBeDefined();
      expect(hub._clear).toBeDefined();
    });

    it('should allow subscribing and receiving events', () => {
      const hub = createMockSessionEventHub();
      const callback = vi.fn();

      hub.subscribe('session-1', callback);
      hub.publish('session-1', mockMessageCreatedEvent());

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'message.created' })
      );
    });

    it('should return unsubscribe function', () => {
      const hub = createMockSessionEventHub();
      const callback = vi.fn();

      const unsubscribe = hub.subscribe('session-1', callback);
      unsubscribe();

      hub.publish('session-1', mockMessageCreatedEvent());

      expect(callback).not.toHaveBeenCalled();
    });

    it('should cleanup session when last subscriber unsubscribes', () => {
      const hub = createMockSessionEventHub();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsubscribe1 = hub.subscribe('session-1', callback1);
      hub.subscribe('session-1', callback2);

      expect(hub._subscribers.size).toBe(1);

      unsubscribe1();

      expect(hub._subscribers.size).toBe(1); // Still has callback2

      hub._clear();

      expect(hub._subscribers.size).toBe(0);
    });

    it('should handle publish errors gracefully', () => {
      const hub = createMockSessionEventHub({ shouldFailOnPublish: true });
      const callback = vi.fn();

      hub.subscribe('session-1', callback);

      expect(() => {
        hub.publish('session-1', mockMessageCreatedEvent());
      }).toThrow('Failed to publish event');
    });
  });

  describe('createMockConversationManager', () => {
    it('should create a mock manager with all methods', () => {
      const manager = createMockConversationManager();
      expect(manager.createSession).toBeDefined();
      expect(manager.getSession).toBeDefined();
      expect(manager.listSessions).toBeDefined();
      expect(manager.addMessage).toBeDefined();
      expect(manager.deleteSession).toBeDefined();
      expect(manager.close).toBeDefined();
    });

    it('should create sessions', () => {
      const manager = createMockConversationManager();
      const session = manager.createSession({
        id: 'test-123',
        title: 'Test Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      expect(session).toBeDefined();
      expect(session.id).toBe('test-123');
    });

    it('should fail on create when configured', () => {
      const manager = createMockConversationManager({
        shouldFailOnCreate: true,
      });

      expect(() => {
        manager.createSession({
          id: 'test-123',
          title: 'Test Session',
        });
      }).toThrow('Failed to create session');
    });
  });

  describe('createMockSessionLock', () => {
    it('should create a mock lock with all methods', () => {
      const lock = createMockSessionLock();
      expect(lock.acquire).toBeDefined();
      expect(lock.release).toBeDefined();
      expect(lock.isLocked).toBeDefined();
      expect(lock.getActiveRun).toBeDefined();
      expect(lock._clear).toBeDefined();
      expect(lock._activeRuns).toBeDefined();
    });

    it('should acquire lock for unlocked session', () => {
      const lock = createMockSessionLock();
      const result = lock.acquire('session-1', 'run-1');

      expect(result).toBe(true);
      expect(lock.isLocked('session-1')).toBe(true);
      expect(lock.getActiveRun('session-1')).toBe('run-1');
    });

    it('should fail to acquire locked session', () => {
      const lock = createMockSessionLock();
      lock.acquire('session-1', 'run-1');

      const result = lock.acquire('session-1', 'run-2');

      expect(result).toBe(false);
    });

    it('should release lock with matching runId', () => {
      const lock = createMockSessionLock();
      lock.acquire('session-1', 'run-1');

      lock.release('session-1', 'run-1');

      expect(lock.isLocked('session-1')).toBe(false);
    });

    it('should not release lock with non-matching runId', () => {
      const lock = createMockSessionLock();
      lock.acquire('session-1', 'run-1');

      lock.release('session-1', 'run-2');

      expect(lock.isLocked('session-1')).toBe(true);
    });

    it('should clear all locks and timers', () => {
      const lock = createMockSessionLock();
      lock.acquire('session-1', 'run-1');
      lock.acquire('session-2', 'run-2');

      lock._clear();

      expect(lock._activeRuns.size).toBe(0);
    });
  });
});

describe('SSE Event Mocks', () => {
  describe('mockSnapshotEvent', () => {
    it('should create valid session.snapshot event', () => {
      const event = mockSnapshotEvent();

      expect(event.type).toBe('session.snapshot');
      expect(event.sessionId).toBe('test-session-id');
      expect(event.state).toBe('idle');
      expect(event.messages).toEqual([]);
    });

    it('should allow overriding properties', () => {
      const event = mockSnapshotEvent({
        sessionId: 'custom-session',
        state: 'running',
      });

      expect(event.sessionId).toBe('custom-session');
      expect(event.state).toBe('running');
    });
  });

  describe('mockMessageCreatedEvent', () => {
    it('should create valid message.created event', () => {
      const event = mockMessageCreatedEvent();

      expect(event.type).toBe('message.created');
      expect(event.sessionId).toBe('test-session-id');
      expect(event.messageId).toBe('msg-test-123');
      expect(event.content).toBe('Test message content');
    });

    it('should allow overriding properties', () => {
      const event = mockMessageCreatedEvent({
        content: 'Custom content',
      });

      expect(event.content).toBe('Custom content');
    });
  });

  describe('mockAssistantDeltaEvent', () => {
    it('should create valid assistant.delta event', () => {
      const event = mockAssistantDeltaEvent();

      expect(event.type).toBe('assistant.delta');
      expect(event.sessionId).toBe('test-session-id');
      expect(event.messageId).toBe('msg-assistant-456');
      expect(event.text).toBe('Test delta text');
    });

    it('should allow overriding text', () => {
      const event = mockAssistantDeltaEvent({
        text: 'Hello world',
      });

      expect(event.text).toBe('Hello world');
    });
  });

  describe('mockRunErrorEvent', () => {
    it('should create valid run.error event', () => {
      const event = mockRunErrorEvent();

      expect(event.type).toBe('run.error');
      expect(event.sessionId).toBe('test-session-id');
      expect(event.error).toBe('Test error message');
    });

    it('should allow overriding error message', () => {
      const event = mockRunErrorEvent({
        error: 'Custom error',
      });

      expect(event.error).toBe('Custom error');
    });
  });

  describe('createMockEventSequence', () => {
    it('should create a complete event sequence', () => {
      const sequence = createMockEventSequence('my-session');

      expect(sequence).toHaveLength(6);
      expect(sequence[0].event.type).toBe('message.created');
      expect(sequence[1].event.type).toBe('assistant.started');
      expect(sequence[2].event.type).toBe('assistant.thinking');
      expect(sequence[3].event.type).toBe('assistant.delta');
      expect(sequence[4].event.type).toBe('assistant.delta');
      expect(sequence[5].event.type).toBe('assistant.completed');
    });

    it('should use custom session ID', () => {
      const sequence = createMockEventSequence('custom-123');

      sequence.forEach(item => {
        expect(item.event.sessionId).toBe('custom-123');
      });
    });
  });
});
