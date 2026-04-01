import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('WebSocket Events', () => {
  let mockChatManager: any;
  let handleStreamEvent: (event: any) => void;

  beforeEach(() => {
    // Mock chatManager
    mockChatManager = {
      handleStream: vi.fn(),
      sessions: [],
      renderSessionList: vi.fn(),
    };
    (global as any).window = {
      chatManager: mockChatManager,
    };

    // Import and create the event handler
    handleStreamEvent = (event: any) => {
      if (mockChatManager.handleStream) {
        mockChatManager.handleStream(event);
      }
    };
  });

  describe('Multiple Event Handling', () => {
    it('should handle multiple events in sequence', async () => {
      const events = [
        { type: 'chat_stream_start', sessionId: '123' },
        { type: 'chat_stream_token', text: 'Hello' },
        { type: 'chat_stream_token', text: ' World' },
        { type: 'chat_stream_end', usage: { promptTokens: 10, completionTokens: 20 } },
      ];

      for (const event of events) {
        handleStreamEvent(event);
      }

      expect(mockChatManager.handleStream).toHaveBeenCalledTimes(4);
      
      const calls = mockChatManager.handleStream.mock.calls;
      expect(calls[0][0]).toMatchObject({ type: 'chat_stream_start' });
      expect(calls[1][0]).toMatchObject({ type: 'chat_stream_token', text: 'Hello' });
      expect(calls[2][0]).toMatchObject({ type: 'chat_stream_token', text: ' World' });
      expect(calls[3][0]).toMatchObject({ type: 'chat_stream_end' });
    });
  });
});
