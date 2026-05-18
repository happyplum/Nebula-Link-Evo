import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { ResolvedConfig } from '../config/schema.js';
import { ProviderError, PROVIDER_ERRORS } from '../services/provider/errors.js';
import aiServiceRoutes from '../plugins/routes/api/ai-service.js';

const { mockGenerateText, mockConfig, mockRegistry, mockAppService } = vi.hoisted(() => {
  const generateText = vi.fn();
  const config = {
    version: '1.0',
    providers: {
      kimi: {
        apiKey: 'test-key',
        enabled: true,
        models: {},
      },
    },
    mcp: { enabled: false, servers: {} },
    defaults: {
      mode: 'separation',
      vision: { provider: 'kimi', model: 'vision-model' },
      decision: { provider: 'kimi', model: 'kimi-v1' },
    },
    settings: {
      timeout: 30000,
      maxRetries: 3,
      temperature: 0.4,
      maxTokens: 2000,
      maxSteps: 10,
    },
  } as unknown as ResolvedConfig;

  const registry = {
    resolve: vi.fn(),
    isAvailable: vi.fn(() => true),
    getAvailabilityError: vi.fn(() => undefined),
  };

  const appService = {
    getConfig: vi.fn(() => config),
    getRegistry: vi.fn(() => registry),
  };

  return {
    mockGenerateText: generateText,
    mockConfig: config,
    mockRegistry: registry,
    mockAppService: appService,
  };
});

vi.mock('ai', () => ({
  generateText: mockGenerateText,
}));

vi.mock('../services/index.js', () => ({
  AppService: {
    getInstance: vi.fn(() => mockAppService),
  },
}));

describe('POST /api/ai/generate', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(aiServiceRoutes, { prefix: '/api/ai' });
    await app.ready();

    mockConfig.defaults.decision = { provider: 'kimi', model: 'kimi-v1' };
    mockAppService.getConfig.mockReturnValue(mockConfig);
    mockAppService.getRegistry.mockReturnValue(mockRegistry);
    mockRegistry.resolve.mockResolvedValue({ provider: 'kimi', modelId: 'kimi-v1' });
    mockRegistry.getAvailabilityError.mockReturnValue(undefined);
    mockGenerateText.mockResolvedValue({
      text: 'Generated text',
      usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
    });
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('returns generated text using defaults.decision provider', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/generate',
      payload: {
        prompt: 'Say hello',
        temperature: 0.7,
        maxTokens: 256,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRegistry.resolve).toHaveBeenCalledWith('kimi', 'kimi-v1');
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      model: { provider: 'kimi', modelId: 'kimi-v1' },
      prompt: 'Say hello',
      temperature: 0.7,
      maxOutputTokens: 256,
    }));
    expect(response.json()).toEqual({
      success: true,
      text: 'Generated text',
      tokenUsage: {
        promptTokens: 12,
        completionTokens: 34,
      },
      model: 'kimi/kimi-v1',
    });
  });

  it('returns 503 when decision provider is not configured', async () => {
    mockAppService.getConfig.mockReturnValue({
      ...mockConfig,
      defaults: {
        ...mockConfig.defaults,
        decision: undefined,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/generate',
      payload: { prompt: 'Say hello' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('Decision provider');
  });

  it('returns 503 when provider resolution fails', async () => {
    mockRegistry.resolve.mockRejectedValue(
      new ProviderError(PROVIDER_ERRORS.INIT_FAILED, 'kimi', 'Factory not available')
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/generate',
      payload: { prompt: 'Say hello' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('kimi');
    expect(response.json().error).toContain('Factory not available');
  });
});
