import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompressionClient } from '../clients/compression.js';
import type { DecisionClient } from '../clients/types.js';
import type { Message } from '../conversation/types.js';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

describe('createCompressionClient', () => {
  const messages: Message[] = [
    {
      id: 'msg-1',
      session_id: 'session-1',
      role: 'user',
      content: 'Need a concise recap',
      created_at: new Date().toISOString(),
      metadata: null,
    },
    {
      id: 'msg-2',
      session_id: 'session-1',
      role: 'assistant',
      content: 'I gathered the important details already.',
      created_at: new Date().toISOString(),
      metadata: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null for decision clients without summary-compatible methods', () => {
    const decisionClient: DecisionClient = {
      provider: 'test',
      model: 'test-model',
      capabilities: ['decision'],
      decide: async () => ({ type: 'finish', params: {}, reasoning: 'unused' }),
      getCapabilities: () => ['decision'],
    };

    expect(createCompressionClient(decisionClient)).toBeNull();
  });

  it('should call the provider endpoint and parse a trimmed summary', async () => {
    const requestBody = { model: 'test-model', messages: [{ role: 'system', content: 'summary' }] };
    const decisionClient = {
      provider: 'test-provider',
      model: 'test-model',
      capabilities: ['decision'],
      decide: async () => ({ type: 'finish', params: {}, reasoning: 'unused' }),
      getCapabilities: () => ['decision'],
      getApiEndpoint: () => 'https://example.com/chat/completions',
      getHeaders: () => ({ Authorization: 'Bearer test-key', 'Content-Type': 'application/json' }),
      getRequestBody: vi.fn().mockReturnValue(requestBody),
    } satisfies DecisionClient & {
      getApiEndpoint(): string;
      getHeaders(): Record<string, string>;
      getRequestBody(messages: unknown[], options?: unknown): Record<string, unknown>;
    };

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{ message: { content: '  compressed summary  ' } }],
      },
    });

    const compressionClient = createCompressionClient(decisionClient);

    expect(compressionClient).not.toBeNull();

    const summary = await compressionClient!.generateSummary(messages);

    expect(summary).toBe('compressed summary');
    expect(decisionClient.getRequestBody).toHaveBeenCalledTimes(1);
    expect(decisionClient.getRequestBody.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('USER: Need a concise recap'),
      }),
    ]);
    expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
      'https://example.com/chat/completions',
      requestBody,
      {
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
  });

  it('should fail clearly when the provider returns no summary text', async () => {
    const decisionClient = {
      provider: 'test-provider',
      model: 'test-model',
      capabilities: ['decision'],
      decide: async () => ({ type: 'finish', params: {}, reasoning: 'unused' }),
      getCapabilities: () => ['decision'],
      getApiEndpoint: () => 'https://example.com/chat/completions',
      getHeaders: () => ({ Authorization: 'Bearer test-key' }),
      getRequestBody: vi.fn().mockReturnValue({ model: 'test-model', messages: [] }),
    } satisfies DecisionClient & {
      getApiEndpoint(): string;
      getHeaders(): Record<string, string>;
      getRequestBody(messages: unknown[], options?: unknown): Record<string, unknown>;
    };

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{ message: { content: '   ' } }],
      },
    });

    const compressionClient = createCompressionClient(decisionClient);

    await expect(compressionClient!.generateSummary(messages)).rejects.toThrow(
      "Compression client for provider 'test-provider' returned an empty summary"
    );
  });
});
