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
    it('should compress messages — keeps summary + last user message', async () => {
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

      // Non-summary messages: only the last user message survives
      const nonSummaryMessages = messages.filter((m) => m.metadata?.type !== 'summary');
      expect(nonSummaryMessages).toHaveLength(1);
      expect(nonSummaryMessages[0].content).toBe('User message 24');
    });

    it('should pass full context to AI (including tool results stripped)', async () => {
      mockAiClient.generateSummary.mockResolvedValue('Summary');

      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      manager.addMessage(session.id, { role: 'user', content: 'Do something' });
      manager.addMessage(session.id, { role: 'tool', content: '<huge-dom-snapshot>...10000 chars...</huge-dom-snapshot>', metadata: { tool_name: 'browser_snapshot' } });
      manager.addMessage(session.id, { role: 'assistant', content: 'I see the page' });
      manager.addMessage(session.id, { role: 'user', content: 'Click button' });

      await compressor.compress(session.id, mockAiClient as any);

      // AI should receive stripped messages
      const passedMessages = mockAiClient.generateSummary.mock.calls[0][0];
      const toolMsg = passedMessages.find((m: any) => m.role === 'tool');
      // Tool result should be stripped to a lightweight placeholder
      expect(toolMsg.content).toContain('[工具调用结果 browser_snapshot]');
      expect(toolMsg.content.length).toBeLessThan(300);
    });

    it('should include important message content in the summary generation', async () => {
      mockAiClient.generateSummary.mockResolvedValue('Summary including important info');

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

      // The important message was passed to the AI for summarization
      const passedMessages = mockAiClient.generateSummary.mock.calls[0][0];
      const importantInSummary = passedMessages.some((m: any) => m.content === 'Important message');
      expect(importantInSummary).toBe(true);

      // But the important message is deleted (it's in the AI summary now)
      const messages = manager.getMessages(session.id);
      const importantStillExists = messages.some((m) => m.content === 'Important message');
      expect(importantStillExists).toBe(false);

      // Summary exists
      const summaryMessage = messages.find((m) => m.metadata?.type === 'summary');
      expect(summaryMessage).toBeDefined();
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

    it('should skip compression when only 1 message exists', async () => {
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      manager.addMessage(session.id, { role: 'user', content: 'Only message' });

      await compressor.compress(session.id, mockAiClient as any);

      expect(mockAiClient.generateSummary).not.toHaveBeenCalled();

      const messages = manager.getMessages(session.id);
      expect(messages).toHaveLength(1);
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
  });
});
