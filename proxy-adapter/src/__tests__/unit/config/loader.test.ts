import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, saveConfig, createDefaultConfig, getConfigSearchPaths } from '../../../config/loader.js';
import type { Config } from '../../../config/schema.js';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock path module
vi.mock('path', () => ({
  resolve: vi.fn((p) => p),
  dirname: vi.fn((p) => p.split('/').slice(0, -1).join('/')),
  join: vi.fn((...args) => args.join('/')),
}));

// Mock resolver
vi.mock('../../../config/resolver.js', () => ({
  resolveConfig: vi.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import { resolveConfig } from '../../../config/resolver.js';

describe('config/loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default path.resolve behavior
    (path.resolve as any).mockImplementation((p: string) => {
      return p.startsWith('/') ? p : `/absolute/${p}`;
    });
  });

  describe('loadConfig', () => {
    const mockConfig: Config = {
      version: '2.0',
      providers: {},
      mcp: { enabled: true, servers: {} },
      defaults: {
        mode: 'separation',
        vision: { provider: 'kimi', model: 'moonshot-v1-vision-k2.5' },
        decision: { provider: 'kimi', model: 'moonshot-v1-vision-k2.5' },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    };

    it('should load config from provided path when file exists', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue(JSON.stringify(mockConfig));
      (resolveConfig as any).mockReturnValue({
        config: { ...mockConfig, _resolved: {} },
        result: { success: true, errors: [], warnings: [] },
      });

      const result = loadConfig('custom/config.json');

      expect(result.config).toBeDefined();
      expect(result.result.success).toBe(true);
      expect(result.configPath).toContain('custom/config.json');
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('custom/config.json'),
        'utf-8'
      );
    });

    it('should search default paths when no configPath provided', () => {
      (fs.existsSync as any).mockImplementation((path: string) => {
        return path.includes('config/config.json');
      });
      (fs.readFileSync as any).mockReturnValue(JSON.stringify(mockConfig));
      (resolveConfig as any).mockReturnValue({
        config: { ...mockConfig, _resolved: {} },
        result: { success: true, errors: [], warnings: [] },
      });

      const result = loadConfig();

      expect(result.config).toBeDefined();
      expect(result.result.success).toBe(true);
      expect(fs.existsSync).toHaveBeenCalled();
    });

    it('should stop at first valid config file found', () => {
      (fs.existsSync as any).mockImplementation((path: string) => {
        return path === '/absolute/config/config.json';
      });
      (fs.readFileSync as any).mockReturnValue(JSON.stringify(mockConfig));
      (resolveConfig as any).mockReturnValue({
        config: { ...mockConfig, _resolved: {} },
        result: { success: true, errors: [], warnings: [] },
      });

      const result = loadConfig();

      expect(result.config).toBeDefined();
      expect(result.result.success).toBe(true);
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('should return null config when no valid file found', () => {
      (fs.existsSync as any).mockReturnValue(false);

      const result = loadConfig();

      expect(result.config).toBeNull();
      expect(result.result.success).toBe(false);
      expect(result.result.errors).toContain('Config file not found or invalid');
      expect(result.configPath).toBe('');
    });

    it('should handle JSON parse errors gracefully', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('invalid json{');

      const result = loadConfig();

      expect(result.config).toBeNull();
      expect(result.result.success).toBe(false);
    });

    it('should skip files that fail resolver validation', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue(JSON.stringify(mockConfig));
      (resolveConfig as any).mockReturnValue({
        config: null,
        result: { success: false, errors: ['Validation failed'], warnings: [] },
      });

      const result = loadConfig();

      expect(result.config).toBeNull();
      expect(result.result.success).toBe(false);
    });

    it('should try next path when resolver fails for current path', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue(JSON.stringify(mockConfig));
      (resolveConfig as any)
        .mockReturnValueOnce({
          config: null,
          result: { success: false, errors: ['First failed'], warnings: [] },
        })
        .mockReturnValueOnce({
          config: { ...mockConfig, _resolved: {} },
          result: { success: true, errors: [], warnings: [] },
        });

      const result = loadConfig();

      expect(result.config).toBeDefined();
      expect(result.result.success).toBe(true);
      expect(resolveConfig).toHaveBeenCalledTimes(2);
    });
  });

  describe('saveConfig', () => {
    const mockConfig: Config = {
      version: '2.0',
      providers: {},
      mcp: { enabled: true, servers: {} },
      defaults: {
        mode: 'separation',
        vision: { provider: 'kimi', model: 'moonshot-v1-vision-k2.5' },
        decision: { provider: 'kimi', model: 'moonshot-v1-vision-k2.5' },
      },
      settings: {
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.2,
        maxTokens: 1000,
        maxSteps: 1,
      },
    };

    it('should write config to file', () => {
      (fs.existsSync as any).mockReturnValue(true);

      saveConfig('config/test.json', mockConfig);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        'config/test.json',
        JSON.stringify(mockConfig, null, 2),
        'utf-8'
      );
    });

    it('should create directory if it does not exist', () => {
      (fs.existsSync as any).mockReturnValue(false);
      (path.dirname as any).mockReturnValue('config');

      saveConfig('config/test.json', mockConfig);

      expect(fs.mkdirSync).toHaveBeenCalledWith('config', { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        'config/test.json',
        JSON.stringify(mockConfig, null, 2),
        'utf-8'
      );
    });

    it('should create nested directories if needed', () => {
      (fs.existsSync as any).mockReturnValue(false);
      (path.dirname as any).mockReturnValue('deep/nested/path');

      saveConfig('deep/nested/path/config.json', mockConfig);

      expect(fs.mkdirSync).toHaveBeenCalledWith('deep/nested/path', { recursive: true });
    });

    it('should not create directory if it exists', () => {
      (fs.existsSync as any).mockReturnValue(true);

      saveConfig('existing/path/config.json', mockConfig);

      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should write formatted JSON with 2-space indentation', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.writeFileSync as any).mockImplementation((_path: string, content: string) => {
        expect(content).toContain('  '); // Check for 2-space indentation
      });

      saveConfig('config/test.json', mockConfig);
    });
  });

  describe('createDefaultConfig', () => {
    it('should return complete config object', () => {
      const config = createDefaultConfig();

      expect(config).toBeDefined();
      expect(config.version).toBe('2.0');
      expect(config.providers).toBeDefined();
      expect(config.mcp).toBeDefined();
      expect(config.defaults).toBeDefined();
      expect(config.settings).toBeDefined();
    });

    it('should include $schema field', () => {
      const config = createDefaultConfig();

      expect(config.$schema).toBe('https://opencode.ai/config.json');
    });

    it('should have description field', () => {
      const config = createDefaultConfig();

      expect(config.description).toBe('Nebula-Link Evo AI 配置');
    });

    it('should include providers with kimi and glm', () => {
      const config = createDefaultConfig();

      expect(config.providers.kimi).toBeDefined();
      expect(config.providers.glm).toBeDefined();
    });

    it('should have kimi provider with correct structure', () => {
      const config = createDefaultConfig();

      expect(config.providers.kimi.name).toBe('Kimi (Moonshot)');
      expect(config.providers.kimi.enabled).toBe(true);
      expect(config.providers.kimi.apiKey).toBe('{KIMI_API_KEY}');
      expect(config.providers.kimi.baseUrl).toBe('https://api.moonshot.cn/v1');
      expect(config.providers.kimi.mcp).toEqual(['browser-control']);
      expect(config.providers.kimi.models).toBeDefined();
    });

    it('should have glm provider with correct structure', () => {
      const config = createDefaultConfig();

      expect(config.providers.glm.name).toBe('智谱 GLM');
      expect(config.providers.glm.enabled).toBe(true);
      expect(config.providers.glm.apiKey).toBe('{GLM_API_KEY}');
      expect(config.providers.glm.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
      expect(config.providers.glm.mcp).toEqual(['browser-control', 'file-access']);
      expect(config.providers.glm.models).toBeDefined();
    });

    it('should have MCP config', () => {
      const config = createDefaultConfig();

      expect(config.mcp.enabled).toBe(true);
      expect(config.mcp.servers).toEqual({});
    });

    it('should have defaults with separation mode', () => {
      const config = createDefaultConfig();

      expect(config.defaults.mode).toBe('separation');
      expect(config.defaults.vision.provider).toBe('glm');
      expect(config.defaults.vision.model).toBe('glm-4.5v');
      expect(config.defaults.decision.provider).toBe('kimi');
      expect(config.defaults.decision.model).toBe('moonshot-v1-vision-k2.5');
    });

    it('should have settings with default values', () => {
      const config = createDefaultConfig();

      expect(config.settings.timeout).toBe(30000);
      expect(config.settings.maxRetries).toBe(3);
      expect(config.settings.temperature).toBe(0.2);
      expect(config.settings.maxTokens).toBe(1000);
      expect(config.settings.maxSteps).toBe(1);
    });

    it('should have moonshot-v1-vision-k2.5 model for kimi', () => {
      const config = createDefaultConfig();

      expect(config.providers.kimi.models['moonshot-v1-vision-k2.5']).toBeDefined();
      expect(config.providers.kimi.models['moonshot-v1-vision-k2.5'].type).toBe('decision');
      expect(config.providers.kimi.models['moonshot-v1-vision-k2.5'].capabilities).toEqual(['decision']);
      expect(config.providers.kimi.models['moonshot-v1-vision-k2.5'].temperature).toBe(0.2);
      expect(config.providers.kimi.models['moonshot-v1-vision-k2.5'].maxTokens).toBe(1000);
    });

    it('should have glm-4.5v model for glm', () => {
      const config = createDefaultConfig();

      expect(config.providers.glm.models['glm-4.5v']).toBeDefined();
      expect(config.providers.glm.models['glm-4.5v'].type).toBe('vision');
      expect(config.providers.glm.models['glm-4.5v'].capabilities).toEqual(['vision']);
      expect(config.providers.glm.models['glm-4.5v'].temperature).toBe(0.7);
      expect(config.providers.glm.models['glm-4.5v'].maxTokens).toBe(2000);
    });
  });

  describe('getConfigSearchPaths', () => {
    beforeEach(() => {
      // Mock process.cwd
      vi.stubGlobal('process', {
        cwd: () => '/current/working/directory',
      });
    });

    it('should return array of search paths', () => {
      const paths = getConfigSearchPaths();

      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
    });

    it('should include config/config.json', () => {
      const paths = getConfigSearchPaths();

      expect(paths).toContain('config/config.json');
    });

    it('should include ../config/config.json', () => {
      const paths = getConfigSearchPaths();

      expect(paths).toContain('../config/config.json');
    });

    it('should include ../../config/config.json', () => {
      const paths = getConfigSearchPaths();

      expect(paths).toContain('../../config/config.json');
    });

    it('should include absolute paths using process.cwd', () => {
      const paths = getConfigSearchPaths();

      expect(paths).toContain('/current/working/directory/config/config.json');
      expect(paths).toContain('/current/working/directory/../config/config.json');
    });

    it('should return exactly 5 paths', () => {
      const paths = getConfigSearchPaths();

      expect(paths.length).toBe(5);
    });
  });
});
