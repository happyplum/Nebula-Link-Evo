import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDefaultDecisionModel,
  getProviderModel,
  isUnifiedMode,
  resolveConfig,
  type ResolverOptions,
} from '../../../config/resolver.js';
import type { Config } from '../../../config/schema.js';

describe('config/resolver with flat provider config', () => {
  let baseConfig: Config;

  beforeEach(() => {
    baseConfig = {
      version: '2.0',
      providers: {
        glm: {
          enabled: true,
          apiKey: '{GLM_API_KEY}',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        },
        openai: {
          enabled: false,
          apiKey: '{OPENAI_API_KEY}',
          baseUrl: 'https://api.openai.com/v1',
          npmPackage: '@ai-sdk/openai',
        },
      },
      mcp: { enabled: false, servers: {} },
      defaults: {
        mode: 'unified',
        decision: 'glm/glm-4.7-flash',
      },
      settings: {
        timeout: '{TIMEOUT:30000}',
        maxRetries: '{MAX_RETRIES:3}',
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 3,
      },
    };
  });

  it('resolves enabled providers and includes disabled providers', () => {
    const options: ResolverOptions = {
      env: {
        GLM_API_KEY: 'glm-secret',
      },
    };

    const { config: resolved, result } = resolveConfig(baseConfig, options);

    expect(result.success).toBe(true);
    expect(resolved.providers.glm.apiKey).toBe('glm-secret');
    expect(resolved.providers.glm.npmPackage).toBe('@ai-sdk/openai-compatible');
    expect(resolved.providers.openai).toBeDefined();
    expect(resolved.providers.openai.enabled).toBe(false);
    expect(resolved.providers.openai.apiKey).toBe('{OPENAI_API_KEY}');
  });

  it('parses defaults provider/model strings into selector objects', () => {
    const { config: resolved, result } = resolveConfig(baseConfig, {
      env: { GLM_API_KEY: 'glm-secret' },
    });

    expect(result.success).toBe(true);
    expect(resolved.defaults.decision).toEqual({ provider: 'glm', model: 'glm-4.7-flash' });
  });

  it('reports error for invalid defaults format', () => {
    const { result } = resolveConfig(
      {
        ...baseConfig,
        defaults: {
          ...baseConfig.defaults,
          decision: 'invalid-format',
        },
      },
      { env: { GLM_API_KEY: 'glm-secret' } }
    );

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('defaults.decision'))).toBe(true);
  });

  it('resolves default model helpers', () => {
    const { config: resolved } = resolveConfig(baseConfig, {
      env: { GLM_API_KEY: 'glm-secret' },
    });

    expect(getDefaultDecisionModel(resolved)).toEqual({ provider: 'glm', model: 'glm-4.7-flash' });
    expect(isUnifiedMode(resolved)).toBe(true);
  });

  it('returns provider for getProviderModel', () => {
    const { config: resolved } = resolveConfig(baseConfig, {
      env: { GLM_API_KEY: 'glm-secret' },
    });

    const entry = getProviderModel(resolved, 'glm', 'glm-4.7-flash');
    expect(entry).not.toBeNull();
    expect(entry?.provider.apiKey).toBe('glm-secret');
    const openaiEntry = getProviderModel(resolved, 'openai', 'gpt-4o');
    expect(openaiEntry).not.toBeNull();
    expect(openaiEntry?.provider.enabled).toBe(false);
  });

  it('mirrors raw provider models into resolved provider when provided', () => {
    const configWithModels: Config = {
      ...baseConfig,
      providers: {
        glm: {
          ...baseConfig.providers.glm,
          models: {
            'glm-4.7-flash': {
              type: 'multimodal',
              capabilities: ['vision', 'decision'],
            },
          },
        },
      },
    };

    const { config: resolved, result } = resolveConfig(configWithModels, {
      env: { GLM_API_KEY: 'glm-secret' },
    });

    expect(result.success).toBe(true);
    expect(resolved.providers.glm.models).toBeDefined();
    expect(resolved.providers.glm.models['glm-4.7-flash']).toEqual({
      type: 'multimodal',
      capabilities: ['vision', 'decision'],
    });
  });

  it('uses empty models object when raw provider omits models', () => {
    const { config: resolved, result } = resolveConfig(baseConfig, {
      env: { GLM_API_KEY: 'glm-secret' },
    });

    expect(result.success).toBe(true);
    expect(resolved.providers.glm.models).toEqual({});
  });
});
