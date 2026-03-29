import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ProviderConfig } from './types.js';
import {
  ProviderError,
  PROVIDER_ERRORS,
  BUILTIN_PROVIDERS,
  DEFAULT_NPM_PACKAGE,
} from './errors.js';
import { createBuiltinProvider } from './built-in.js';
import { loadProviderPackage } from './loader.js';

/** Callable that produces a LanguageModelV3 for a given model ID. */
type ProviderFn = (modelId: string) => LanguageModelV3;

/**
 * Provider Registry — resolves provider keys + model IDs to LanguageModelV3 instances.
 *
 * Resolution order:
 *   1. Cache (previously loaded providers)
 *   2. Built-in providers via `createBuiltinProvider`
 *   3. Dynamic providers via `loadProviderPackage`
 */
export class ProviderRegistry {
  private readonly config: Record<string, ProviderConfig>;
  private readonly cache = new Map<string, ProviderFn>();

  constructor(config: Record<string, ProviderConfig>) {
    this.config = config;
  }

  async resolve(
    providerKey: string,
    modelId: string,
  ): Promise<LanguageModelV3> {
    const providerConfig = this.config[providerKey];
    if (!providerConfig) {
      throw new ProviderError(
        PROVIDER_ERRORS.NOT_FOUND,
        providerKey,
        `Provider '${providerKey}' not found in configuration`,
      );
    }

    const cached = this.cache.get(providerKey);
    if (cached) {
      return cached(modelId);
    }

    const provider = await this.loadProvider(providerKey, providerConfig);
    this.cache.set(providerKey, provider);
    return provider(modelId);
  }

  isAvailable(providerKey: string): boolean {
    return providerKey in this.config;
  }

  listProviders(): string[] {
    return Object.keys(this.config);
  }

  getProviderConfig(providerKey: string): ProviderConfig {
    const cfg = this.config[providerKey];
    if (!cfg) {
      throw new ProviderError(
        PROVIDER_ERRORS.NOT_FOUND,
        providerKey,
        `Provider '${providerKey}' not found`,
      );
    }
    return cfg;
  }

  private async loadProvider(
    providerKey: string,
    providerConfig: ProviderConfig,
  ): Promise<ProviderFn> {
    // Built-in path — factory is resolved internally by createBuiltinProvider
    if (providerKey in BUILTIN_PROVIDERS) {
      return createBuiltinProvider(providerKey, providerConfig) as ProviderFn;
    }

    // Dynamic path — load npm package and treat the module as a provider factory
    const npmPackage = providerConfig.npmPackage ?? DEFAULT_NPM_PACKAGE;
    const factoryModule = await loadProviderPackage(npmPackage);
    const factory = factoryModule as unknown as (
      config: ProviderConfig,
    ) => ProviderFn;
    return factory(providerConfig);
  }
}
