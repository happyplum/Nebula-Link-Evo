import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ProviderConfig } from './types.js';
import {
  ProviderError,
  PROVIDER_ERRORS,
  normalizeNpmPackage,
  BUILTIN_PROVIDERS,
} from './errors.js';
import { loadProviderPackage } from './loader.js';

/** Callable that produces a LanguageModelV3 for a given model ID. */
type ProviderFn = (modelId: string) => LanguageModelV3;

/**
 * Reverse mapping from npm package names to factory function names.
 * Built from BUILTIN_PROVIDERS for fast lookup of known providers.
 */
const KNOWN_FACTORIES: Record<string, string> = {};
for (const entry of Object.values(BUILTIN_PROVIDERS)) {
  KNOWN_FACTORIES[entry.npmPackage] = entry.factory;
}

/**
 * Derives the expected factory export name from an @ai-sdk/* package name.
 * Best-effort fallback for packages not in KNOWN_FACTORIES.
 * e.g. `@ai-sdk/google` → `createGoogle`
 *
 * Note: Does not handle multi-letter acronyms (e.g. "AI").
 * Use `resolveFactoryName()` which checks KNOWN_FACTORIES first.
 */
function deriveFactoryName(npmPackage: string): string {
  const name = npmPackage.replace(/^@ai-sdk\//, '');
  return (
    'create' +
    name
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('')
  );
}

/**
 * Resolves the factory name for an npm package.
 * Checks KNOWN_FACTORIES (from BUILTIN_PROVIDERS) first, then falls back
 * to deriveFactoryName() for unknown packages.
 *
 * @param npmPackage - The npm package name (e.g., '@ai-sdk/openai-compatible')
 * @returns The expected factory function name (e.g., 'createOpenAICompatible')
 */
function resolveFactoryName(npmPackage: string): string {
  const knownFactory = KNOWN_FACTORIES[npmPackage];
  if (knownFactory) {
    return knownFactory;
  }
  return deriveFactoryName(npmPackage);
}

/**
 * Provider Registry — resolves provider keys + model IDs to LanguageModelV3 instances.
 *
 * Resolution order:
 *   1. Cache (previously loaded providers)
 *   2. Dynamic load via normalized package + named factory discovery
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
    const npmPackage = normalizeNpmPackage(providerConfig.npmPackage);
    const factoryName = resolveFactoryName(npmPackage);
    const moduleNs = await loadProviderPackage(npmPackage);

    const factory = (moduleNs as Record<string, unknown>)[factoryName];
    if (typeof factory !== 'function') {
      throw new ProviderError(
        PROVIDER_ERRORS.INIT_FAILED,
        providerKey,
        `Package '${npmPackage}' does not export '${factoryName}'`,
      );
    }

    const provider = (factory as (config: ProviderConfig) => unknown)(
      providerConfig,
    );
    if (typeof provider !== 'function') {
      throw new ProviderError(
        PROVIDER_ERRORS.INIT_FAILED,
        providerKey,
        `Factory '${factoryName}' from '${npmPackage}' did not return a provider function`,
      );
    }

    return provider as ProviderFn;
  }
}
