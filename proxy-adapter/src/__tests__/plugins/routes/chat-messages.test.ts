import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../conversation/db.js';
import { ConversationManager } from '../../../conversation/manager.js';

describe('Message Pagination', () => {
  let db: DatabaseManager;
  let manager: ConversationManager;

  beforeEach(() => {
    db = DatabaseManager.getInstance();
    db.initialize(':memory:');
    manager = new ConversationManager(':memory:');
    manager.initialize();
  });

  afterEach(async () => {
    await manager.close();
    db.close();
  });

  describe('DatabaseManager.getMessagesPaginated', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = db.createSession({
        title: 'Pagination Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
    });

    it('should return empty result for session with no messages', () => {
      const result = db.getMessagesPaginated(sessionId, 10, 0);

      expect(result.messages).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(0);
    });

    it('should return correct first page', () => {
      for (let i = 0; i < 25; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const result = db.getMessagesPaginated(sessionId, 10, 0);

      expect(result.messages).toHaveLength(10);
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(25);
      expect(result.messages[0].content).toBe('Message 0');
      expect(result.messages[9].content).toBe('Message 9');
    });

    it('should return correct middle page', () => {
      for (let i = 0; i < 25; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const result = db.getMessagesPaginated(sessionId, 10, 10);

      expect(result.messages).toHaveLength(10);
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(25);
      expect(result.messages[0].content).toBe('Message 10');
      expect(result.messages[9].content).toBe('Message 19');
    });

    it('should return correct last page with fewer items', () => {
      for (let i = 0; i < 25; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const result = db.getMessagesPaginated(sessionId, 10, 20);

      expect(result.messages).toHaveLength(5);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(25);
      expect(result.messages[0].content).toBe('Message 20');
      expect(result.messages[4].content).toBe('Message 24');
    });

    it('should return empty when offset exceeds total', () => {
      for (let i = 0; i < 10; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const result = db.getMessagesPaginated(sessionId, 10, 100);

      expect(result.messages).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(10);
    });

    it('should return all messages when limit exceeds total', () => {
      for (let i = 0; i < 5; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const result = db.getMessagesPaginated(sessionId, 100, 0);

      expect(result.messages).toHaveLength(5);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(5);
    });

    it('should preserve message order (ASC by created_at)', () => {
      db.createMessage({
        session_id: sessionId,
        role: 'system',
        content: 'System prompt',
      });
      db.createMessage({
        session_id: sessionId,
        role: 'user',
        content: 'User message',
      });
      db.createMessage({
        session_id: sessionId,
        role: 'assistant',
        content: 'Assistant response',
      });

      const result = db.getMessagesPaginated(sessionId, 10, 0);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[2].role).toBe('assistant');
    });

    it('should include message metadata', () => {
      db.createMessage({
        session_id: sessionId,
        role: 'user',
        content: 'Message with metadata',
        metadata: { tokenCount: 10, model: 'test-model' },
      });

      const result = db.getMessagesPaginated(sessionId, 10, 0);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].metadata).toEqual({ tokenCount: 10, model: 'test-model' });
    });

    it('should handle different message roles', () => {
      db.createMessage({
        session_id: sessionId,
        role: 'system',
        content: 'System',
      });
      db.createMessage({
        session_id: sessionId,
        role: 'user',
        content: 'User',
      });
      db.createMessage({
        session_id: sessionId,
        role: 'assistant',
        content: 'Assistant',
      });
      db.createMessage({
        session_id: sessionId,
        role: 'tool',
        content: 'Tool',
      });

      const result = db.getMessagesPaginated(sessionId, 10, 0);

      expect(result.messages).toHaveLength(4);
      expect(result.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    });

    it('should isolate messages by session', () => {
      const session2 = db.createSession({
        title: 'Other Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      db.createMessage({
        session_id: sessionId,
        role: 'user',
        content: 'Session 1 message',
      });
      db.createMessage({
        session_id: session2.id,
        role: 'user',
        content: 'Session 2 message',
      });

      const result1 = db.getMessagesPaginated(sessionId, 10, 0);
      const result2 = db.getMessagesPaginated(session2.id, 10, 0);

      expect(result1.messages).toHaveLength(1);
      expect(result1.messages[0].content).toBe('Session 1 message');
      expect(result2.messages).toHaveLength(1);
      expect(result2.messages[0].content).toBe('Session 2 message');
    });

    it('should handle limit of 1', () => {
      for (let i = 0; i < 5; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const result = db.getMessagesPaginated(sessionId, 1, 0);

      expect(result.messages).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(5);
    });

    it('should handle offset at boundary', () => {
      for (let i = 0; i < 10; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const result = db.getMessagesPaginated(sessionId, 10, 10);

      expect(result.messages).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(10);
    });

    it('should calculate hasMore correctly for exact page', () => {
      for (let i = 0; i < 20; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const result = db.getMessagesPaginated(sessionId, 10, 10);

      expect(result.messages).toHaveLength(10);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(20);
    });

    // Note: "database not initialized" error cannot be tested because DatabaseManager
    // is a singleton that is initialized in beforeEach(). Without a resetInstance()
    // method in the implementation, this edge case is untestable without modifying
    // the source code (which violates the constraint of only writing tests).
  });

  describe('ConversationManager.getMessagesPaginated', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = manager.createSession({
        title: 'Manager Pagination Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
    });

    it('should delegate to DatabaseManager', () => {
      for (let i = 0; i < 15; i++) {
        manager.addMessage(sessionId, { role: 'user', content: `Message ${i}` });
      }

      const result = manager.getMessagesPaginated(sessionId, 10, 0);

      expect(result.messages).toHaveLength(10);
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(15);
    });

    it('should return empty result for non-existent session', () => {
      const result = manager.getMessagesPaginated('non-existent-id', 10, 0);

      expect(result.messages).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(0);
    });

    it('should work with messages added through manager', () => {
      manager.addMessage(sessionId, { role: 'system', content: 'System' });
      manager.addMessage(sessionId, { role: 'user', content: 'User 1' });
      manager.addMessage(sessionId, { role: 'assistant', content: 'Assistant 1' });
      manager.addMessage(sessionId, { role: 'user', content: 'User 2' });

      const result = manager.getMessagesPaginated(sessionId, 2, 1);

      expect(result.messages).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(4);
      expect(result.messages[0].content).toBe('User 1');
    });

    it('should include metadata from manager-added messages', () => {
      manager.addMessage(sessionId, {
        role: 'user',
        content: 'With metadata',
        metadata: { key: 'value', count: 42 },
      });

      const result = manager.getMessagesPaginated(sessionId, 10, 0);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].metadata).toEqual({ key: 'value', count: 42 });
    });
  });

  describe('Pagination edge cases', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = db.createSession({
        title: 'Edge Case Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
    });

    it('should handle zero limit', () => {
      db.createMessage({
        session_id: sessionId,
        role: 'user',
        content: 'Test',
      });

      const result = db.getMessagesPaginated(sessionId, 0, 0);

      expect(result.messages).toHaveLength(0);
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(1);
    });

    it('should handle large offset with zero messages', () => {
      const result = db.getMessagesPaginated(sessionId, 10, 1000000);

      expect(result.messages).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(0);
    });

    it('should handle large limit', () => {
      for (let i = 0; i < 100; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const result = db.getMessagesPaginated(sessionId, 1000000, 0);

      expect(result.messages).toHaveLength(100);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(100);
    });

    it('should handle messages with null metadata', () => {
      db.createMessage({
        session_id: sessionId,
        role: 'user',
        content: 'No metadata',
        // metadata defaults to null in database
      });

      const result = db.getMessagesPaginated(sessionId, 10, 0);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].metadata).toBeNull();
    });

    it('should handle messages with idempotency key', () => {
      db.createMessage({
        session_id: sessionId,
        role: 'user',
        content: 'Idempotent message',
        idempotency_key: 'unique-key-123',
      });

      const result = db.getMessagesPaginated(sessionId, 10, 0);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].idempotency_key).toBe('unique-key-123');
    });
  });

  describe('Performance with large datasets', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = db.createSession({
        title: 'Performance Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
    });

    it('should handle 1000 messages efficiently', () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const insertTime = Date.now() - start;
      expect(insertTime).toBeLessThan(5000); // Should complete in under 5 seconds

      const queryStart = Date.now();
      const result = db.getMessagesPaginated(sessionId, 100, 500);
      const queryTime = Date.now() - queryStart;

      expect(queryTime).toBeLessThan(100); // Should complete in under 100ms
      expect(result.messages).toHaveLength(100);
      expect(result.total).toBe(1000);
    });

    it('should return consistent total across different pages', () => {
      const count = 50;
      for (let i = 0; i < count; i++) {
        db.createMessage({
          session_id: sessionId,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const page1 = db.getMessagesPaginated(sessionId, 10, 0);
      const page2 = db.getMessagesPaginated(sessionId, 10, 10);
      const page3 = db.getMessagesPaginated(sessionId, 10, 40);

      expect(page1.total).toBe(count);
      expect(page2.total).toBe(count);
      expect(page3.total).toBe(count);
    });
  });
});