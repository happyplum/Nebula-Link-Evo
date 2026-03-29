import { describe, expect, it } from 'vitest';
import type {
  Config,
  DefaultsConfig,
  FlatProvider,
  ModelConfig,
  ModelSelector,
  ResolvedConfig,
} from '../../../config/schema.js';

describe('config/schema types', () => {
  it('accepts flat provider config', () => {
    const provider: FlatProvider = {
      enabled: true,
      apiKey: '{GLM_API_KEY}',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    };

    expect(provider.enabled).toBe(true);
    expect(provider.apiKey).toContain('GLM_API_KEY');
  });

  it('accepts string defaults in raw config', () => {
    const defaults: DefaultsConfig = {
      mode: 'separation',
      decision: 'glm/glm-4.7-flash',
      vision: 'glm/glm-4.6v-flash',
    };

    expect(defaults.decision).toContain('/');
    expect(defaults.vision).toContain('/');
  });

  it('keeps resolved defaults as provider/model objects', () => {
    const resolved: ResolvedConfig = {
      version: '2.0',
      providers: {
        glm: {
          enabled: true,
          apiKey: '{GLM_API_KEY}',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        },
      },
      mcp: { enabled: false, servers: {} },
      defaults: {
        mode: 'separation',
        decision: { provider: 'glm', model: 'glm-4.7-flash' },
        vision: { provider: 'glm', model: 'glm-4.6v-flash' },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 3,
      },
      _resolved: {
        providers: {
          glm: {
            enabled: true,
            apiKey: 'resolved-key',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            npmPackage: '@ai-sdk/openai-compatible',
            models: {},
          },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.2,
          maxTokens: 1000,
          maxSteps: 3,
        },
      },
    };

    expect(resolved.defaults.decision.provider).toBe('glm');
    expect(resolved._resolved.providers.glm.npmPackage).toBe('@ai-sdk/openai-compatible');
  });

  it('preserves legacy helper types', () => {
    const selector: ModelSelector = { provider: 'glm', model: 'glm-4.7-flash' };
    const modelConfig: ModelConfig = {
      type: 'decision',
      capabilities: ['decision'],
    };
    const config: Config = {
      version: '2.0',
      providers: { glm: { enabled: true, apiKey: '{GLM_API_KEY}' } },
      mcp: { enabled: false, servers: {} },
      defaults: {
        mode: 'separation',
        decision: 'glm/glm-4.7-flash',
        vision: 'glm/glm-4.6v-flash',
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 3,
      },
    };

    expect(selector.model).toContain('glm');
    expect(modelConfig.capabilities).toContain('decision');
    expect(config.defaults.vision).toContain('/');
  });
});
