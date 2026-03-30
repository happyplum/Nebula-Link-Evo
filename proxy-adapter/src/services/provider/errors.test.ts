import { describe, it, expect } from 'vitest';
import {
  parseProviderModel,
  ProviderError,
  PROVIDER_ERRORS,
  PROVIDER_MODEL_SEPARATOR,
  BUILTIN_PROVIDERS,
  DEFAULT_NPM_PACKAGE,
} from './errors.js';

describe('parseProviderModel', () => {
  it('parses standard provider/model strings correctly', () => {
    const result1 = parseProviderModel('glm/glm-4.7-flash');
    expect(result1.provider).toBe('glm');
    expect(result1.model).toBe('glm-4.7-flash');

    const result2 = parseProviderModel('openai/gpt-4o');
    expect(result2.provider).toBe('openai');
    expect(result2.model).toBe('gpt-4o');
  });

  it('preserves model segments after the first slash', () => {
    const result3 = parseProviderModel('openai/gpt-4o/variant');
    expect(result3.provider).toBe('openai');
    expect(result3.model).toBe('gpt-4o/variant');
  });

  it('trims whitespace', () => {
    const result4 = parseProviderModel(' glm / glm-4.7-flash ');
    expect(result4.provider).toBe('glm');
    expect(result4.model).toBe('glm-4.7-flash');
  });

  it('throws ProviderError for invalid formats', () => {
    // Empty string
    expect(() => parseProviderModel('')).toThrow(ProviderError);

    // No slash
    try {
      parseProviderModel('invalid_model');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe('PROVIDER_CONFIG_INVALID');
    }

    // Empty provider part
    try {
      parseProviderModel('/model');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe('PROVIDER_CONFIG_INVALID');
    }
  });
});

describe('ProviderError', () => {
  it('creates error with correct properties', () => {
    const error = new ProviderError(
      PROVIDER_ERRORS.NOT_FOUND,
      'test-provider',
      { reason: 'Model not found' }
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Provider Error');
    expect(error.code).toBe('PROVIDER_NOT_FOUND');
    expect(error.provider).toBe('test-provider');
    expect(error.details).toEqual({ reason: 'Model not found' });
  });

  it('serializes with details property', () => {
    const error = new ProviderError(
      PROVIDER_ERRORS.INSTALL_FAILED,
      'glm',
      { npmPackage: 'missing-package' }
    );

    const stringified = JSON.stringify(error);
    expect(stringified).toContain('npmPackage');
  });
});

describe('Constants', () => {
  it('exports PROVIDER_ERRORS with correct codes', () => {
    expect(PROVIDER_ERRORS.NOT_FOUND).toBe('PROVIDER_NOT_FOUND');
    expect(PROVIDER_ERRORS.INSTALL_FAILED).toBe('PROVIDER_INSTALL_FAILED');
    expect(PROVIDER_ERRORS.INIT_FAILED).toBe('PROVIDER_INIT_FAILED');
    expect(PROVIDER_ERRORS.CONFIG_INVALID).toBe('PROVIDER_CONFIG_INVALID');
    expect(PROVIDER_ERRORS.VISION_UNAVAILABLE).toBe('VISION_UNAVAILABLE');
    expect(PROVIDER_ERRORS.RATE_LIMITED).toBe('RATE_LIMITED');
  });

  it('exports BUILTIN_PROVIDERS', () => {
    expect(BUILTIN_PROVIDERS['openai-compatible'].npmPackage).toBe('@ai-sdk/openai-compatible');
    expect(BUILTIN_PROVIDERS['openai-compatible'].factory).toBe('createOpenAICompatible');
  });

  it('exports DEFAULT_NPM_PACKAGE', () => {
    expect(DEFAULT_NPM_PACKAGE).toBe('@ai-sdk/openai-compatible');
  });

  it('exports PROVIDER_MODEL_SEPARATOR', () => {
    expect(PROVIDER_MODEL_SEPARATOR).toBe('/');
  });
});
