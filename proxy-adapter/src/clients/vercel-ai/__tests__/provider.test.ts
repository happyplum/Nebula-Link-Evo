import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ProviderRegistry } from '../../../services/provider/registry.js';
import { ProviderError, PROVIDER_ERRORS } from '../../../services/provider/errors.js';

// Mock resolveSessionModels to isolate provider.ts unit tests
vi.mock('../../../services/provider/resolver.js', () => ({
  resolveSessionModels: vi.fn(),
}));

import { resolveSessionModels } from '../../../services/provider/resolver.js';

const mockResolveSessionModels = vi.mocked(resolveSessionModels);

// Set test environment so test-provider works
process.env.NODE_ENV = 'test';

function createMockModel(id: string): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: id,
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as LanguageModelV3;
}

function createMockRegistry(resolveFn?: (provider: string, model: string) => Promise<LanguageModelV3>) {
  return {
    resolve: resolveFn ?? vi.fn().mockResolvedValue(createMockModel('mock-model')),
    isAvailable: vi.fn(),
    listProviders: vi.fn().mockReturnValue([]),
    getProviderConfig: vi.fn(),
  } as unknown as ProviderRegistry;
}

describe('provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getModel', () => {
    it('returns mock model for test-provider', async () => {
      const { getModel } = await import('../provider.js');
      const registry = createMockRegistry();
      const model = await getModel(registry, 'test-provider', 'any-model');
      expect(model).toBeDefined();
    });

    it('throws outside test environment for test-provider', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        // Re-import to get fresh module with new env
        vi.resetModules();
        const { getModel } = await import('../provider.js');
        const registry = createMockRegistry();
        await expect(getModel(registry, 'test-provider', 'model')).rejects.toThrow(
          'test-provider is only available in test environment',
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
        vi.resetModules();
      }
    });

    it('delegates to registry.resolve for real providers', async () => {
      const mockModel = createMockModel('resolved-model');
      const resolve = vi.fn().mockResolvedValue(mockModel);
      const registry = createMockRegistry(resolve);

      const { getModel } = await import('../provider.js');
      const result = await getModel(registry, 'openai', 'gpt-4o');

      expect(resolve).toHaveBeenCalledWith('openai', 'gpt-4o');
      expect(result).toBe(mockModel);
    });

    it('propagates ProviderError from registry', async () => {
      const resolve = vi.fn().mockRejectedValue(
        new ProviderError(PROVIDER_ERRORS.NOT_FOUND, 'unknown', 'not found'),
      );
      const registry = createMockRegistry(resolve);

      const { getModel } = await import('../provider.js');
      await expect(getModel(registry, 'missing', 'model')).rejects.toThrow(ProviderError);
    });
  });

  describe('getDecisionModel', () => {
    it('resolves decision model via resolveSessionModels', async () => {
      const decisionModel = createMockModel('decision-model');
      mockResolveSessionModels.mockResolvedValue({ decision: decisionModel });

      const { getDecisionModel } = await import('../provider.js');
      const registry = createMockRegistry();
      const session = { provider: 'glm', model: 'glm-4' };
      const defaults = { decision: 'glm/glm-4.7-flash' };

      const result = await getDecisionModel(session, registry, defaults);

      expect(mockResolveSessionModels).toHaveBeenCalledWith(session, registry, defaults);
      expect(result).toBe(decisionModel);
    });
  });

  describe('createModelClient', () => {
    it('creates client with lazy getModel', async () => {
      const mockModel = createMockModel('resolved');
      const resolve = vi.fn().mockResolvedValue(mockModel);
      const registry = createMockRegistry(resolve);

      const { createModelClient } = await import('../provider.js');
      const client = createModelClient(registry, 'kimi', 'moonshot-v1');

      expect(client.provider).toBe('kimi');
      expect(client.model).toBe('moonshot-v1');

      const model = await client.getModel();
      expect(resolve).toHaveBeenCalledWith('kimi', 'moonshot-v1');
      expect(model).toBe(mockModel);
    });
  });
});
