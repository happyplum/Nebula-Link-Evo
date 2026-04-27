import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../services/logger.js', () => ({
  createWorkerLogger: vi.fn(() => mockLogger),
}));

import { DatabaseManager } from '../../conversation/db.js';
import { ConversationManager } from '../../conversation/manager.js';
import { SessionCompressor } from '../../conversation/compressor.js';

describe('SessionCompressor', () => {
  let db: DatabaseManager;
  let manager: ConversationManager;
  let compressor: SessionCompressor;
  let mockAiClient: { generateSummary: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    db = DatabaseManager.getInstance();
    manager = new ConversationManager(':memory:');
    compressor = new SessionCompressor(db);

    mockAiClient = {
      generateSummary: vi.fn(),
    };
  });

  describe('shouldCompress', () => {
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

    it('should return false when message count is below threshold', () => {
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      const result = compressor.shouldCompress(session.id);
      expect(result).toBe(false);
    });

    it('should return false when session not found', () => {
      const result = compressor.shouldCompress('non-existent-session');
      expect(result).toBe(false);
    });
  });

  describe('compress', () => {
    it('should compress old messages successfully', async () => {
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

    it('should not compress when message count is insufficient', async () => {
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 3; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await compressor.compress(session.id, mockAiClient as any);

      expect(mockAiClient.generateSummary).not.toHaveBeenCalled();

      const messages = manager.getMessages(session.id);
      expect(messages).toHaveLength(3);
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

    it('should keep recent N messages', async () => {
      mockAiClient.generateSummary.mockResolvedValue('Summary');

      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 25; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await compressor.compress(session.id, mockAiClient as any);

      const messages = manager.getMessages(session.id);
      const nonSummaryMessages = messages.filter((m) => m.metadata?.type !== 'summary');
      expect(nonSummaryMessages).toHaveLength(5);

      for (let i = 20; i < 25; i++) {
        expect(nonSummaryMessages.some((m) => m.content === `Message ${i}`)).toBe(true);
      }
    });

    it('should throw error when session not found', async () => {
      await expect(
        compressor.compress('non-existent-session', mockAiClient as any)
      ).rejects.toThrow('Session non-existent-session not found');
    });
  });

  describe('getCompressedContext', () => {
    it('should return correct structure', async () => {
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

      expect(context).toHaveProperty('summary');
      expect(context).toHaveProperty('messages');
      expect(context.summary).toBe('Session summary');
      expect(context.messages).toHaveLength(5);
      expect(context.messages[0].content).toBe('Recent message 0');
      expect(context.messages[4].content).toBe('Recent message 4');
    });

    it('should return empty context when session not found', () => {
      const context = compressor.getCompressedContext('non-existent-session');

      expect(context.summary).toBeNull();
      expect(context.messages).toHaveLength(0);
    });
  });

  describe('unified memory contract', () => {
    it('should update sessions.summary after compression', async () => {
      const summaryText = 'AI-generated summary of conversation';
      mockAiClient.generateSummary.mockResolvedValue(summaryText);

      const session = manager.createSession({
        title: 'Contract Test',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 25; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await compressor.compress(session.id, mockAiClient as any);

      const updatedSession = db.getSession(session.id);
      expect(updatedSession?.summary).toBe(summaryText);
    });

    it('should not update summary when compression is skipped', async () => {
      const session = manager.createSession({
        title: 'No Compress',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 3; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await compressor.compress(session.id, mockAiClient as any);

      const updatedSession = db.getSession(session.id);
      expect(updatedSession?.summary).toBeNull();
    });

    it('should catch and log updateSession failures without rethrowing', async () => {
      const summaryText = 'Summary text';
      mockAiClient.generateSummary.mockResolvedValue(summaryText);

      const session = manager.createSession({
        title: 'Failure Test',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 25; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      vi.spyOn(db, 'updateSession').mockImplementation(() => {
        throw new Error('DB write failed');
      });

      await expect(
        compressor.compress(session.id, mockAiClient as any)
      ).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          sessionId: session.id,
        }),
        'Failed to update session summary'
      );
    });
  });

  describe('constructor', () => {
    it('should use default configuration values', () => {
      const defaultCompressor = new SessionCompressor(db);

      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      for (let i = 0; i < 21; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      const result = defaultCompressor.shouldCompress(session.id);
      expect(result).toBe(true);
    });

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
