import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig, getConfigSearchPaths, loadConfig, saveConfig } from '../../../config/loader.js';
import type { Config } from '../../../config/schema.js';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('path', () => ({
  resolve: vi.fn((value: string) => value),
  dirname: vi.fn((value: string) => value.split('/').slice(0, -1).join('/')),
  join: vi.fn((...parts: string[]) => parts.join('/')),
}));

vi.mock('../../../config/resolver.js', () => ({
  resolveConfig: vi.fn(),
}));

import * as fs from 'fs';
import { resolveConfig } from '../../../config/resolver.js';

describe('config/loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loadConfig returns resolved config from first valid path', () => {
    const mockConfig: Config = {
      version: '2.0',
      providers: { glm: { enabled: true, apiKey: '{GLM_API_KEY}' } },
      defaults: {
        mode: 'unified',
        decision: 'glm/glm-4.7-flash',
        vision: 'glm/glm-4.6v-flash',
      },
      mcp: { enabled: false, servers: {} },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 3,
      },
    };

    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(mockConfig));
    (resolveConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      config: {
        ...mockConfig,
        defaults: {
          mode: 'unified',
          decision: { provider: 'glm', model: 'glm-4.7-flash' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.2,
          maxTokens: 1000,
          maxSteps: 3,
        },
        providers: {},
      },
      result: { success: true, errors: [], warnings: [] },
    });

    const loaded = loadConfig('config/config.json');
    expect(loaded.result.success).toBe(true);
    expect(loaded.config).not.toBeNull();
    expect(loaded.configPath).toContain('config/config.json');
  });

  it('createDefaultConfig uses new flat provider format', () => {
    const config = createDefaultConfig();

    expect(config.providers.openai?.npmPackage).toBe('@ai-sdk/openai');
    expect(config.providers.anthropic?.npmPackage).toBe('@ai-sdk/anthropic');
    expect(config.providers.glm?.npmPackage).toBeUndefined();
    expect(config.defaults.decision).toBe('glm/glm-4.7-flash');
    expect(config.defaults.vision).toBe('glm/glm-4.6v-flash');
  });

  it('saveConfig writes prettified JSON', () => {
    const config = createDefaultConfig();
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    saveConfig('config/test.json', config);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'config/test.json',
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  });

  it('getConfigSearchPaths includes repo config path', () => {
    const paths = getConfigSearchPaths();
    expect(paths.some((entry) => entry.includes('config/config.json'))).toBe(true);
  });
});
