import { Config, ResolvedConfig, Provider, ModelConfig } from './schema.js';

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
  const defaults = options?.defaults || {};

  const resolvedProviders: Record<string, Provider & { apiKey: string }> = {};

  for (const [key, provider] of Object.entries(config.providers)) {
    if (!provider.enabled) {
      continue;
    }

    const apiKeyResult = resolveVariable(provider.apiKey, env, defaults);
    if (!apiKeyResult.success) {
      result.errors.push(`Provider ${key}: ${apiKeyResult.error}`);
      continue;
    }

    const resolvedProvider: Provider & { apiKey: string } = {
      ...provider,
      apiKey: apiKeyResult.value!,
    };

    const resolvedModels: Record<
      string,
      ModelConfig & { resolvedTemperature?: number; resolvedMaxTokens?: number }
    > = {};

    for (const [modelKey, model] of Object.entries(provider.models)) {
      resolvedModels[modelKey] = {
        ...model,
        resolvedTemperature: model.temperature,
        resolvedMaxTokens: model.maxTokens,
      };
    }

    resolvedProvider.models = resolvedModels;
    resolvedProviders[key] = resolvedProvider;
  }

  const resolvedSettings = {
    timeout: resolveSetting(config.settings.timeout, env, defaults, 30000),
    maxRetries: resolveSetting(config.settings.maxRetries, env, defaults, 3),
    temperature: resolveSetting(config.settings.temperature, env, defaults, 0.2),
    maxTokens: resolveSetting(config.settings.maxTokens, env, defaults, 1000),
    maxSteps: resolveSetting(config.settings.maxSteps, env, defaults, 1),
  };

  if (result.errors.length > 0) {
    result.success = false;
  }

  const resolvedConfig: ResolvedConfig = {
    ...config,
    _resolved: {
      providers: resolvedProviders,
      settings: resolvedSettings,
    },
  };

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
  let match;

  while ((match = varPattern.exec(value)) !== null) {
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
): { provider: Provider & { apiKey: string }; model: ModelConfig } | null {
  const provider = config._resolved.providers[providerName];
  if (!provider) {
    return null;
  }

  const model = provider.models[modelName];
  if (!model) {
    return null;
  }

  return { provider, model };
}

export function getDefaultVisionModel(
  config: ResolvedConfig
): { provider: string; model: string } | null {
  if (config.defaults.mode === 'unified') {
    return null;
  }
  return {
    provider: config.defaults.vision.provider,
    model: config.defaults.vision.model,
  };
}

export function getDefaultDecisionModel(
  config: ResolvedConfig
): { provider: string; model: string } | null {
  return {
    provider: config.defaults.decision.provider,
    model: config.defaults.decision.model,
  };
}

export function isUnifiedMode(config: ResolvedConfig): boolean {
  return config.defaults.mode === 'unified';
}
