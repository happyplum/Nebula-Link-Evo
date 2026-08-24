import * as fs from 'fs';
import * as path from 'path';
import { Config, ResolvedConfig } from './schema.js';
import { resolveConfig, ResolveResult } from './resolver.js';
import { createWorkerLogger } from '../services/logger.js';
import {
  buildGatewayMcpUrl,
  GATEWAY_MCP_SERVER_NAME,
  loadGatewayUrlFromEnv,
} from './service-config.js';

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
export function loadRawConfig(
  configPath?: string,
  gatewayUrl = loadGatewayUrlFromEnv()
): RawLoadResult {
  const searchPaths = configPath
    ? [configPath]
    : [
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
      return { config: withRequiredGateway(parsed, gatewayUrl), configPath: absolutePath, errors };
    } catch (error) {
      errors.push(`${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length === 0) errors.push('Config file not found');
  return { config: null, configPath: '', errors };
}

export function loadConfig(configPath?: string, gatewayUrl = loadGatewayUrlFromEnv()): LoadResult {
  const searchPaths = configPath
    ? [configPath]
    : [
        'config/config.json',
        '../config/config.json',
        '../../config/config.json',
        'nebula-link-evo/config/config.json',
      ];

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
          resolvedConfig = withRequiredGateway(resolveResult.config, gatewayUrl);
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

  if (!resolvedConfig || !foundPath) {
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
    configPath: foundPath,
  };
}

function withRequiredGateway<T extends Config | ResolvedConfig>(config: T, gatewayUrl: string): T {
  if (Object.prototype.hasOwnProperty.call(config.mcp.servers, GATEWAY_MCP_SERVER_NAME)) {
    throw new Error(`MCP server name '${GATEWAY_MCP_SERVER_NAME}' is reserved for proxy-adapter`);
  }

  const url = buildGatewayMcpUrl(gatewayUrl);
  logger.info(
    { serverName: GATEWAY_MCP_SERVER_NAME, url },
    'Registering required proxy gateway MCP server'
  );

  return {
    ...config,
    mcp: {
      ...config.mcp,
      enabled: true,
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
