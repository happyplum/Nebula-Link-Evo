import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDefaultDecisionModel,
  getDefaultVisionModel,
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
        mode: 'separation',
        decision: 'glm/glm-4.7-flash',
        vision: 'glm/glm-4.6v-flash',
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

  it('resolves enabled providers and api keys', () => {
    const options: ResolverOptions = {
      env: {
        GLM_API_KEY: 'glm-secret',
      },
    };

    const { config: resolved, result } = resolveConfig(baseConfig, options);

    expect(result.success).toBe(true);
    expect(resolved._resolved.providers.glm.apiKey).toBe('glm-secret');
    expect(resolved._resolved.providers.glm.npmPackage).toBe('@ai-sdk/openai-compatible');
    expect(resolved._resolved.providers.openai).toBeUndefined();
  });

  it('parses defaults provider/model strings into selector objects', () => {
    const { config: resolved, result } = resolveConfig(baseConfig, {
      env: { GLM_API_KEY: 'glm-secret' },
    });

    expect(result.success).toBe(true);
    expect(resolved.defaults.decision).toEqual({ provider: 'glm', model: 'glm-4.7-flash' });
    expect(resolved.defaults.vision).toEqual({ provider: 'glm', model: 'glm-4.6v-flash' });
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
    expect(getDefaultVisionModel(resolved)).toEqual({ provider: 'glm', model: 'glm-4.6v-flash' });
    expect(isUnifiedMode(resolved)).toBe(false);
  });

  it('returns provider for getProviderModel', () => {
    const { config: resolved } = resolveConfig(baseConfig, {
      env: { GLM_API_KEY: 'glm-secret' },
    });

    const entry = getProviderModel(resolved, 'glm', 'glm-4.7-flash');
    expect(entry).not.toBeNull();
    expect(entry?.provider.apiKey).toBe('glm-secret');
    expect(getProviderModel(resolved, 'openai', 'gpt-4o')).toBeNull();
  });
});
