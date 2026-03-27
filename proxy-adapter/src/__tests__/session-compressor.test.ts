import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseManager } from '../conversation/db.js';
import { ConversationManager } from '../conversation/manager.js';
import { SessionCompressor } from '../conversation/compressor.js';

describe('SessionCompressor', () => {
  let db: DatabaseManager;
  let manager: ConversationManager;
  let compressor: SessionCompressor;
  let mockAiClient: { generateSummary: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    db = DatabaseManager.getInstance();
    manager = new ConversationManager(':memory:');
    compressor = new SessionCompressor(db);

    mockAiClient = {
      generateSummary: vi.fn(),
    };
  });

  describe('shouldCompress', () => {
    it('should return false when message count is below threshold', () => {
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      const result = compressor.shouldCompress(session.id);
      expect(result).toBe(false);
    });

    it('should return false when message count equals threshold (20)', () => {
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 20; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      const result = compressor.shouldCompress(session.id);
      expect(result).toBe(false);
    });

    it('should return true when message count exceeds threshold', () => {
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 21; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      const result = compressor.shouldCompress(session.id);
      expect(result).toBe(true);
    });

    it('should return false when session not found', () => {
      const result = compressor.shouldCompress('non-existent-session');
      expect(result).toBe(false);
    });
  });

  describe('compress', () => {
    it('should compress messages and keep recent ones', async () => {
      mockAiClient.generateSummary.mockResolvedValue('Summary of conversation');

      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 25; i++) {
        manager.addMessage(session.id, { role: 'user', content: `User message ${i}` });
        manager.addMessage(session.id, { role: 'assistant', content: `Assistant response ${i}` });
      }

      await compressor.compress(session.id, mockAiClient as any);

      expect(mockAiClient.generateSummary).toHaveBeenCalled();

      const messages = manager.getMessages(session.id);
      const summaryMessage = messages.find((m) => m.metadata?.type === 'summary');
      expect(summaryMessage).toBeDefined();
      expect(summaryMessage?.role).toBe('system');
      expect(summaryMessage?.content).toBe('Summary of conversation');

      const nonSummaryMessages = messages.filter((m) => m.metadata?.type !== 'summary');
      expect(nonSummaryMessages).toHaveLength(5);
    });

    it('should keep messages marked as important', async () => {
      mockAiClient.generateSummary.mockResolvedValue('Summary');

      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      manager.addMessage(session.id, {
        role: 'user',
        content: 'Important message',
        metadata: { important: true },
      });

      for (let i = 0; i < 24; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await compressor.compress(session.id, mockAiClient as any);

      const messages = manager.getMessages(session.id);
      const importantMessage = messages.find((m) => m.content === 'Important message');
      expect(importantMessage).toBeDefined();
    });

    it('should not modify existing summary messages', async () => {
      mockAiClient.generateSummary.mockResolvedValue('New summary');

      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      manager.addMessage(session.id, {
        role: 'system',
        content: 'Existing summary',
        metadata: { type: 'summary' },
      });

      for (let i = 0; i < 24; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await compressor.compress(session.id, mockAiClient as any);

      const messages = manager.getMessages(session.id);
      const existingSummary = messages.find((m) => m.content === 'Existing summary');
      expect(existingSummary).toBeDefined();
    });

    it('should throw error when session not found', async () => {
      await expect(
        compressor.compress('non-existent-session', mockAiClient as any)
      ).rejects.toThrow('Session non-existent-session not found');
    });

    it('should throw error when AI client fails', async () => {
      mockAiClient.generateSummary.mockRejectedValue(new Error('AI error'));

      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 25; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await expect(compressor.compress(session.id, mockAiClient as any)).rejects.toThrow(
        'AI error'
      );
    });

    it('should preserve compressed memory for later turns through manager context', async () => {
      mockAiClient.generateSummary.mockResolvedValue('Compressed memory summary');

      const session = manager.createSession({
        title: 'Later Turn Context Test',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 25; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await compressor.compress(session.id, mockAiClient as any);
      manager.addMessage(session.id, { role: 'user', content: 'Latest follow-up question' });

      const context = manager.getContextWindow(session.id);
      const compressedContext = compressor.getCompressedContext(session.id);

      expect(context.summary).toBe(compressedContext.summary);
      expect(context.messages.map((message) => message.id)).toEqual(
        compressedContext.messages.map((message) => message.id)
      );
    });
  });

  describe('getCompressedContext', () => {
    it('should return summary and recent messages', async () => {
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      manager.addMessage(session.id, {
        role: 'system',
        content: 'Session summary',
        metadata: { type: 'summary' },
      });

      for (let i = 0; i < 5; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Recent message ${i}` });
      }

      const context = compressor.getCompressedContext(session.id);

      expect(context.summary).toBe('Session summary');
      expect(context.messages).toHaveLength(5);
      expect(context.messages[0].content).toBe('Recent message 0');
      expect(context.messages[4].content).toBe('Recent message 4');
    });

    it('should return null summary when no summary exists', () => {
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      manager.addMessage(session.id, { role: 'user', content: 'Message' });

      const context = compressor.getCompressedContext(session.id);

      expect(context.summary).toBeNull();
      expect(context.messages).toHaveLength(1);
    });

    it('should return empty context when session not found', () => {
      const context = compressor.getCompressedContext('non-existent-session');

      expect(context.summary).toBeNull();
      expect(context.messages).toHaveLength(0);
    });
  });

  describe('configuration', () => {
    it('should use custom compress threshold', () => {
      const customCompressor = new SessionCompressor(db, { compressThreshold: 10 });
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 11; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      const result = customCompressor.shouldCompress(session.id);
      expect(result).toBe(true);
    });

    it('should use custom keep recent count', async () => {
      mockAiClient.generateSummary.mockResolvedValue('Summary');

      const customCompressor = new SessionCompressor(db, { keepRecentCount: 3 });
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 25; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await customCompressor.compress(session.id, mockAiClient as any);

      const messages = manager.getMessages(session.id);
      const nonSummaryMessages = messages.filter((m) => m.metadata?.type !== 'summary');
      expect(nonSummaryMessages).toHaveLength(3);
    });
  });
});
