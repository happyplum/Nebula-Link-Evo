import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ProviderRegistry } from '../registry.js';
import { createMockLanguageModel } from './helpers/mock-factory.js';

vi.mock('../registry.js', () => ({
  ProviderRegistry: vi.fn(),
}));

import { resolveModel, resolveSessionModels } from '../resolver.js';

/** Cast mock model to LanguageModelV3 (mock factory omits supportedUrls). */
function mockModel(opts: { modelId?: string } = {}): LanguageModelV3 {
  return createMockLanguageModel(opts) as unknown as LanguageModelV3;
}

function mockRegistry(): ProviderRegistry {
  return { resolve: vi.fn() } as unknown as ProviderRegistry;
}

describe('resolveModel', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = mockRegistry();
  });

  it('should resolve glm/glm-4.7-flash correctly', async () => {
    const model = mockModel({ modelId: 'glm-4.7-flash' });
    vi.mocked(registry.resolve).mockResolvedValue(model);

    const result = await resolveModel('glm/glm-4.7-flash', registry);

    expect(registry.resolve).toHaveBeenCalledWith('glm', 'glm-4.7-flash');
    expect(result).toBe(model);
    expect(result.modelId).toBe('glm-4.7-flash');
  });

  it('should handle provider without npmPackage (registry defaults to openai-compatible)', async () => {
    const model = mockModel({ modelId: 'custom-model' });
    vi.mocked(registry.resolve).mockResolvedValue(model);

    const result = await resolveModel('custom/custom-model', registry);

    expect(registry.resolve).toHaveBeenCalledWith('custom', 'custom-model');
    expect(result.modelId).toBe('custom-model');
  });
});

describe('resolveSessionModels', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = mockRegistry();
  });

  it('should resolve decision from session fields', async () => {
    const decisionModel = mockModel({ modelId: 'gpt-4o' });
    vi.mocked(registry.resolve).mockResolvedValueOnce(decisionModel);

    const result = await resolveSessionModels(
      { provider: 'openai', model: 'gpt-4o' },
      registry,
      { decision: 'openai/gpt-3.5' },
    );

    expect(result.decision).toBe(decisionModel);
    expect(registry.resolve).toHaveBeenCalledWith('openai', 'gpt-4o');
  });

  it('should fall back decision to config defaults when session fields are null', async () => {
    const defaultDecision = mockModel({ modelId: 'glm-4.7-flash' });
    vi.mocked(registry.resolve).mockResolvedValueOnce(defaultDecision);

    const result = await resolveSessionModels(
      { provider: null, model: null },
      registry,
      { decision: 'glm/glm-4.7-flash' },
    );

    expect(registry.resolve).toHaveBeenCalledWith('glm', 'glm-4.7-flash');
    expect(result.decision).toBe(defaultDecision);
  });

  it('should prefer session decision over config defaults', async () => {
    const decisionModel = mockModel({ modelId: 'gpt-4o' });
    vi.mocked(registry.resolve).mockResolvedValueOnce(decisionModel);

    const result = await resolveSessionModels(
      { provider: 'openai', model: 'gpt-4o' },
      registry,
      { decision: 'openai/gpt-3.5' },
    );

    expect(registry.resolve).toHaveBeenCalledWith('openai', 'gpt-4o');
    expect(result.decision).toBe(decisionModel);
  });
});
