import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveConfig,
  getProviderModel,
  getDefaultVisionModel,
  getDefaultDecisionModel,
  isUnifiedMode,
  type ResolverOptions,
} from '../../../config/resolver.js';
import type { Config } from '../../../config/schema.js';

describe('resolveConfig', () => {
  let baseConfig: Config;

  beforeEach(() => {
    baseConfig = {
      version: '1.0.0',
      providers: {
        openai: {
          name: 'OpenAI',
          enabled: true,
          apiKey: '{OPENAI_API_KEY}',
          baseUrl: 'https://api.openai.com/v1',
          mcp: [],
          models: {
            'gpt-4-vision': {
              type: 'vision',
              capabilities: ['vision', 'decision'],
              temperature: 0.5,
              maxTokens: 4096,
            },
            'gpt-4': {
              type: 'decision',
              capabilities: ['decision'],
              temperature: 0.2,
              maxTokens: 2048,
            },
          },
        },
        anthropic: {
          name: 'Anthropic',
          enabled: false,
          apiKey: '{ANTHROPIC_API_KEY}',
          baseUrl: 'https://api.anthropic.com/v1',
          mcp: [],
          models: {
            'claude-3': {
              type: 'vision',
              capabilities: ['vision'],
            },
          },
        },
      },
      mcp: {
        enabled: false,
        servers: {},
      },
      defaults: {
        mode: 'separation',
        vision: {
          provider: 'openai',
          model: 'gpt-4-vision',
        },
        decision: {
          provider: 'openai',
          model: 'gpt-4',
        },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    };
  });

  it('should resolve config with no variables', () => {
    const config = {
      ...baseConfig,
      providers: {
        openai: {
          ...baseConfig.providers.openai,
          apiKey: 'sk-test-key',
        },
      },
    };

    const { config: resolved, result } = resolveConfig(config);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(resolved._resolved.providers.openai.apiKey).toBe('sk-test-key');
    expect(resolved._resolved.providers.openai.models['gpt-4-vision'].resolvedTemperature).toBe(0.5);
    expect(resolved._resolved.providers.openai.models['gpt-4-vision'].resolvedMaxTokens).toBe(4096);
  });

  it('should resolve env variable substitution', () => {
    const options: ResolverOptions = {
      env: {
        OPENAI_API_KEY: 'sk-env-key',
      },
    };

    const { config: resolved, result } = resolveConfig(baseConfig, options);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(resolved._resolved.providers.openai.apiKey).toBe('sk-env-key');
  });

  it('should resolve with default value in template', () => {
    const config = {
      ...baseConfig,
      providers: {
        openai: {
          ...baseConfig.providers.openai,
          apiKey: '{OPENAI_API_KEY:sk-default-key}',
        },
      },
    };

    const { config: resolved, result } = resolveConfig(config);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(resolved._resolved.providers.openai.apiKey).toBe('sk-default-key');
  });

  it('should return error for missing required env var', () => {
    const { config: resolved, result } = resolveConfig(baseConfig, {
      env: {},
    });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('OPENAI_API_KEY');
    expect(result.errors[0]).toContain('is not set');
  });

  it('should skip disabled providers', () => {
    const options: ResolverOptions = {
      env: {
        OPENAI_API_KEY: 'sk-openai',
        ANTHROPIC_API_KEY: 'sk-anthropic',
      },
    };

    const { config: resolved, result } = resolveConfig(baseConfig, options);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(Object.keys(resolved._resolved.providers)).not.toContain('anthropic');
    expect(Object.keys(resolved._resolved.providers)).toContain('openai');
  });

  it('should resolve settings with values', () => {
    const { config: resolved, result } = resolveConfig({
      ...baseConfig,
      providers: {
        openai: {
          ...baseConfig.providers.openai,
          apiKey: 'sk-key',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(resolved._resolved.settings.timeout).toBe(30000);
    expect(resolved._resolved.settings.maxRetries).toBe(3);
    expect(resolved._resolved.settings.temperature).toBe(0.2);
    expect(resolved._resolved.settings.maxTokens).toBe(1000);
    expect(resolved._resolved.settings.maxSteps).toBe(1);
  });

  it('should resolve settings with env variables', () => {
    const options: ResolverOptions = {
      env: {
        TIMEOUT: '60000',
        MAX_RETRIES: '5',
      },
    };

    const config: Config = {
      ...baseConfig,
      providers: {
        openai: {
          ...baseConfig.providers.openai,
          apiKey: 'sk-key',
        },
      },
      settings: {
        timeout: 30000 as any,
        maxRetries: 3 as any,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    };

    const { config: resolved, result } = resolveConfig(config, options);

    expect(result.success).toBe(true);
    expect(resolved._resolved.settings.timeout).toBe(30000);
    expect(resolved._resolved.settings.maxRetries).toBe(3);
  });

  it('should use fallback for invalid settings values', () => {
    const { config: resolved } = resolveConfig({
      ...baseConfig,
      providers: {
        openai: {
          ...baseConfig.providers.openai,
          apiKey: 'sk-key',
        },
      },
      settings: {
        timeout: 'invalid' as any,
        maxRetries: 'not-a-number' as any,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    });

    expect(resolved._resolved.settings.timeout).toBe(30000);
    expect(resolved._resolved.settings.maxRetries).toBe(3);
  });

  it('should resolve settings with valid numeric strings', () => {
    const config: Config = {
      ...baseConfig,
      providers: {
        openai: {
          ...baseConfig.providers.openai,
          apiKey: 'sk-key',
        },
      },
      settings: {
        timeout: '60000' as any,
        maxRetries: '5' as any,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    };

    const { config: resolved, result } = resolveConfig(config);

    expect(result.success).toBe(true);
    expect(resolved._resolved.settings.timeout).toBe(60000);
    expect(resolved._resolved.settings.maxRetries).toBe(5);
  });

  it('should use fallback for settings with missing env var', () => {
    const config: Config = {
      ...baseConfig,
      providers: {
        openai: {
          ...baseConfig.providers.openai,
          apiKey: 'sk-key',
        },
      },
      settings: {
        timeout: '{MISSING_TIMEOUT}' as any,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    };

    const { config: resolved } = resolveConfig(config);

    expect(resolved._resolved.settings.timeout).toBe(30000);
  });

  it('should handle empty env value', () => {
    const { config: resolved, result } = resolveConfig(baseConfig, {
      env: {
        OPENAI_API_KEY: '',
      },
    });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('should preserve original config structure', () => {
    const { config: resolved } = resolveConfig({
      ...baseConfig,
      providers: {
        openai: {
          ...baseConfig.providers.openai,
          apiKey: 'sk-key',
        },
      },
    });

    expect(resolved.version).toBe('1.0.0');
    expect(resolved.mcp).toBeDefined();
    expect(resolved.defaults).toBeDefined();
    expect(resolved.settings).toBeDefined();
  });
});

describe('getProviderModel', () => {
  let resolvedConfig: any;

  beforeEach(() => {
    const { config } = resolveConfig({
      version: '1.0.0',
      providers: {
        openai: {
          name: 'OpenAI',
          enabled: true,
          apiKey: 'sk-key',
          baseUrl: 'https://api.openai.com/v1',
          mcp: [],
          models: {
            'gpt-4-vision': {
              type: 'vision',
              capabilities: ['vision'],
              temperature: 0.5,
              maxTokens: 4096,
            },
          },
        },
      },
      mcp: {
        enabled: false,
        servers: {},
      },
      defaults: {
        mode: 'separation',
        vision: {
          provider: 'openai',
          model: 'gpt-4-vision',
        },
        decision: {
          provider: 'openai',
          model: 'gpt-4',
        },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    });

    resolvedConfig = config;
  });

  it('should return provider and model when both exist', () => {
    const result = getProviderModel(resolvedConfig, 'openai', 'gpt-4-vision');

    expect(result).not.toBeNull();
    expect(result?.provider.name).toBe('OpenAI');
    expect(result?.provider.apiKey).toBe('sk-key');
    expect(result?.model.type).toBe('vision');
  });

  it('should return null when provider does not exist', () => {
    const result = getProviderModel(resolvedConfig, 'anthropic', 'claude-3');

    expect(result).toBeNull();
  });

  it('should return null when model does not exist', () => {
    const result = getProviderModel(resolvedConfig, 'openai', 'gpt-5');

    expect(result).toBeNull();
  });

  it('should return null for disabled providers', () => {
    const { config: resolved } = resolveConfig({
      version: '1.0.0',
      providers: {
        anthropic: {
          name: 'Anthropic',
          enabled: false,
          apiKey: 'sk-key',
          baseUrl: 'https://api.anthropic.com/v1',
          mcp: [],
          models: {
            'claude-3': {
              type: 'vision',
              capabilities: ['vision'],
            },
          },
        },
      },
      mcp: {
        enabled: false,
        servers: {},
      },
      defaults: {
        mode: 'separation',
        vision: {
          provider: 'anthropic',
          model: 'claude-3',
        },
        decision: {
          provider: 'anthropic',
          model: 'claude-3',
        },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    });

    const result = getProviderModel(resolved, 'anthropic', 'claude-3');

    expect(result).toBeNull();
  });
});

describe('getDefaultVisionModel', () => {
  it('should return provider and model in separation mode', () => {
    const { config: resolved } = resolveConfig({
      version: '1.0.0',
      providers: {
        openai: {
          name: 'OpenAI',
          enabled: true,
          apiKey: 'sk-key',
          baseUrl: 'https://api.openai.com/v1',
          mcp: [],
          models: {
            'gpt-4-vision': {
              type: 'vision',
              capabilities: ['vision'],
            },
          },
        },
      },
      mcp: {
        enabled: false,
        servers: {},
      },
      defaults: {
        mode: 'separation',
        vision: {
          provider: 'openai',
          model: 'gpt-4-vision',
        },
        decision: {
          provider: 'openai',
          model: 'gpt-4',
        },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    });

    const result = getDefaultVisionModel(resolved);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('openai');
    expect(result?.model).toBe('gpt-4-vision');
  });

  it('should return null in unified mode', () => {
    const { config: resolved } = resolveConfig({
      version: '1.0.0',
      providers: {
        openai: {
          name: 'OpenAI',
          enabled: true,
          apiKey: 'sk-key',
          baseUrl: 'https://api.openai.com/v1',
          mcp: [],
          models: {
            'gpt-4-vision': {
              type: 'vision',
              capabilities: ['vision'],
            },
          },
        },
      },
      mcp: {
        enabled: false,
        servers: {},
      },
      defaults: {
        mode: 'unified',
        vision: {
          provider: 'openai',
          model: 'gpt-4-vision',
        },
        decision: {
          provider: 'openai',
          model: 'gpt-4',
        },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    });

    const result = getDefaultVisionModel(resolved);

    expect(result).toBeNull();
  });
});

describe('getDefaultDecisionModel', () => {
  it('should return provider and model', () => {
    const { config: resolved } = resolveConfig({
      version: '1.0.0',
      providers: {
        openai: {
          name: 'OpenAI',
          enabled: true,
          apiKey: 'sk-key',
          baseUrl: 'https://api.openai.com/v1',
          mcp: [],
          models: {
            'gpt-4': {
              type: 'decision',
              capabilities: ['decision'],
            },
          },
        },
      },
      mcp: {
        enabled: false,
        servers: {},
      },
      defaults: {
        mode: 'separation',
        vision: {
          provider: 'openai',
          model: 'gpt-4-vision',
        },
        decision: {
          provider: 'openai',
          model: 'gpt-4',
        },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    });

    const result = getDefaultDecisionModel(resolved);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('openai');
    expect(result?.model).toBe('gpt-4');
  });

  it('should work in unified mode', () => {
    const { config: resolved } = resolveConfig({
      version: '1.0.0',
      providers: {
        openai: {
          name: 'OpenAI',
          enabled: true,
          apiKey: 'sk-key',
          baseUrl: 'https://api.openai.com/v1',
          mcp: [],
          models: {
            'gpt-4': {
              type: 'decision',
              capabilities: ['decision'],
            },
          },
        },
      },
      mcp: {
        enabled: false,
        servers: {},
      },
      defaults: {
        mode: 'unified',
        vision: {
          provider: 'openai',
          model: 'gpt-4-vision',
        },
        decision: {
          provider: 'openai',
          model: 'gpt-4',
        },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    });

    const result = getDefaultDecisionModel(resolved);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('openai');
    expect(result?.model).toBe('gpt-4');
  });
});

describe('isUnifiedMode', () => {
  it('should return true for unified mode', () => {
    const { config: resolved } = resolveConfig({
      version: '1.0.0',
      providers: {
        openai: {
          name: 'OpenAI',
          enabled: true,
          apiKey: 'sk-key',
          baseUrl: 'https://api.openai.com/v1',
          mcp: [],
          models: {},
        },
      },
      mcp: {
        enabled: false,
        servers: {},
      },
      defaults: {
        mode: 'unified',
        vision: {
          provider: 'openai',
          model: 'gpt-4-vision',
        },
        decision: {
          provider: 'openai',
          model: 'gpt-4',
        },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    });

    expect(isUnifiedMode(resolved)).toBe(true);
  });

  it('should return false for separation mode', () => {
    const { config: resolved } = resolveConfig({
      version: '1.0.0',
      providers: {
        openai: {
          name: 'OpenAI',
          enabled: true,
          apiKey: 'sk-key',
          baseUrl: 'https://api.openai.com/v1',
          mcp: [],
          models: {},
        },
      },
      mcp: {
        enabled: false,
        servers: {},
      },
      defaults: {
        mode: 'separation',
        vision: {
          provider: 'openai',
          model: 'gpt-4-vision',
        },
        decision: {
          provider: 'openai',
          model: 'gpt-4',
        },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    });

    expect(isUnifiedMode(resolved)).toBe(false);
  });
});
