import { describe, it, expect } from 'vitest';
import {
  parseProviderModel,
  normalizeNpmPackage,
  ProviderError,
  PROVIDER_ERRORS,
  PROVIDER_MODEL_SEPARATOR,
  BUILTIN_PROVIDERS,
  DEFAULT_NPM_PACKAGE,
  PACKAGE_NAME_RE,
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

  it('exports PACKAGE_NAME_RE', () => {
    expect(PACKAGE_NAME_RE.test('@ai-sdk/openai')).toBe(true);
    expect(PACKAGE_NAME_RE.test('@ai-sdk/openai-compatible')).toBe(true);
    expect(PACKAGE_NAME_RE.test('@ai-sdk/anthropic')).toBe(true);
    expect(PACKAGE_NAME_RE.test('@other-scope/openai')).toBe(false);
    expect(PACKAGE_NAME_RE.test('@ai-sdk/UPPERCASE')).toBe(false);
    expect(PACKAGE_NAME_RE.test('@ai-sdk/package with space')).toBe(false);
  });
});

describe('normalizeNpmPackage', () => {
  it('undefined → DEFAULT_NPM_PACKAGE', () => {
    expect(normalizeNpmPackage(undefined)).toBe('@ai-sdk/openai-compatible');
  });

  it('null → DEFAULT_NPM_PACKAGE', () => {
    expect(normalizeNpmPackage(null)).toBe('@ai-sdk/openai-compatible');
  });

  it('empty string → DEFAULT_NPM_PACKAGE', () => {
    expect(normalizeNpmPackage('')).toBe('@ai-sdk/openai-compatible');
  });

  it('whitespace string → DEFAULT_NPM_PACKAGE', () => {
    expect(normalizeNpmPackage('   ')).toBe('@ai-sdk/openai-compatible');
  });

  it('@ai-sdk/openai-compatible → pass-through', () => {
    expect(normalizeNpmPackage('@ai-sdk/openai-compatible')).toBe('@ai-sdk/openai-compatible');
  });

  it('@ai-sdk/openai → pass-through', () => {
    expect(normalizeNpmPackage('@ai-sdk/openai')).toBe('@ai-sdk/openai');
  });

  it('bare "openai" → @ai-sdk/openai', () => {
    expect(normalizeNpmPackage('openai')).toBe('@ai-sdk/openai');
  });

  it('bare "anthropic" → @ai-sdk/anthropic', () => {
    expect(normalizeNpmPackage('anthropic')).toBe('@ai-sdk/anthropic');
  });

  it('invalid package "not@valid" → throws ProviderError CONFIG_INVALID', () => {
    try {
      normalizeNpmPackage('not@valid');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe('PROVIDER_CONFIG_INVALID');
    }
  });

  it('invalid package "http://evil.com" → throws ProviderError CONFIG_INVALID', () => {
    try {
      normalizeNpmPackage('http://evil.com');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe('PROVIDER_CONFIG_INVALID');
    }
  });

  it('non-@ai-sdk scope "@other-scope/openai" → throws ProviderError CONFIG_INVALID', () => {
    try {
      normalizeNpmPackage('@other-scope/openai');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe('PROVIDER_CONFIG_INVALID');
    }
  });

  it('@ai-sdk/UPPERCASE → throws ProviderError CONFIG_INVALID', () => {
    try {
      normalizeNpmPackage('@ai-sdk/UPPERCASE');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe('PROVIDER_CONFIG_INVALID');
    }
  });
});
