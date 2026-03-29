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

  it('should resolve both decision and vision from session fields', async () => {
    const decisionModel = mockModel({ modelId: 'gpt-4o' });
    const visionModel = mockModel({ modelId: 'glm-4v' });
    vi.mocked(registry.resolve)
      .mockResolvedValueOnce(decisionModel)
      .mockResolvedValueOnce(visionModel);

    const result = await resolveSessionModels(
      { provider: 'openai', model: 'gpt-4o', vision_provider: 'glm', vision_model: 'glm-4v' },
      registry,
      { decision: 'openai/gpt-3.5', vision: 'glm/glm-4v-flash' },
    );

    expect(result.decision).toBe(decisionModel);
    expect(result.vision).toBe(visionModel);
    expect(registry.resolve).toHaveBeenCalledWith('openai', 'gpt-4o');
    expect(registry.resolve).toHaveBeenCalledWith('glm', 'glm-4v');
  });

  it('should fall back vision to config defaults when vision columns are null', async () => {
    const decisionModel = mockModel({ modelId: 'gpt-4o' });
    const defaultVision = mockModel({ modelId: 'glm-4v-flash' });
    vi.mocked(registry.resolve)
      .mockResolvedValueOnce(decisionModel)
      .mockResolvedValueOnce(defaultVision);

    const result = await resolveSessionModels(
      { provider: 'openai', model: 'gpt-4o', vision_provider: null, vision_model: null },
      registry,
      { decision: 'openai/gpt-3.5', vision: 'glm/glm-4v-flash' },
    );

    expect(registry.resolve).toHaveBeenCalledWith('openai', 'gpt-4o');
    expect(registry.resolve).toHaveBeenCalledWith('glm', 'glm-4v-flash');
    expect(result.decision).toBe(decisionModel);
    expect(result.vision).toBe(defaultVision);
  });

  it('should fall back both to defaults when all session fields are null', async () => {
    const model = mockModel({ modelId: 'default' });
    vi.mocked(registry.resolve).mockResolvedValue(model);

    await resolveSessionModels(
      { provider: null, model: null, vision_provider: null, vision_model: null },
      registry,
      { decision: 'glm/glm-4.7-flash', vision: 'glm/glm-4v-flash' },
    );

    expect(registry.resolve).toHaveBeenCalledWith('glm', 'glm-4.7-flash');
    expect(registry.resolve).toHaveBeenCalledWith('glm', 'glm-4v-flash');
  });
});
