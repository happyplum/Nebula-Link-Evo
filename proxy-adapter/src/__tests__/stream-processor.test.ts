import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { StreamProcessor } from '../clients/decision/stream.js';

interface MockCallbacks {
  onToken: (text: string) => void;
  onThinking: (text: string) => void;
  onToolCall: (call: any) => void;
  onUsage: (usage: any) => void;
  onDone: () => void;
}

describe('StreamProcessor', () => {
  let processor: StreamProcessor;
  let callbacks: MockCallbacks;

  beforeEach(() => {
    callbacks = {
      onToken: vi.fn(),
      onThinking: vi.fn(),
      onToolCall: vi.fn(),
      onUsage: vi.fn(),
      onDone: vi.fn(),
    };
    processor = new StreamProcessor();
  });

  describe('SSE chunk parsing', () => {
    it('should parse single SSE chunk with content', async () => {
      const mockResponse = {
        data: Buffer.from('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledWith('Hello');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('should parse multiple SSE chunks with content', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":" World"}}]}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledTimes(2);
      expect(callbacks.onToken).toHaveBeenNthCalledWith(1, 'Hello');
      expect(callbacks.onToken).toHaveBeenNthCalledWith(2, ' World');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('should parse chunk with finish_reason', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledWith('Done');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('should handle usage information', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"content":"Text"}}]}\n\n' +
            'data: {"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledWith('Text');
      expect(callbacks.onUsage).toHaveBeenCalledWith({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      });
    });
  });

  describe('thinking content extraction', () => {
    it('should extract GLM reasoning_content', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"reasoning_content":"Thinking step 1"}}]}\n\n' +
            'data: {"choices":[{"delta":{"reasoning_content":"Thinking step 2"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"Final answer"}}]}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onThinking).toHaveBeenCalledTimes(2);
      expect(callbacks.onThinking).toHaveBeenNthCalledWith(1, 'Thinking step 1');
      expect(callbacks.onThinking).toHaveBeenNthCalledWith(2, 'Thinking step 2');
      expect(callbacks.onToken).toHaveBeenCalledWith('Final answer');
    });

    it('should handle mixed content and reasoning', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"reasoning_content":"Analyzing..."}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n' +
            'data: {"choices":[{"delta":{"reasoning_content":"More thinking"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"Complete answer"}}]}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onThinking).toHaveBeenNthCalledWith(1, 'Analyzing...');
      expect(callbacks.onThinking).toHaveBeenNthCalledWith(2, 'More thinking');
      expect(callbacks.onToken).toHaveBeenNthCalledWith(1, 'Partial answer');
      expect(callbacks.onToken).toHaveBeenNthCalledWith(2, 'Complete answer');
    });
  });

  describe('tool call parsing', () => {
    it('should parse tool_calls delta', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"content":"I will use a tool","tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"search"}}]}}]}\n\n' +
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"test\\"}"}}]}}]}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledWith('I will use a tool');
      expect(callbacks.onToolCall).toHaveBeenCalledWith({
        index: 0,
        id: 'call_123',
        type: 'function',
        function: {
          name: 'search',
        },
      });
      expect(callbacks.onToolCall).toHaveBeenCalledWith({
        index: 0,
        function: {
          arguments: '{"query":"test"}',
        },
      });
    });

    it('should handle partial tool call arguments', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"click"}}]}}]}\n\n' +
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"x\\": 100}"}}]}}]}\n\n' +
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":",\\"y\\": 200}"}}]}}]}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToolCall).toHaveBeenCalledTimes(3);
    });
  });

  describe('error handling', () => {
    it('should throw explicit error on non-200 response and should not call onDone', async () => {
      const mockResponse = {
        status: 401,
        data: Buffer.from('{"error":"unauthorized"}'),
      };
      await expect(processor.processSSEStream(mockResponse as any, callbacks as any)).rejects.toThrow(
        'Stream API returned status 401: {"error":"unauthorized"}'
      );
      expect(callbacks.onDone).not.toHaveBeenCalled();
    });

    it('should surface stream consumption errors and should not call onDone', async () => {
      const stream = new PassThrough();
      const mockResponse = {
        status: 200,
        data: stream,
      };

      const processingPromise = processor.processSSEStream(mockResponse as any, callbacks as any);
      const streamError = new Error('stream failed');
      stream.emit('error', streamError);

      await expect(processingPromise).rejects.toThrow('stream failed');
      expect(callbacks.onDone).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON in SSE chunk', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"content":"Valid"}}]}\n\n' +
            'data: invalid json\n\n' +
            'data: {"choices":[{"delta":{"content":"Valid again"}}]}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledWith('Valid');
      expect(callbacks.onToken).toHaveBeenCalledWith('Valid again');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('should handle empty data lines', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"content":"Test"}}]}\n\n' + '\n\n' + 'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledWith('Test');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('should handle malformed SSE format', async () => {
      const mockResponse = {
        data: Buffer.from(
          'invalid sse format\n' +
            'data: {"choices":[{"delta":{"content":"Still works"}}]}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledWith('Still works');
    });
  });

  describe('edge cases', () => {
    it('should call onDone exactly once on successful completion', async () => {
      const mockResponse = {
        status: 200,
        data: Buffer.from(
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledWith('Hello');
      expect(callbacks.onDone).toHaveBeenCalledTimes(1);
    });

    it('should process Node stream input and call onDone only after stream ends', async () => {
      const stream = new PassThrough();
      const mockResponse = {
        status: 200,
        data: stream,
      };
      let settled = false;
      const processingPromise = processor
        .processSSEStream(mockResponse as any, callbacks as any)
        .then(() => {
          settled = true;
        });
      stream.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      await Promise.resolve();
      expect(callbacks.onDone).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      stream.end('data: [DONE]\n\n');
      await processingPromise;
      expect(callbacks.onToken).toHaveBeenCalledWith('Hello');
      expect(callbacks.onDone).toHaveBeenCalledTimes(1);
      expect(settled).toBe(true);
    });

    it('should handle empty response', async () => {
      const mockResponse = {
        data: Buffer.from(''),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).not.toHaveBeenCalled();
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('should handle only [DONE] signal', async () => {
      const mockResponse = {
        data: Buffer.from('data: [DONE]\n\n'),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).not.toHaveBeenCalled();
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('should handle content with special characters', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"content":"Line1\\nLine2\\tTabbed"}}]}\n\n' +
            'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledWith('Line1\nLine2\tTabbed');
    });

    it('should handle chinese characters', async () => {
      const mockResponse = {
        data: Buffer.from(
          'data: {"choices":[{"delta":{"content":"你好世界"}}]}\n\n' + 'data: [DONE]\n\n'
        ),
      };

      await processor.processSSEStream(mockResponse as any, callbacks as any);

      expect(callbacks.onToken).toHaveBeenCalledWith('你好世界');
    });
  });
});
