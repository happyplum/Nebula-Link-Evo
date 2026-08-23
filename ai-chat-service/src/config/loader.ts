import * as fs from 'fs';
import * as path from 'path';
import { Config, ResolvedConfig } from './schema.js';
import { resolveConfig, ResolveResult } from './resolver.js';
import { createWorkerLogger } from '../services/logger.js';
import { buildGatewayMcpUrl, GATEWAY_MCP_SERVER_NAME, loadGatewayUrlFromEnv } from './service-config.js';

const logger = createWorkerLogger('config-loader');

export interface LoadResult {
  config: ResolvedConfig | null;
  result: ResolveResult;
  configPath: string;
}

export interface RawLoadResult {
  config: Config | null;
  configPath: string;
  errors: string[];
}

/** Load provider configuration without resolving `{VAR}` placeholders into secret values. */
export function loadRawConfig(configPath?: string): RawLoadResult {
  const searchPaths = [
    ...(configPath ? [configPath] : []),
    'config/config.json',
    '../config/config.json',
    '../../config/config.json',
    'nebula-link-evo/config/config.json',
  ];
  const errors: string[] = [];
  for (const candidate of searchPaths) {
    const absolutePath = path.resolve(candidate);
    if (!fs.existsSync(absolutePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf-8')) as Config;
      return { config: withAutoRegisteredGateway(parsed), configPath: absolutePath, errors };
    } catch (error) {
      errors.push(`${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length === 0) errors.push('Config file not found');
  return { config: null, configPath: '', errors };
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
  let resolvedConfig: ResolvedConfig | null = null;
  let lastResolveResult: ResolveResult | null = null;

  for (const p of searchPaths) {
    const absolutePath = path.resolve(p);
    if (fs.existsSync(absolutePath)) {
      try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const parsedConfig = JSON.parse(content) as Config;
        const resolveResult = resolveConfig(parsedConfig);
        if (resolveResult.result.success) {
          resolvedConfig = withAutoRegisteredGateway(resolveResult.config);
          lastResolveResult = resolveResult.result;
          foundPath = absolutePath;
          break;
        } else {
          lastResolveResult = resolveResult.result;
        }
      } catch (error) {
        logger.warn({ err: error, path: absolutePath }, 'Failed to parse config');
      }
    }
  }

  if (!resolvedConfig) {
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
    config: resolvedConfig,
    result: lastResolveResult ?? { success: true, errors: [], warnings: [] },
    configPath: foundPath!,
  };
}

function withAutoRegisteredGateway<T extends Config | ResolvedConfig>(config: T): T {
  if (!config.mcp.enabled) {
    return config;
  }

  if (Object.prototype.hasOwnProperty.call(config.mcp.servers, GATEWAY_MCP_SERVER_NAME)) {
    return config;
  }

  const url = buildGatewayMcpUrl(loadGatewayUrlFromEnv());
  logger.info({ serverName: GATEWAY_MCP_SERVER_NAME, url }, 'Auto-registering proxy gateway MCP server');

  return {
    ...config,
    mcp: {
      ...config.mcp,
      servers: {
        ...config.mcp.servers,
        [GATEWAY_MCP_SERVER_NAME]: {
          enabled: true,
          command: '',
          args: [],
          env: {},
          url,
        },
      },
    },
  } as T;
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
      glm: {
        enabled: true,
        apiKey: '{GLM_API_KEY}',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      },
      kimi: {
        enabled: false,
        apiKey: '{KIMI_API_KEY}',
        baseUrl: 'https://api.moonshot.cn/v1',
      },
      openai: {
        enabled: false,
        npmPackage: '@ai-sdk/openai',
        apiKey: '{OPENAI_API_KEY}',
        baseUrl: 'https://api.openai.com/v1',
      },
      anthropic: {
        enabled: false,
        npmPackage: '@ai-sdk/anthropic',
        apiKey: '{ANTHROPIC_API_KEY}',
        baseUrl: 'https://api.anthropic.com/v1',
      },
      nvidia: {
        enabled: true,
        apiKey: '{NVIDIA_API_KEY}',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
      },
    },
    mcp: {
      enabled: true,
      servers: {},
    },
    defaults: {
      mode: 'unified',
      decision: 'glm/glm-4.7-flash',
      vision: 'glm/glm-4.6v-flash',
    },
    settings: {
      timeout: 30000,
      maxRetries: 3,
      temperature: 0.2,
      maxTokens: 1000,
      maxSteps: 1,
      contextWindowTokens: 131072,
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
