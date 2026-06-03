/**
 * Provider Registry Type Definitions
 *
 * Framework-agnostic type definitions for AI provider registry.
 * These types define the contract for provider registration and model resolution
 * without importing runtime dependencies from Vercel AI SDK.
 *
 * Wave 2 will connect ProviderInstance to the actual LanguageModelV3 type
 * from @ai-sdk/provider. For now, we use 'unknown' as the type alias.
 */

/**
 * Configuration for a specific AI provider.
 */
export interface ProviderConfig {
  /** NPM package name (optional, for local overrides) */
  npmPackage?: string;

  /** Base URL for the provider API (optional, for testing/local overrides) */
  baseUrl?: string;

  /** API key for the provider */
  apiKey: string;

  /** Additional HTTP headers to send with requests */
  headers?: Record<string, string>;
}

/**
 * A registry entry for an installed provider.
 */
export interface ProviderEntry {
  /** The provider instance (LanguageModelV3 from @ai-sdk/provider) */
  instance: unknown;

  /** NPM package name that provides this provider */
  npmPackage: string;

  /** Whether the provider is installed/enabled in the config */
  installed: boolean;
}

/**
 * A resolved model selection for execution.
 */
export interface ModelResolution {
  /** Provider identifier (e.g., 'glm', 'openai', 'anthropic') */
  provider: string;

  /** Model identifier (e.g., 'glm-4', 'gpt-4', 'claude-3-5-sonnet') */
  model: string;

  /** Resolved provider configuration */
  providerConfig: ProviderConfig;
}

/**
 * Model configuration with decision and vision model selectors.
 */
export interface ModelConfig {
  /** Decision model (action planning) */
  decision: {
    provider: string;
    model: string;
  };

  /** Vision model (screenshot analysis) */
  vision: {
    provider: string;
    model: string;
  };
}
