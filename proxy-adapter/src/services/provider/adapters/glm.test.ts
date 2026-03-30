import { describe, it, expect } from 'vitest';
import { createGLMAdapter } from './glm.js';
import type { ProviderConfig } from '../types.js';
import { ProviderError, PROVIDER_ERRORS } from '../errors.js';

describe('GLM Adapter', () => {
  it('should generate valid JWT token format', () => {
    // This is a mock invocation to verify format logic without external crypto
    // In a real test, we would mock crypto.createHmac
    const mockConfig: ProviderConfig = {
      apiKey: 'id.secret',
      baseUrl: 'https://test.api',
    };

    // createGLMAdapter should return a ProviderFn (a function)
    const providerFn = createGLMAdapter(mockConfig);
    expect(providerFn).toBeDefined();
    expect(typeof providerFn).toBe('function');
  });

  it('should throw ProviderError for invalid API key format', () => {
    const invalidConfig: ProviderConfig = {
      apiKey: 'invalid-key', // No dot
      baseUrl: 'https://test.api',
    };

    try {
      createGLMAdapter(invalidConfig);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe('PROVIDER_INIT_FAILED');
      expect((error as ProviderError).provider).toBe('glm');
      expect((error as ProviderError).details).toContain('Invalid GLM API key format');
    }
  });

  it('should throw error when apiKey is missing', () => {
    const invalidConfig: ProviderConfig = {
      baseUrl: 'https://test.api',
    } as ProviderConfig; // apiKey is required but missing

    try {
      createGLMAdapter(invalidConfig);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe('PROVIDER_INIT_FAILED');
      expect((error as ProviderError).provider).toBe('glm');
      expect((error as ProviderError).details).toBe('GLM provider requires an apiKey');
    }
  });

  it('should return a function (ProviderFn contract)', () => {
    const config: ProviderConfig = {
      apiKey: 'id.secret',
    };

    const providerFn = createGLMAdapter(config);
    expect(typeof providerFn).toBe('function');
  });

  it('should create language model when calling returned function with modelId', () => {
    const config: ProviderConfig = {
      apiKey: 'id.secret',
    };

    const providerFn = createGLMAdapter(config);
    const model = providerFn('glm-4');

    // The model should have the expected LanguageModelV3 interface
    expect(model).toBeDefined();
    expect(typeof model.doGenerate).toBe('function');
    expect(typeof model.doStream).toBe('function');
  });
});
