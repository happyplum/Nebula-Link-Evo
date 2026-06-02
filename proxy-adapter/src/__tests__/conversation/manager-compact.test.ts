import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationManager } from '../../conversation/manager.js';

describe('ConversationManager - compactForTokenBudget', () => {
  let manager: ConversationManager;
  let mockCompressor: { compress: ReturnType<typeof vi.fn> };
  let mockAiClient: { generateSummary: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    manager = new ConversationManager(':memory:');
    mockCompressor = {
      compress: vi.fn().mockResolvedValue(undefined),
    };
    mockAiClient = {
      generateSummary: vi.fn().mockResolvedValue('Summary'),
    };

    // Replace the compressor with a mock
    Object.defineProperty(manager, 'compressor', {
      value: mockCompressor,
      writable: true,
    });
  });

  describe('compactForTokenBudget', () => {
    it('should return false when no AI client is configured', async () => {
      const sessionId = 'test-session-1';
      manager.createSession({
        id: sessionId,
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      const result = await manager.compactForTokenBudget(sessionId);

      expect(result).toBe(false);
      expect(mockCompressor.compress).not.toHaveBeenCalled();
    });

    it('should return true and call compressor.compress when AI client is available', async () => {
      const sessionId = 'test-session-2';
      manager.createSession({
        id: sessionId,
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      // Set AI client
      manager.setAiClient(mockAiClient);

      const result = await manager.compactForTokenBudget(sessionId);

      expect(result).toBe(true);
      expect(mockCompressor.compress).toHaveBeenCalledTimes(1);
      expect(mockCompressor.compress).toHaveBeenCalledWith(sessionId, mockAiClient);
    });

    it('should return false and log error when compressor.compress throws', async () => {
      const sessionId = 'test-session-3';
      manager.createSession({
        id: sessionId,
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      // Set AI client
      manager.setAiClient(mockAiClient);

      // Mock compressor to throw an error
      mockCompressor.compress.mockRejectedValue(new Error('Compression failed'));

      const result = await manager.compactForTokenBudget(sessionId);

      expect(result).toBe(false);
      expect(mockCompressor.compress).toHaveBeenCalledTimes(1);
      expect(mockCompressor.compress).toHaveBeenCalledWith(sessionId, mockAiClient);
    });

    it('should delegate to compressor with correct sessionId and aiClient args', async () => {
      const sessionId = 'test-session-4';
      manager.createSession({
        id: sessionId,
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      // Set AI client
      manager.setAiClient(mockAiClient);

      await manager.compactForTokenBudget(sessionId);

      // Verify compressor was called with exact arguments
      expect(mockCompressor.compress).toHaveBeenCalledWith(sessionId, mockAiClient);
      expect(mockCompressor.compress).toHaveBeenCalledTimes(1);
    });
  });
});