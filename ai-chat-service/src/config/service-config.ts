/**
 * Environment-driven configuration for ai-chat-service.
 *
 * Holds process-level service settings (port, host, gateway URL, CORS) that sit
 * beside the AI provider config loaded from config.json.
 */

import { delimiter } from 'node:path';

const PINO_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
type PinoLevel = (typeof PINO_LEVELS)[number];

/** Known provider aliases exposed for service-level status surfaces. */
const KNOWN_PROVIDERS = ['glm', 'openai', 'anthropic', 'kimi', 'nvidia'] as const;
const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:3000';

export const GATEWAY_MCP_SERVER_NAME = 'gateway' as const;

export interface ProviderPlaceholder {
  /** Provider alias, e.g. "glm", "openai". */
  alias: string;
  /** Whether the provider is enabled. Defaults to false until T6-T9. */
  enabled: boolean;
  /** Resolved API key, empty string when unset. */
  apiKey: string;
  /** Provider base URL, empty string when unset. */
  baseUrl: string;
}

export interface AiChatServiceConfig {
  port: number;
  host: string;
  logLevel: PinoLevel;
  /** URL of the browser MCP gateway (proxy-adapter). Consumed in T6-T9. */
  gatewayUrl: string;
  /** Allowed CORS origins for debug-ui. Empty array denies all; ["*"] allows all. */
  corsOrigins: string[];
  /** Local read-only roots containing declarative Skill packages. */
  skillDirectories: string[];
  /** Provider placeholders. Keys are provider aliases. */
  providers: Record<string, ProviderPlaceholder>;
}

export function loadGatewayUrlFromEnv(): string {
  return process.env.PROXY_ADAPTER_URL ?? DEFAULT_GATEWAY_URL;
}

export function buildGatewayMcpUrl(gatewayUrl: string): string {
  const normalized = gatewayUrl.endsWith('/') ? gatewayUrl.slice(0, -1) : gatewayUrl;
  return normalized.endsWith('/mcp') ? normalized : `${normalized}/mcp`;
}

function normalizeLogLevel(): PinoLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && PINO_LEVELS.includes(envLevel as PinoLevel)) {
    return envLevel as PinoLevel;
  }
  return 'info';
}

function readProviderEnv(alias: string): ProviderPlaceholder {
  const upper = alias.toUpperCase();
  const apiKey = process.env[`${upper}_API_KEY`] ?? '';
  const baseUrl = process.env[`${upper}_BASE_URL`] ?? '';
  const enabledEnv = process.env[`${upper}_ENABLED`]?.toLowerCase();
  return {
    alias,
    // Providers default to disabled until the AI stack migrates (T6-T9).
    enabled: enabledEnv === 'true' || enabledEnv === '1',
    apiKey,
    baseUrl,
  };
}

/**
 * Load configuration from environment variables.
 *
 * Reads (all optional unless noted):
 * - `AI_CHAT_SERVICE_PORT` (default 3001)
 * - `HOST` (default 127.0.0.1, localhost-only by binding constraint)
 * - `LOG_LEVEL` (default info)
 * - `PROXY_ADAPTER_URL` (default http://127.0.0.1:3000) — browser MCP gateway
 * - `CORS_ORIGINS` (comma-separated; default http://localhost:5173)
 * - `AI_SKILLS_DIRS` (platform-delimited local read-only Skill roots; default empty)
 * - `<ALIAS>_API_KEY` / `<ALIAS>_BASE_URL` / `<ALIAS>_ENABLED` per provider
 */
export function loadConfig(): AiChatServiceConfig {
  const port = parseInt(process.env.AI_CHAT_SERVICE_PORT ?? '3001', 10);
  const host = process.env.HOST ?? '127.0.0.1';
  const gatewayUrl = loadGatewayUrlFromEnv();

  const corsRaw = process.env.CORS_ORIGINS;
  const corsOrigins = corsRaw
    ? corsRaw
        .split(',')
        .map(o => o.trim())
        .filter(Boolean)
    : ['http://localhost:5173'];
  const skillDirectories = (process.env.AI_SKILLS_DIRS ?? '')
    .split(delimiter)
    .map((directory) => directory.trim())
    .filter(Boolean);

  const providers: Record<string, ProviderPlaceholder> = {};
  for (const alias of KNOWN_PROVIDERS) {
    providers[alias] = readProviderEnv(alias);
  }

  return Object.freeze({
    port,
    host,
    logLevel: normalizeLogLevel(),
    gatewayUrl,
    corsOrigins,
    skillDirectories,
    providers,
  });
}
