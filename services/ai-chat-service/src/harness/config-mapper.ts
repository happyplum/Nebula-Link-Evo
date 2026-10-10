import { resolve } from 'node:path';
import type { Config, FlatProvider, MCPReconnectConfig } from '../config/schema.js';
import type { HarnessModelRoute, HarnessRuntimeConfig } from './types.js';
import type { PiAiModelProfile, PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai';
import type { Config as DshMcpConfig, ReconnectConfig } from '@deepseek-ai/dsh-mcp-client';
import type { NebulaGlmAdapterOptions, NebulaGlmModel } from './glm-adapter.js';

const ENV_REFERENCE = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const DEFAULT_MCP_TOOL_TIMEOUT_MS = 30_000;

export interface MapHarnessConfigOptions {
  dataDir: string;
  env?: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  persona?: string;
}

export function mapHarnessConfig(
  config: Config,
  options: MapHarnessConfigOptions
): HarnessRuntimeConfig {
  const env = options.env ?? process.env;
  const decision = parseModelSelector(config.defaults.decision, 'defaults.decision', config);
  const vision = config.defaults.vision
    ? parseModelSelector(config.defaults.vision, 'defaults.vision', config)
    : undefined;
  const maxRetries = positiveIntegerSetting(
    config.settings.maxRetries,
    env,
    3,
    'settings.maxRetries'
  );
  const timeoutMs = positiveIntegerSetting(
    config.settings.timeout,
    env,
    30_000,
    'settings.timeout'
  );
  const configuredMaxTokens = positiveIntegerSetting(
    config.settings.maxTokens,
    env,
    1_000,
    'settings.maxTokens'
  );
  const contextWindow = positiveIntegerSetting(
    config.settings.contextWindowTokens ?? 131_072,
    env,
    131_072,
    'settings.contextWindowTokens'
  );
  const temperature = finiteSetting(config.settings.temperature, env, 0.2, 'settings.temperature');
  const modelRoutes = new Map<string, Set<string>>();
  addModelRoute(modelRoutes, decision);
  if (vision) addModelRoute(modelRoutes, vision);

  const piProviders: Record<string, PiAiProviderProfile> = {};
  let glm: Omit<NebulaGlmAdapterOptions, 'attachments'> | undefined;
  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (!provider.enabled) continue;
    const apiKeyEnv = requireCredentialReference(providerId, provider, env);
    if (providerId === 'glm') {
      glm = {
        provider: providerId,
        apiKeyEnv,
        baseUrl: provider.baseUrl,
        timeoutMs,
        retryPolicy: { mode: 'normal', maxRetries },
        models: buildGlmModels(
          provider,
          modelRoutes.get(providerId),
          contextWindow,
          configuredMaxTokens
        ),
        env,
      };
      continue;
    }
    const models = buildPiModels(
      providerId,
      provider,
      modelRoutes.get(providerId),
      contextWindow,
      configuredMaxTokens
    );
    if (!provider.baseUrl) {
      throw new Error(`Provider ${providerId}: baseUrl is required`);
    }
    piProviders[providerId] = {
      displayName: provider.name ?? providerId,
      apiKeyEnv,
      api: 'openai-completions',
      baseURL: provider.baseUrl,
      models,
      timeoutMs,
      retryPolicy: { mode: 'normal', maxRetries },
    };
  }

  const decisionProvider = config.providers[decision.provider];
  if (!decisionProvider?.enabled) {
    throw new Error(`Default decision provider ${decision.provider} is unavailable`);
  }
  return {
    sessionRoot: resolve(options.dataDir, 'harness-sessions'),
    attachmentRoot: resolve(options.dataDir, 'harness-attachments'),
    persona: options.persona ?? '你是 Nebula-Link Evo 的智能助手。',
    maxParallelToolCalls: 4,
    piAi: { providers: piProviders },
    ...(glm ? { glm } : {}),
    decision: { ...decision, temperature, maxTokens: configuredMaxTokens },
    ...(vision ? { vision: { ...vision, temperature, maxTokens: configuredMaxTokens } } : {}),
    mcp: mapMcpConfig(config, options.cwd ?? process.cwd(), env),
  };
}

function buildGlmModels(
  provider: FlatProvider,
  selected: ReadonlySet<string> | undefined,
  contextWindow: number,
  configuredMaxTokens: number
): NebulaGlmModel[] {
  const ids = new Set([...Object.keys(provider.models ?? {}), ...(selected ?? [])]);
  if (ids.size === 0)
    throw new Error('Provider glm: at least one model must be declared or selected');
  return [...ids].map((id) => {
    const model = provider.models?.[id];
    return {
      id,
      contextWindow,
      maxTokens: model?.maxTokens ?? configuredMaxTokens,
      acceptsImages: model?.capabilities.includes('vision') ?? false,
    };
  });
}

function parseModelSelector(value: string, path: string, config: Config): HarnessModelRoute {
  const separator = value.indexOf('/');
  const provider = separator > 0 ? value.slice(0, separator).trim() : '';
  const model = separator > 0 ? value.slice(separator + 1).trim() : '';
  if (!provider || !model) throw new Error(`${path} must use provider/model format`);
  if (!config.providers[provider])
    throw new Error(`${path} references unknown provider ${provider}`);
  return { provider, model };
}

