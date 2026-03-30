import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry } from '../registry.js';
import { ProviderError, PROVIDER_ERRORS } from '../errors.js';
import {
  createMockLanguageModel,
  createTestConfig,
} from './helpers/mock-factory.js';

vi.mock('../loader.js', () => ({
  loadProviderPackage: vi.fn(),
}));

import { loadProviderPackage } from '../loader.js';

const mockLoadPackage = vi.mocked(loadProviderPackage);

/** Returns a mock provider function: (modelId) => LanguageModelV3 */
function mockProviderFn() {
  return vi.fn((modelId: string) =>
    createMockLanguageModel({ modelId }),
  );
}

/**
 * Creates a mock module namespace with a named factory export.
 * `factoryName` defaults to `createOpenAICompatible` (matching @ai-sdk/openai-compatible).
 */
function mockModuleNamespace(factory: ReturnType<typeof vi.fn>, factoryName = 'createOpenAICompatible') {
  return { [factoryName]: factory };
}

describe('ProviderRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── resolve ──────────────────────────────────────────────────────

  describe('resolve — default provider', () => {
    it('should resolve via loadProviderPackage using default npm package', async () => {
      const provider = mockProviderFn();
      const factory = vi.fn().mockReturnValue(provider);
      mockLoadPackage.mockResolvedValue(mockModuleNamespace(factory));

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      const model = await registry.resolve('openai-compatible', 'gpt-4o');

      // Normalizes undefined npmPackage to @ai-sdk/openai-compatible
      expect(mockLoadPackage).toHaveBeenCalledWith('@ai-sdk/openai-compatible');
      // Discovers createOpenAICompatible export
      expect(factory).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'test-api-key' }),
      );
      expect(provider).toHaveBeenCalledWith('gpt-4o');
      expect(model.modelId).toBe('gpt-4o');
    });
  });

  describe('resolve — explicit npm package', () => {
    it('should resolve via loadProviderPackage with named factory discovery', async () => {
      const provider = mockProviderFn();
      const factory = vi.fn().mockReturnValue(provider);
      mockLoadPackage.mockResolvedValue(
        mockModuleNamespace(factory, 'createAnthropic'),
      );

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
  });

  describe('resolve — short package name normalization', () => {
    it('should normalize short name to @ai-sdk/* and resolve', async () => {
      const provider = mockProviderFn();
      const factory = vi.fn().mockReturnValue(provider);
      mockLoadPackage.mockResolvedValue(
        mockModuleNamespace(factory, 'createOpenAI'),
      );

      const registry = new ProviderRegistry({
        openai: createTestConfig({ npmPackage: 'openai' }),
      });

      await registry.resolve('openai', 'gpt-4');

      // 'openai' normalizes to '@ai-sdk/openai'
      expect(mockLoadPackage).toHaveBeenCalledWith('@ai-sdk/openai');
      // Factory name derived: @ai-sdk/openai → createOpenAI
      expect(factory).toHaveBeenCalled();
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

  describe('resolve — missing factory export', () => {
    it('should throw ProviderError INIT_FAILED when factory export is missing', async () => {
      // Module has no matching factory export
      mockLoadPackage.mockResolvedValue({ someOtherExport: vi.fn() });

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      try {
        await registry.resolve('openai-compatible', 'gpt-4o');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const err = e as ProviderError;
        expect(err.code).toBe(PROVIDER_ERRORS.INIT_FAILED);
        expect(err.provider).toBe('openai-compatible');
        expect(String(err.details)).toContain('createOpenAICompatible');
      }
    });
  });

  describe('resolve — caching', () => {
    it('should cache provider and not reload on second call', async () => {
      const provider = mockProviderFn();
      const factory = vi.fn().mockReturnValue(provider);
      mockLoadPackage.mockResolvedValue(mockModuleNamespace(factory));

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      await registry.resolve('openai-compatible', 'gpt-4o');
      await registry.resolve('openai-compatible', 'gpt-4o-mini');

      // Module loaded only once (cached after first success)
      expect(mockLoadPackage).toHaveBeenCalledTimes(1);
      // Factory called only once
      expect(factory).toHaveBeenCalledTimes(1);
      // Provider function called twice with different model IDs
      expect(provider).toHaveBeenCalledTimes(2);
      expect(provider).toHaveBeenNthCalledWith(1, 'gpt-4o');
      expect(provider).toHaveBeenNthCalledWith(2, 'gpt-4o-mini');
    });
  });

  // ── isAvailable ──────────────────────────────────────────────────

  describe('isAvailable', () => {
    it('should return true for configured provider before probing', () => {
      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });
      expect(registry.isAvailable('openai-compatible')).toBe(true);
    });

    it('should return false for unconfigured provider', () => {
      const registry = new ProviderRegistry({});
      expect(registry.isAvailable('unknown')).toBe(false);
    });

    it('should return false after probing fails', async () => {
      mockLoadPackage.mockRejectedValue(new Error('module not found'));

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      await registry.probeProvider('openai-compatible');
      expect(registry.isAvailable('openai-compatible')).toBe(false);
    });

    it('should return true after probing succeeds', async () => {
      const provider = mockProviderFn();
      const factory = vi.fn().mockReturnValue(provider);
      mockLoadPackage.mockResolvedValue(mockModuleNamespace(factory));

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      await registry.probeProvider('openai-compatible');
      expect(registry.isAvailable('openai-compatible')).toBe(true);
    });
  });

  // ── probeProvider ────────────────────────────────────────────────

  describe('probeProvider', () => {
    it('should record success when provider loads', async () => {
      const provider = mockProviderFn();
      const factory = vi.fn().mockReturnValue(provider);
      mockLoadPackage.mockResolvedValue(mockModuleNamespace(factory));

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      await registry.probeProvider('openai-compatible');

      expect(registry.isAvailable('openai-compatible')).toBe(true);
      expect(registry.getAvailabilityError('openai-compatible')).toBeUndefined();
      // Provider cached so resolve() won't reload
      await registry.resolve('openai-compatible', 'gpt-4o');
      expect(mockLoadPackage).toHaveBeenCalledTimes(1);
    });

    it('should record failure when provider load throws', async () => {
      mockLoadPackage.mockRejectedValue(new Error('module not found'));

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      await registry.probeProvider('openai-compatible');

      expect(registry.isAvailable('openai-compatible')).toBe(false);
      expect(registry.getAvailabilityError('openai-compatible')).toBe('module not found');
    });

    it('should record failure for unknown provider key', async () => {
      const registry = new ProviderRegistry({});

      await registry.probeProvider('unknown');

      expect(registry.isAvailable('unknown')).toBe(false);
      expect(registry.getAvailabilityError('unknown')).toContain('not found in configuration');
    });

    it('should extract ProviderError details', async () => {
      // Module loads but missing factory export
      mockLoadPackage.mockResolvedValue({ someOtherExport: vi.fn() });

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      await registry.probeProvider('openai-compatible');

      expect(registry.isAvailable('openai-compatible')).toBe(false);
      const err = registry.getAvailabilityError('openai-compatible');
      expect(err).toContain('PROVIDER_INIT_FAILED');
      expect(err).toContain('createOpenAICompatible');
    });

    it('should not throw — errors captured as availability state', async () => {
      mockLoadPackage.mockRejectedValue(new Error('catastrophic'));

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      await expect(
        registry.probeProvider('openai-compatible'),
      ).resolves.toBeUndefined();
    });
  });

  // ── getAvailabilityError ─────────────────────────────────────────

  describe('getAvailabilityError', () => {
    it('should return undefined for unprobed provider', () => {
      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });
      expect(registry.getAvailabilityError('openai-compatible')).toBeUndefined();
    });

    it('should return undefined for successfully probed provider', async () => {
      const provider = mockProviderFn();
      const factory = vi.fn().mockReturnValue(provider);
      mockLoadPackage.mockResolvedValue(mockModuleNamespace(factory));

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      await registry.probeProvider('openai-compatible');
      expect(registry.getAvailabilityError('openai-compatible')).toBeUndefined();
    });

    it('should return error message for failed provider', async () => {
      mockLoadPackage.mockRejectedValue(new Error('timeout'));

      const registry = new ProviderRegistry({
        'openai-compatible': createTestConfig(),
      });

      await registry.probeProvider('openai-compatible');
      expect(registry.getAvailabilityError('openai-compatible')).toBe('timeout');
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
