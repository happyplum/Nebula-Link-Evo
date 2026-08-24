import { Config, ResolvedConfig, ResolvedProvider, ModelSelector } from './schema.js';
import { normalizeNpmPackage } from '../services/provider/errors.js';

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

  // Pre-parse defaults to determine which providers are decision-critical
  const decisionSelector = parseProviderModelString(config.defaults.decision, 'decision', result);
  const visionSelector = config.defaults.vision
    ? parseProviderModelString(config.defaults.vision, 'vision', result)
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

    const apiKeyResult = resolveVariable(provider.apiKey, env, defaults);
    if (!apiKeyResult.success || apiKeyResult.value === undefined) {
      result.errors.push(`Provider ${key}: ${apiKeyResult.error}`);
      continue;
    }

    const resolvedProvider: ResolvedProvider = {
      ...provider,
      apiKey: apiKeyResult.value,
      models: provider.models ?? {},
    };

    resolvedProvider.npmPackage = normalizeNpmPackage(resolvedProvider.npmPackage);

    resolvedProviders[key] = resolvedProvider;
  }

  const resolvedSettings = {
    timeout: resolveSetting(config.settings.timeout, env, defaults),
    maxRetries: resolveSetting(config.settings.maxRetries, env, defaults),
    temperature: resolveSetting(config.settings.temperature, env, defaults),
    maxTokens: resolveSetting(config.settings.maxTokens, env, defaults),
    maxSteps: resolveSetting(config.settings.maxSteps, env, defaults),
    contextWindowTokens: resolveSetting(
      config.settings.contextWindowTokens ?? 131072,
      env,
      defaults
    ),
  };

  const resolvedConfig: ResolvedConfig = {
    ...config,
    defaults: {
      mode: config.defaults.mode,
      decision: decisionSelector,
      ...(visionSelector ? { vision: visionSelector } : {}),
    },
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
  defaults: Record<string, string>
): number {
  if (typeof value === 'number') {
    return value;
  }

  const result = resolveVariable(value, env, defaults);
  if (!result.success || result.value === undefined) {
    throw new Error(result.error ?? 'Configuration setting could not be resolved');
  }
  const parsed = Number(result.value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `Configuration setting must resolve to a finite number, received ${result.value}`
    );
  }
  return parsed;
}

function parseProviderModelString(
  value: string,
  key: 'decision' | 'vision',
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