function addModelRoute(routes: Map<string, Set<string>>, route: HarnessModelRoute): void {
  const models = routes.get(route.provider) ?? new Set<string>();
  models.add(route.model);
  routes.set(route.provider, models);
}

function requireCredentialReference(
  providerId: string,
  provider: FlatProvider,
  env: Readonly<Record<string, string | undefined>>
): string {
  const match = ENV_REFERENCE.exec(provider.apiKey);
  if (!match?.[1]) {
    throw new Error(`Provider ${providerId}: apiKey must be a single {ENV_VAR} reference`);
  }
  const name = match[1];
  if (!env[name]?.trim()) {
    throw new Error(`Provider ${providerId}: required environment variable ${name} is not set`);
  }
  return name;
}

function buildPiModels(
  providerId: string,
  provider: FlatProvider,
  selected: ReadonlySet<string> | undefined,
  contextWindow: number,
  configuredMaxTokens: number
): PiAiModelProfile[] {
  const ids = new Set([...Object.keys(provider.models ?? {}), ...(selected ?? [])]);
  if (ids.size === 0) {
    throw new Error(`Provider ${providerId}: at least one model must be declared or selected`);
  }
  return [...ids].map((id) => {
    const model = provider.models?.[id];
    const supportsVision = model?.capabilities.includes('vision') ?? false;
    return {
      id,
      name: id,
      contextWindow,
      maxTokens: model?.maxTokens ?? configuredMaxTokens,
      input: supportsVision ? ['text', 'image'] : ['text'],
    };
  });
}

function mapMcpConfig(
  config: Config,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>
): DshMcpConfig[] {
  if (!config.mcp.enabled) return [];
  const reconnect = mapReconnect(config.mcp.reconnect);
  return Object.entries(config.mcp.servers)
    .filter(([, server]) => server.enabled)
    .map(([serverName, server]) => {
      if (server.url) {
        return {
          transport: 'streamable-http' as const,
          serverName,
          url: new URL(server.url).toString(),
          headers: {},
          toolCallTimeoutMs: DEFAULT_MCP_TOOL_TIMEOUT_MS,
          failOnStartupError: server.optional !== true,
          reconnect,
        };
      }
      if (server.optional) {
        throw new Error(`MCP server ${serverName}: stdio servers cannot be optional`);
      }
      if (!server.command) throw new Error(`MCP server ${serverName}: command or url is required`);
      return {
        transport: 'stdio' as const,
        serverName,
        command: server.command,
        args: [...server.args],
        env: resolveMcpEnvironment(serverName, server.env, env),
        cwd: resolve(cwd, server.cwd ?? '.'),
        toolCallTimeoutMs: DEFAULT_MCP_TOOL_TIMEOUT_MS,
        failOnStartupError: true,
        reconnect,
      };
    });
}

function resolveMcpEnvironment(
  serverName: string,
  configured: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(configured).map(([key, value]) => {
      const match = ENV_REFERENCE.exec(value);
      if (!match?.[1]) {
        throw new Error(
          `MCP server ${serverName}: env.${key} must be a single {ENV_VAR} reference`
        );
      }
      const resolved = env[match[1]];
      if (!resolved) {
        throw new Error(
          `MCP server ${serverName}: required environment variable ${match[1]} is not set`
        );
      }
      return [key, resolved];
    })
  );
}

export function mapReconnect(config: MCPReconnectConfig | undefined): ReconnectConfig {
  const enabled = config?.enabled ?? true;
  const maxAttempts = config?.maxAttempts ?? 5;
  const initialDelayMs = config?.baseDelayMs ?? 1_000;
  const maxDelayMs = config?.maxDelayMs ?? 30_000;
  if (initialDelayMs <= 0 || maxDelayMs <= 0) {
    throw new Error('MCP reconnect delays must be greater than zero');
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error('MCP reconnect baseDelayMs cannot exceed maxDelayMs');
  }
  if (maxAttempts < 0 || !Number.isSafeInteger(maxAttempts)) {
    throw new Error('MCP reconnect maxAttempts must be a non-negative integer');
  }
  return maxAttempts === 0
    ? { enabled: false, initialDelayMs, maxDelayMs, maxAttempts: 1 }
    : { enabled, initialDelayMs, maxDelayMs, maxAttempts };
}

function settingText(
  value: number | string,
  env: Readonly<Record<string, string | undefined>>,
  fallback: number,
  path: string
): string {
  if (typeof value === 'number') return String(value);
  const defaultMatch = /^\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]+))?\}$/.exec(value);
  if (!defaultMatch?.[1]) return value;
  const resolved = env[defaultMatch[1]] ?? defaultMatch[2];
  if (resolved === undefined || resolved.trim() === '') {
    throw new Error(`${path}: required environment variable ${defaultMatch[1]} is not set`);
  }
  return resolved || String(fallback);
}

function positiveIntegerSetting(
  value: number | string,
  env: Readonly<Record<string, string | undefined>>,
  fallback: number,
  path: string
): number {
  const parsed = Number(settingText(value, env, fallback, path));
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${path} must be a positive integer`);
  return parsed;
}

function finiteSetting(
  value: number | string,
  env: Readonly<Record<string, string | undefined>>,
  fallback: number,
  path: string
): number {
  const parsed = Number(settingText(value, env, fallback, path));
  if (!Number.isFinite(parsed)) throw new Error(`${path} must be finite`);
  return parsed;
}
