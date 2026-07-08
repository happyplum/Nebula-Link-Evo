import {
  Config,
  ResolvedConfig,
  ResolvedProvider,
  ModelConfig,
  ModelSelector,
} from './schema.js';

export interface ResolverOptions {
  env?: Record<string, string>;
  defaults?: Record<string, string>;
}

export interface ResolveResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

export function resolveConfig(
  config: Config,
  options?: ResolverOptions
): { config: ResolvedConfig; result: ResolveResult } {
  const result: ResolveResult = {
    success: true,
    errors: [],
    warnings: [],
  };

  const envInput = options?.env || process.env;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envInput)) {
    env[key] = value || '';
  }
  const resolverDefaults = options?.defaults || {};

  // defaults is optional — proxy-adapter no longer makes AI calls, so missing
  // decision config is a non-fatal warning rather than a hard error.
  const decisionSelector = config.defaults?.decision
    ? parseProviderModelString(config.defaults.decision, 'decision', result)
    : null;

  const resolvedProviders: Record<string, ResolvedProvider> = {};

  for (const [key, provider] of Object.entries(config.providers)) {
    if (!provider.enabled) {
      resolvedProviders[key] = {
        ...provider,
        apiKey: provider.apiKey || '',
        models: provider.models ?? {},
      };
      continue;
    }

    const apiKeyResult = resolveVariable(provider.apiKey, env, {});
    if (!apiKeyResult.success) {
      // All apiKey failures are non-fatal warnings — proxy-adapter does not make AI calls
      result.warnings.push(`Provider ${key}: ${apiKeyResult.error}`);
      continue;
    }

    const resolvedProvider: ResolvedProvider = {
      ...provider,
      apiKey: apiKeyResult.value!,
      models: provider.models ?? {},
    };

    resolvedProvider.npmPackage = normalizeNpmPackage(resolvedProvider.npmPackage);

    resolvedProviders[key] = resolvedProvider;
  }

  const resolvedSettings = {
    timeout: resolveSetting(config.settings.timeout, env, resolverDefaults, 30000),
    maxRetries: resolveSetting(config.settings.maxRetries, env, resolverDefaults, 3),
    temperature: resolveSetting(config.settings.temperature, env, resolverDefaults, 0.2),
    maxTokens: resolveSetting(config.settings.maxTokens, env, resolverDefaults, 1000),
    maxSteps: resolveSetting(config.settings.maxSteps, env, resolverDefaults, 1),
    contextWindowTokens: resolveSetting(config.settings.contextWindowTokens ?? 131072, env, resolverDefaults, 131072),
  };

  const resolvedConfig: ResolvedConfig = {
    ...config,
    defaults: decisionSelector
      ? {
          mode: config.defaults?.mode ?? 'unified',
          decision: decisionSelector,
        }
      : undefined,
    settings: resolvedSettings,
    providers: resolvedProviders,
  };

  if (result.errors.length > 0) {
    result.success = false;
  }

  return { config: resolvedConfig, result };
}

interface VariableResult {
  success: boolean;
  value?: string;
  error?: string;
}

function resolveVariable(
  value: string,
  env: Record<string, string>,
  _defaults: Record<string, string>
): VariableResult {
  const varPattern = /\{([^}:]+)(?::([^}]*))?\}/g;
  let hasMatch = false;
  let result = value;
  let match: RegExpExecArray | null;

  match = varPattern.exec(value);
  while (match !== null) {
    hasMatch = true;
    const varName = match[1];
    const defaultValue = match[2] !== undefined ? match[2] : undefined;
    const envValue = env[varName];

    if (envValue !== undefined && envValue !== '') {
      result = result.replace(match[0], envValue);
    } else if (defaultValue !== undefined) {
      result = result.replace(match[0], defaultValue);
    } else {
      return {
        success: false,
        error: `Required environment variable ${varName} is not set`,
      };
    }

    match = varPattern.exec(value);
  }

  if (!hasMatch) {
    return { success: true, value: value };
  }

  return { success: true, value: result };
}

function resolveSetting(
  value: number | string,
  env: Record<string, string>,
  defaults: Record<string, string>,
  fallback: number
): number {
  if (typeof value === 'number') {
    return value;
  }

  const result = resolveVariable(value, env, defaults);
  if (result.success && result.value !== undefined) {
    const parsed = parseInt(result.value, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

export function getProviderModel(
  config: ResolvedConfig,
  providerName: string,
  modelName: string
): { provider: ResolvedProvider; model: ModelConfig } | null {
  const provider = config.providers[providerName];
  if (!provider) {
    return null;
  }

  const model: ModelConfig = {
    type: 'multimodal',
    capabilities: ['vision', 'decision'],
  };

  return { provider, model: provider.models[modelName] || model };
}

export function getDefaultDecisionModel(
  config: ResolvedConfig
): { provider: string; model: string } | null {
  return config.defaults?.decision ?? null;
}

export function isUnifiedMode(_config: ResolvedConfig): boolean {
  // Unified mode is the only supported mode since vision-mcp-server removal.
  // Kept as explicit function for downstream consumers that may need mode checks.
  return true;
}

function parseProviderModelString(
  value: string,
  key: 'decision',
  result: ResolveResult
): ModelSelector {
  const slashIndex = value.indexOf('/');
  const provider = slashIndex > 0 ? value.slice(0, slashIndex).trim() : '';
  const model = slashIndex > 0 ? value.slice(slashIndex + 1).trim() : '';

  if (!provider || !model) {
    result.errors.push(`defaults.${key} must use "provider/model" format`);
    return { provider: '', model: '' };
  }

  return { provider, model };
}

const DEFAULT_NPM_PACKAGE = '@ai-sdk/openai-compatible';
const PACKAGE_NAME_RE = /^@ai-sdk\/[a-z0-9-]+$/;

function normalizeNpmPackage(raw?: string | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return DEFAULT_NPM_PACKAGE;
  }

  const packageName = trimmed.startsWith('@') ? trimmed : `@ai-sdk/${trimmed}`;
  if (!PACKAGE_NAME_RE.test(packageName)) {
    throw new Error(`Invalid provider npmPackage: ${trimmed}`);
  }
  return packageName;
}
