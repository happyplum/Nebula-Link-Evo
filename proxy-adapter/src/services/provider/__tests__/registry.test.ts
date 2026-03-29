import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry } from '../registry.js';
import { ProviderError, PROVIDER_ERRORS } from '../errors.js';
import {
  createMockLanguageModel,
  createTestConfig,
} from './helpers/mock-factory.js';

vi.mock('../built-in.js', () => ({
  createBuiltinProvider: vi.fn(),
}));

vi.mock('../loader.js', () => ({
  loadProviderPackage: vi.fn(),
}));

import { createBuiltinProvider } from '../built-in.js';
import { loadProviderPackage } from '../loader.js';

const mockCreateBuiltin = vi.mocked(createBuiltinProvider);
const mockLoadPackage = vi.mocked(loadProviderPackage);

/** Returns a mock provider function: (modelId) => LanguageModelV3 */
function mockProviderFn() {
  return vi.fn((modelId: string) =>
    createMockLanguageModel({ modelId }),
  );
}

describe('ProviderRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── resolve ──────────────────────────────────────────────────────

  describe('resolve — built-in provider', () => {
    it('should resolve via createBuiltinProvider and return LanguageModel', async () => {
      const provider = mockProviderFn();
      mockCreateBuiltin.mockReturnValue(provider);

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      const model = await registry.resolve('openai-compatible', 'gpt-4o');

      expect(mockCreateBuiltin).toHaveBeenCalledWith(
        'openai-compatible',
        expect.objectContaining({ apiKey: 'test-api-key' }),
      );
      expect(provider).toHaveBeenCalledWith('gpt-4o');
      expect(model.modelId).toBe('gpt-4o');
    });
  });

  describe('resolve — dynamic provider', () => {
    it('should resolve via loadProviderPackage and return LanguageModel', async () => {
      const provider = mockProviderFn();
      const factory = vi.fn().mockReturnValue(provider);
      mockLoadPackage.mockResolvedValue(factory);

      const registry = new ProviderRegistry({
        anthropic: createTestConfig({ npmPackage: '@ai-sdk/anthropic' }),
      });

      const model = await registry.resolve('anthropic', 'claude-3');

      expect(mockLoadPackage).toHaveBeenCalledWith('@ai-sdk/anthropic');
      expect(factory).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'test-api-key' }),
      );
      expect(provider).toHaveBeenCalledWith('claude-3');
      expect(model.modelId).toBe('claude-3');
    });

    it('should use DEFAULT_NPM_PACKAGE when npmPackage is omitted', async () => {
      const provider = mockProviderFn();
      const factory = vi.fn().mockReturnValue(provider);
      mockLoadPackage.mockResolvedValue(factory);

      const registry = new ProviderRegistry({
        custom: createTestConfig(),
      });

      await registry.resolve('custom', 'custom-model');

      expect(mockLoadPackage).toHaveBeenCalledWith('@ai-sdk/openai-compatible');
    });
  });

  describe('resolve — unknown provider', () => {
    it('should throw ProviderError NOT_FOUND', async () => {
      const registry = new ProviderRegistry({});

      try {
        await registry.resolve('unknown', 'model');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const err = e as ProviderError;
        expect(err.code).toBe(PROVIDER_ERRORS.NOT_FOUND);
        expect(err.provider).toBe('unknown');
      }
    });
  });

  describe('resolve — caching', () => {
    it('should cache provider and not reload on second call', async () => {
      const provider = mockProviderFn();
      mockCreateBuiltin.mockReturnValue(provider);

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      await registry.resolve('openai-compatible', 'gpt-4o');
      await registry.resolve('openai-compatible', 'gpt-4o-mini');

      expect(mockCreateBuiltin).toHaveBeenCalledTimes(1);
      expect(provider).toHaveBeenCalledTimes(2);
      expect(provider).toHaveBeenNthCalledWith(1, 'gpt-4o');
      expect(provider).toHaveBeenNthCalledWith(2, 'gpt-4o-mini');
    });
  });

  // ── isAvailable ──────────────────────────────────────────────────

  describe('isAvailable', () => {
    it('should return true for configured provider', () => {
      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });
      expect(registry.isAvailable('openai-compatible')).toBe(true);
    });

    it('should return false for unconfigured provider', () => {
      const registry = new ProviderRegistry({});
      expect(registry.isAvailable('unknown')).toBe(false);
    });
  });

  // ── listProviders ────────────────────────────────────────────────

  describe('listProviders', () => {
    it('should return configured provider keys', () => {
      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
        anthropic: createTestConfig({ npmPackage: '@ai-sdk/anthropic' }),
      });

      expect(registry.listProviders()).toEqual([
        'openai-compatible',
        'anthropic',
      ]);
    });

    it('should return empty array for empty config', () => {
      const registry = new ProviderRegistry({});
      expect(registry.listProviders()).toEqual([]);
    });
  });

  // ── getProviderConfig ────────────────────────────────────────────

  describe('getProviderConfig', () => {
    it('should return config for known provider', () => {
      const config = createTestConfig({ apiKey: 'my-key' });
      const registry = new ProviderRegistry({ test: config });

      expect(registry.getProviderConfig('test')).toEqual(config);
    });

    it('should throw ProviderError NOT_FOUND for unknown provider', () => {
      const registry = new ProviderRegistry({});

      try {
        registry.getProviderConfig('unknown');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).code).toBe(PROVIDER_ERRORS.NOT_FOUND);
      }
    });
  });
});
