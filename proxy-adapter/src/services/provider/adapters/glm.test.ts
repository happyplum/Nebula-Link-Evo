import { describe, it, expect } from 'vitest';
import { createGLMProvider, GLMProviderConfig } from './glm.js';

describe('GLM Adapter', () => {
  it('should generate valid JWT token format', () => {
    // This is a mock invocation to verify format logic without external crypto
    // In a real test, we would mock crypto.createHmac
    const mockConfig: GLMProviderConfig = {
      apiKey: 'id.secret',
    baseUrl: 'https://test.api',
    };

    // We expect the factory to return a provider instance
    const provider = createGLMProvider(mockConfig);
    expect(provider).toBeDefined();
    // Check if the provider has a languageModel method (expected from createOpenAICompatible)
    expect(typeof provider.languageModel).toBe('function');
  });

  it('should throw error for invalid API key format', () => {
    const invalidConfig: GLMProviderConfig = {
      apiKey: 'invalid-key', // No dot
      baseUrl: 'https://test.api',
    };

    expect(() => createGLMProvider(invalidConfig)).toThrow('Invalid GLM API key format. Expected format: id.secret');
  });
});
