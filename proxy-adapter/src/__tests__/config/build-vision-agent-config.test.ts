import { describe, it, expect } from 'vitest';
import { buildVisionAgentConfig } from '../../tools/providers/build-vision-agent-config.js';
import type { ResolvedConfig } from '../../config/schema.js';

function makeConfig(
  overrides: Partial<ResolvedConfig> = {},
): ResolvedConfig {
  return {
    version: '1.0.0',
    providers: {},
    mcp: { enabled: false, servers: {} },
    defaults: { mode: 'unified', decision: { provider: 'test', model: 'test-model' } },
    settings: {
      timeout: 30000,
      maxRetries: 2,
      temperature: 0.1,
      maxTokens: 2048,
      maxSteps: 50,
      contextWindowTokens: 128000,
    },
    ...overrides,
  } as ResolvedConfig;
}

describe('buildVisionAgentConfig', () => {
  it('returns undefined when defaults.vision is not set', () => {
    const config = makeConfig();
    expect(config.defaults.vision).toBeUndefined();
    expect(buildVisionAgentConfig(config)).toBeUndefined();
  });

  it('returns undefined when vision provider does not exist', () => {
    const config = makeConfig({
      defaults: {
        mode: 'unified',
        decision: { provider: 'openai', model: 'gpt-4' },
        vision: { provider: 'nvidia', model: 'qwen/qwen3.5-122b-a10b' },
      },
    });
    // providers is empty → nvidia doesn't exist
    expect(buildVisionAgentConfig(config)).toBeUndefined();
  });

  it('returns undefined when vision provider is disabled', () => {
    const config = makeConfig({
      providers: {
        nvidia: {
          name: 'NVIDIA',
          enabled: false,
          apiKey: 'test-key',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          models: {},
        },
      },
      defaults: {
        mode: 'unified',
        decision: { provider: 'openai', model: 'gpt-4' },
        vision: { provider: 'nvidia', model: 'qwen/qwen3.5-122b-a10b' },
      },
    });
    expect(buildVisionAgentConfig(config)).toBeUndefined();
  });

  it('returns undefined when vision provider has no apiKey', () => {
    const config = makeConfig({
      providers: {
        nvidia: {
          name: 'NVIDIA',
          enabled: true,
          apiKey: '',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          models: {},
        },
      },
      defaults: {
        mode: 'unified',
        decision: { provider: 'openai', model: 'gpt-4' },
        vision: { provider: 'nvidia', model: 'qwen/qwen3.5-122b-a10b' },
      },
    });
    expect(buildVisionAgentConfig(config)).toBeUndefined();
  });

  it('returns valid config when provider is enabled with all fields', () => {
    const config = makeConfig({
      providers: {
        nvidia: {
          name: 'NVIDIA',
          enabled: true,
          apiKey: 'nvapi-test-key-123',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          models: {},
        },
      },
      defaults: {
        mode: 'unified',
        decision: { provider: 'nvidia', model: 'gpt-4' },
        vision: { provider: 'nvidia', model: 'qwen/qwen3.5-122b-a10b' },
      },
      settings: {
        timeout: 60000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 4096,
        maxSteps: 50,
        contextWindowTokens: 128000,
      },
    });

    const result = buildVisionAgentConfig(config);

    expect(result).toEqual({
      providerBaseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-test-key-123',
      modelId: 'qwen/qwen3.5-122b-a10b',
      maxTokens: 4096,
      temperature: 0.2,
      timeoutMs: 60000,
      maxRetries: 3,
    });
  });

  it('correctly maps multi-segment model IDs', () => {
    const config = makeConfig({
      providers: {
        nvidia: {
          enabled: true,
          apiKey: 'key',
          baseUrl: 'https://api.nvidia.com/v1',
          models: {},
        },
      },
      defaults: {
        mode: 'unified',
        decision: { provider: 'nvidia', model: 'meta/llama-3.1-70b-instruct' },
        vision: { provider: 'nvidia', model: 'qwen/qwen3.5-122b-a10b' },
      },
    });

    const result = buildVisionAgentConfig(config);
    expect(result?.modelId).toBe('qwen/qwen3.5-122b-a10b');
    expect(result?.providerBaseUrl).toBe('https://api.nvidia.com/v1');
  });
});
