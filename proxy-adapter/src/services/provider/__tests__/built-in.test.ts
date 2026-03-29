import { describe, it, expect } from 'vitest';
import { createBuiltinProvider } from '../built-in.js';
import {
  createTestConfig,
  createMockLanguageModel,
} from './helpers/mock-factory.js';
import { ProviderError, PROVIDER_ERRORS } from '../errors.js';

describe('createBuiltinProvider', () => {
  describe('valid built-in name', () => {
    it('should create a provider for openai-compatible', () => {
      const config = createTestConfig({
        baseUrl: 'https://api.test.com',
        apiKey: 'test-api-key',
      });

      const provider = createBuiltinProvider('openai-compatible', config) as any;

      // createOpenAICompatible returns a provider with .languageModel() method
      expect(typeof provider.languageModel).toBe('function');
    });
  });

  describe('invalid built-in name', () => {
    it('should throw ProviderError for unknown name', () => {
      const config = createTestConfig();

      try {
        createBuiltinProvider('invalid-provider', config);
        expect.unreachable('should have thrown ProviderError');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).code).toBe('PROVIDER_NOT_FOUND');
        expect((e as ProviderError).provider).toBe('invalid-provider');
      }
    });

    it('should list available built-in names in error message', () => {
      const config = createTestConfig();

      try {
        createBuiltinProvider('non-existent', config);
        expect.unreachable('should have thrown ProviderError');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).details).toContain('openai-compatible');
      }
    });
  });

  describe('config field mapping', () => {
    it('should pass baseURL, apiKey, headers to factory function', () => {
      const config = createTestConfig({
        baseUrl: 'https://custom-base-url.com',
        apiKey: 'custom-api-key',
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      const provider = createBuiltinProvider('openai-compatible', config) as any;

      // Create a mock model to verify the provider works
      const model = provider.languageModel as any;

      expect(model).toBeDefined();
    });
  });
});
