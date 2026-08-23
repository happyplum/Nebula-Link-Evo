import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { HarnessRuntime } from '../../../harness/index.js';
import aiServiceRoutes from './ai-service.js';

describe('AI service Harness route', () => {
  it('uses the sessionless Harness stream without tools', async () => {
    const stream = vi.fn((_options: Parameters<HarnessRuntime['stream']>[0]) =>
      (async function* () {
        yield { type: 'block-start' as const, index: 0, blockType: 'text' as const };
        yield { type: 'text-delta' as const, index: 0, text: 'ok' };
        yield { type: 'usage' as const, usage: { inputTokens: 2, outputTokens: 1 } };
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } };
      })()
    );
    const harness = { stream } as Pick<HarnessRuntime, 'stream'> as HarnessRuntime;
    const app = Fastify();
    await app.register(aiServiceRoutes, {
      harness,
      decision: { provider: 'test', model: 'model', temperature: 0.2, maxTokens: 100 },
      timeoutMs: 1_000,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/generate',
      payload: { prompt: 'hello', temperature: 0.5, maxTokens: 10 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      text: 'ok',
      tokenUsage: { promptTokens: 2, completionTokens: 1 },
      model: 'test/model',
    });
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'test',
        model: 'model',
        temperature: 0.5,
        maxTokens: 10,
      })
    );
    expect(stream.mock.calls[0]?.[0].tools).toBeUndefined();
    expect(stream.mock.calls[0]?.[0].sessionId).toBeUndefined();
    await app.close();
  });
});
