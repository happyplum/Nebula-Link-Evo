import { describe, expect, it, vi } from 'vitest';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { NebulaGlmLlmAdapter, createGlmJwt } from './glm-adapter.js';

describe('NebulaGlmLlmAdapter', () => {
  it('creates a deterministic JWT without exposing the source credential', () => {
    const jwt = createGlmJwt('client.secret-value', 100);
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'HS256',
      sign_type: 'SIGN',
    });
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual({
      api_key: 'client',
      exp: 3700,
      timestamp: 100,
    });
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(jwt).not.toContain('secret-value');
  });

  it('translates the GLM SSE stream and sends a per-request JWT', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
      expect(headers.get('authorization')).not.toContain('client.secret-value');
      expect(headers.get('user-agent')).toContain('nebula-link-evo/0.1.0');
      return new Response(
        [
          'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
          'data: [DONE]\n\n',
        ].join(''),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      );
    });
    const adapter = new NebulaGlmLlmAdapter({
      provider: 'glm',
      apiKeyEnv: 'GLM_TEST_KEY',
      baseUrl: 'https://glm.test/v4',
      timeoutMs: 5_000,
      retryPolicy: { mode: 'normal', maxRetries: 3 },
      models: [{ id: 'glm-test', contextWindow: 8_192, maxTokens: 256, acceptsImages: false }],
      env: { GLM_TEST_KEY: 'client.secret-value' },
      fetch: fetchMock as typeof fetch,
    });

    const chunks = [];
    for await (const chunk of adapter.stream({
      provider: 'glm',
      model: 'glm-test',
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }),
      ],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: '你' });
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: '好' });
    expect(chunks).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 3, outputTokens: 2 },
    });
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('fails closed when the configured credential is missing', async () => {
    const adapter = new NebulaGlmLlmAdapter({
      provider: 'glm',
      apiKeyEnv: 'MISSING_GLM_KEY',
      timeoutMs: 5_000,
      retryPolicy: { mode: 'normal', maxRetries: 3 },
      models: [{ id: 'glm-test', contextWindow: 8_192, maxTokens: 256, acceptsImages: false }],
      env: {},
    });
    const consume = async () => {
      for await (const _chunk of adapter.stream({
        provider: 'glm',
        model: 'glm-test',
        messages: [],
      })) {
        // Consume the lazy adapter stream.
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' });
  });
});
