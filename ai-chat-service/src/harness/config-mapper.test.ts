import { describe, expect, it } from 'vitest';
import type { Config } from '../config/schema.js';
import { mapHarnessConfig, mapReconnect } from './config-mapper.js';

function config(): Config {
  return {
    version: '2.0',
    providers: {
      nvidia: {
        enabled: true,
        apiKey: '{NVIDIA_API_KEY}',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        models: {
          'decision-model': { type: 'decision', capabilities: ['decision'] },
          'vision-model': { type: 'vision', capabilities: ['vision'] },
        },
      },
    },
    defaults: {
      mode: 'unified',
      decision: 'nvidia/decision-model',
      vision: 'nvidia/vision-model',
    },
    mcp: {
      enabled: true,
      reconnect: { enabled: true, maxAttempts: 0, baseDelayMs: 500, maxDelayMs: 5_000 },
      servers: {
        proxy: {
          enabled: true,
          command: 'node',
          args: ['server.js'],
          env: { SAFE_FLAG: '{MCP_SAFE_FLAG}' },
          cwd: 'proxy',
        },
        optionalRemote: {
          enabled: true,
          command: '',
          args: [],
          env: {},
          url: 'https://example.test/mcp',
          optional: true,
        },
      },
    },
    settings: {
      timeout: '{TIMEOUT:180000}',
      maxRetries: '{MAX_RETRIES:3}',
      temperature: 0.2,
      maxTokens: 4_096,
      maxSteps: 3,
      contextWindowTokens: 131_072,
    },
  };
}

describe('mapHarnessConfig', () => {
  it('maps provider, model and MCP fields without copying secret values', () => {
    const mapped = mapHarnessConfig(config(), {
      dataDir: 'C:\\nebula-data',
      cwd: 'C:\\workspace',
      env: { NVIDIA_API_KEY: 'super-secret', MCP_SAFE_FLAG: '1' },
    });

    expect(mapped.piAi.providers?.nvidia).toMatchObject({
      apiKeyEnv: 'NVIDIA_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://integrate.api.nvidia.com/v1',
      retryPolicy: { mode: 'normal', maxRetries: 3 },
      timeoutMs: 180_000,
    });
    expect(JSON.stringify(mapped)).not.toContain('super-secret');
    expect(mapped.piAi.providers?.nvidia?.models).toEqual([
      expect.objectContaining({ id: 'decision-model', input: ['text'] }),
      expect.objectContaining({ id: 'vision-model', input: ['text', 'image'] }),
    ]);
    expect(mapped.mcp).toEqual([
      expect.objectContaining({
        transport: 'stdio',
        serverName: 'proxy',
        failOnStartupError: true,
        reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5_000, maxAttempts: 1 },
      }),
      expect.objectContaining({
        transport: 'streamable-http',
        serverName: 'optionalRemote',
        failOnStartupError: false,
      }),
    ]);
    expect(mapped.mcp[0]).toMatchObject({ env: { SAFE_FLAG: '1' } });
  });

  it('fails closed when an environment reference is missing', () => {
    expect(() => mapHarnessConfig(config(), { dataDir: '.', env: {} })).toThrow(
      'required environment variable NVIDIA_API_KEY is not set'
    );
  });

  it('refuses inline provider secrets', () => {
    const raw = config();
    raw.providers.nvidia!.apiKey = 'inline-secret';
    expect(() =>
      mapHarnessConfig(raw, {
        dataDir: '.',
        env: { NVIDIA_API_KEY: 'present', MCP_SAFE_FLAG: '1' },
      })
    ).toThrow('apiKey must be a single {ENV_VAR} reference');
  });

  it('rejects zero delays instead of creating a reconnect spin loop', () => {
    expect(() => mapReconnect({ baseDelayMs: 0 })).toThrow(
      'MCP reconnect delays must be greater than zero'
    );
  });
});
