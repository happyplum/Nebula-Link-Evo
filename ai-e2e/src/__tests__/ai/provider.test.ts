import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvider } from '../../ai/provider.js';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({
    languageModel: (modelId: string) => ({ modelId, provider: 'test' }),
  })),
}));

import { generateText, streamText } from 'ai';

const mockedGenerateText = vi.mocked(generateText);
const mockedStreamText = vi.mocked(streamText);

describe('AIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should create an openai-compatible provider for generic providers', async () => {
      const provider = new AIProvider({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
      });

      await provider.initialize();
      const model = provider.getModel();
      expect(model).toBeDefined();
    });

    it('should handle GLM provider with JWT token generation', async () => {
      const provider = new AIProvider({
        provider: 'glm',
        model: 'glm-4-plus',
        apiKey: 'test_id.test_secret',
      });

      await provider.initialize();
      const model = provider.getModel();
      expect(model).toBeDefined();
    });

    it('should throw on invalid GLM API key format', async () => {
      const provider = new AIProvider({
        provider: 'glm',
        model: 'glm-4-plus',
        apiKey: 'invalid-key',
      });

      await expect(provider.initialize()).rejects.toThrow(
        'Invalid GLM API key format',
      );
    });
  });

  describe('getModel', () => {
    it('should throw if not initialized', () => {
      const provider = new AIProvider({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      });

      expect(() => provider.getModel()).toThrow('AIProvider not initialized');
    });
  });

  describe('generateText', () => {
    it('should call generateText and return text with token usage', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'Hello, world!',
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never);

      const provider = new AIProvider({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      });

      await provider.initialize();
      const result = await provider.generateText('Say hello');

      expect(result.text).toBe('Hello, world!');
      expect(result.tokenUsage.promptTokens).toBe(10);
      expect(result.tokenUsage.completionTokens).toBe(5);
      expect(mockedGenerateText).toHaveBeenCalledOnce();
    });

    it('should pass temperature and maxTokens options', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as never);

      const provider = new AIProvider({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      });

      await provider.initialize();
      await provider.generateText('test', { temperature: 0.5, maxTokens: 100 });

      const callArgs = mockedGenerateText.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.temperature).toBe(0.5);
      expect(callArgs.maxOutputTokens).toBe(100);
    });

    it('should handle undefined token usage gracefully', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'response',
        usage: { inputTokens: undefined, outputTokens: undefined },
      } as never);

      const provider = new AIProvider({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      });

      await provider.initialize();
      const result = await provider.generateText('test');

      expect(result.tokenUsage.promptTokens).toBe(0);
      expect(result.tokenUsage.completionTokens).toBe(0);
    });
  });

  describe('streamText', () => {
    it('should accumulate streamed chunks and return full text with usage', async () => {
      const chunks = ['Hello', ', ', 'stream', '!'];
      const textStream = (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();

      const usagePromise = Promise.resolve({
        inputTokens: 15,
        outputTokens: 8,
      });

      mockedStreamText.mockReturnValue({
        textStream,
        usage: usagePromise,
      } as never);

      const provider = new AIProvider({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      });

      const receivedChunks: string[] = [];
      await provider.initialize();
      const result = await provider.streamText('test', {
        onChunk: (text) => receivedChunks.push(text),
      });

      expect(result.text).toBe('Hello, stream!');
      expect(result.tokenUsage.promptTokens).toBe(15);
      expect(result.tokenUsage.completionTokens).toBe(8);
      expect(receivedChunks).toEqual(chunks);
    });
  });
});
