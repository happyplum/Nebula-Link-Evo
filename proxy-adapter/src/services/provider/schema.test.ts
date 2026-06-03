import { describe, it, expect } from 'vitest';
import { ProviderSchemaV2 } from './schema.js';
import type { ProviderSchemaV2Input } from './schema.js';

describe('provider schema', () => {
  it('should reject config missing defaults', () => {
    const input = {
      providers: {
        'test-provider': {},
      },
    };

    const result = ProviderSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should parse full config', () => {
    const input = {
      providers: {
        'test-provider': {
          npmPackage: '@ai-sdk/openai-compatible',
          baseUrl: 'https://api.test.com',
          apiKey: '{TEST_KEY}',
          headers: { 'Authorization': 'Bearer token' },
        },
      },
      defaults: {
        decision: 'provider/model',
        vision: 'provider/model',
      },
    };

    const result = ProviderSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should reject config missing defaults', () => {
    const input = {
      providers: {
        'test-provider': {},
      },
    };

    const result = ProviderSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject invalid provider entry - non-string npmPackage', () => {
    const input = {
      providers: {
        'test-provider': {
          npmPackage: 123,
        },
      },
      defaults: {
        decision: 'provider/model',
        vision: 'provider/model',
      },
    };

    const result = ProviderSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should parse full config with provider defaults', () => {
    const input: ProviderSchemaV2Input = {
      providers: {
        'test-provider': {
          npmPackage: '@ai-sdk/openai-compatible',
          baseUrl: 'https://api.test.com',
          apiKey: '{TEST_KEY}',
          headers: { 'Authorization': 'Bearer token' },
          allowDynamicInstall: true,
        },
      },
      defaults: {
        decision: 'provider/model',
        vision: 'provider/model',
      },
    };

    const result = ProviderSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data?.providers['test-provider']?.npmPackage).toBe('@ai-sdk/openai-compatible');
    expect(result.data?.providers['test-provider']?.baseUrl).toBe('https://api.test.com');
    expect(result.data?.providers['test-provider']?.apiKey).toBe('{TEST_KEY}');
    expect(result.data?.providers['test-provider']?.headers).toEqual({ 'Authorization': 'Bearer token' });
    expect(result.data?.providers['test-provider']?.allowDynamicInstall).toBe(true);
    expect(result.data?.defaults?.decision).toBe('provider/model');
    expect(result.data?.defaults?.vision).toBe('provider/model');
  });

  it('should parse config without legacy vision tool settings', () => {
    const input: ProviderSchemaV2Input = {
      providers: {
        'test-provider': {
          npmPackage: '@ai-sdk/openai-compatible',
          baseUrl: 'https://api.test.com',
        },
      },
      defaults: {
        decision: 'provider/model',
        vision: 'provider/model',
      },
    };

    const result = ProviderSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should accept any string for defaults (format validation is separate)', () => {
    const input: ProviderSchemaV2Input = {
      providers: {
        'test-provider': {},
      },
      defaults: {
        decision: 'any-string',
        vision: 'any-string',
      },
    };

    const result = ProviderSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should reject invalid provider entry - non-string baseUrl', () => {
    const input: ProviderSchemaV2Input = {
      providers: {
        'test-provider': {
          baseUrl: 123 as unknown as string,
        },
      },
      defaults: {
        decision: 'provider/model',
        vision: 'provider/model',
      },
    };

    const result = ProviderSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject invalid provider entry - non-string headers values', () => {
    const input: ProviderSchemaV2Input = {
      providers: {
        'test-provider': {
          headers: { 'key': 123 as unknown as string },
        },
      },
      defaults: {
        decision: 'provider/model',
        vision: 'provider/model',
      },
    };

    const result = ProviderSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should ignore unknown legacy visionTool fields', () => {
    const input: ProviderSchemaV2Input = {
      providers: {
        'test-provider': {},
      },
      defaults: {
        decision: 'provider/model',
        vision: 'provider/model',
      },
      visionTool: {
        maxCallsPerStep: 'not a number' as unknown as number,
      } as unknown as never,
    };

    const result = ProviderSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
  });
});
