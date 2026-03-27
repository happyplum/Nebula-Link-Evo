import * as fs from 'fs';
import * as path from 'path';
import { Config, ResolvedConfig } from './schema.js';
import { resolveConfig, ResolveResult } from './resolver.js';

export interface LoadResult {
  config: ResolvedConfig | null;
  result: ResolveResult;
  configPath: string;
}

export function loadConfig(configPath?: string): LoadResult {
  const searchPaths = [
    'config/config.json',
    '../config/config.json',
    '../../config/config.json',
    'nebula-link-evo/config/config.json',
  ];

  if (configPath) {
    searchPaths.unshift(configPath);
  }

  let foundPath: string | null = null;
  let rawConfig: ResolvedConfig | null = null;

  for (const p of searchPaths) {
    const absolutePath = path.resolve(p);
    if (fs.existsSync(absolutePath)) {
      try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const parsedConfig = JSON.parse(content) as Config;
        const { config, result } = resolveConfig(parsedConfig);
        if (result.success) {
          rawConfig = config;
          foundPath = absolutePath;
          break;
        }
      } catch (error) {
        console.warn(`Failed to parse config at ${absolutePath}:`, error);
      }
    }
  }

  if (!rawConfig) {
    return {
      config: null,
      result: {
        success: false,
        errors: ['Config file not found or invalid'],
        warnings: [],
      },
      configPath: '',
    };
  }

  return {
    config: rawConfig,
    result: { success: true, errors: [], warnings: [] },
    configPath: foundPath!,
  };
}

export function saveConfig(configPath: string, config: Config): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function createDefaultConfig(): Config {
  return {
    $schema: 'https://opencode.ai/config.json',
    version: '2.0',
    description: 'Nebula-Link Evo AI 配置',
    providers: {
      kimi: {
        name: 'Kimi (Moonshot)',
        enabled: true,
        apiKey: '{KIMI_API_KEY}',
        baseUrl: 'https://api.moonshot.cn/v1',
        mcp: ['browser-control'],
        models: {
          'moonshot-v1-vision-k2.5': {
            type: 'decision',
            capabilities: ['decision'],
            temperature: 0.2,
            maxTokens: 1000,
          },
        },
      },
      glm: {
        name: '智谱 GLM',
        enabled: true,
        apiKey: '{GLM_API_KEY}',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        mcp: ['browser-control', 'file-access'],
        models: {
          'glm-4.5v': {
            type: 'vision',
            capabilities: ['vision'],
            temperature: 0.7,
            maxTokens: 2000,
          },
        },
      },
    },
    mcp: {
      enabled: true,
      servers: {},
    },
    defaults: {
      mode: 'separation',
      vision: {
        provider: 'glm',
        model: 'glm-4.5v',
      },
      decision: {
        provider: 'kimi',
        model: 'moonshot-v1-vision-k2.5',
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
}

export function getConfigSearchPaths(): string[] {
  return [
    'config/config.json',
    '../config/config.json',
    '../../config/config.json',
    path.join(process.cwd(), 'config', 'config.json'),
    path.join(process.cwd(), '..', 'config', 'config.json'),
  ];
}
