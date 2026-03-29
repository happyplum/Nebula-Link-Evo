/**
 * Represents an error specific to AI provider operations.
 *
 * Error Codes:
 * - NOT_FOUND: Provider or model not found in configuration
 * - INSTALL_FAILED: Failed to install provider package
 * - INIT_FAILED: Failed to initialize provider client
 * - CONFIG_INVALID: Provider configuration is invalid
 * - VISION_UNAVAILABLE: Vision capability not available
 * - RATE_LIMITED: Provider rate limit exceeded
 */

export class ProviderError extends Error {
  code: string;
  provider: string;
  details?: unknown;

  constructor(code: string, provider: string, details?: unknown) {
    super('Provider Error');
    this.code = code;
    this.provider = provider;
    this.details = details;
  }
}

/**
 * Standardized error codes for provider operations.
 */
export const PROVIDER_ERRORS = {
  NOT_FOUND: 'PROVIDER_NOT_FOUND',
  INSTALL_FAILED: 'PROVIDER_INSTALL_FAILED',
  INIT_FAILED: 'PROVIDER_INIT_FAILED',
  CONFIG_INVALID: 'PROVIDER_CONFIG_INVALID',
  VISION_UNAVAILABLE: 'VISION_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

/**
 * Configuration for known built-in providers.
 * Maps provider keys to their npm package and factory function names.
 */
export const BUILTIN_PROVIDERS = {
  'openai-compatible': {
    npmPackage: '@ai-sdk/openai-compatible',
    factory: 'createOpenAICompatible',
  },

} as const;

/**
 * Default npm package for generic provider implementations.
 */
export const DEFAULT_NPM_PACKAGE = '@ai-sdk/openai-compatible';

/**
 * Separator used in provider model strings (e.g., "provider/model").
 */
export const PROVIDER_MODEL_SEPARATOR = '/';

/**
 * Parses a provider model string into structured provider and model components.
 *
 * @param input - String in format "provider/model" or "provider/model/variant"
 * @returns Object with provider and model properties
 * @throws ProviderError if the input format is invalid
 */
export function parseProviderModel(input: string): { provider: string; model: string } {
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    throw new ProviderError(
      PROVIDER_ERRORS.CONFIG_INVALID,
      'unknown',
      'Provider model string cannot be empty'
    );
  }

  const trimmed = input.trim();

  // Check for required separator
  if (!trimmed.includes(PROVIDER_MODEL_SEPARATOR)) {
    throw new ProviderError(
      PROVIDER_ERRORS.CONFIG_INVALID,
      'unknown',
      'Provider model string must contain a "/" separator'
    );
  }

  // Split on the first separator only
  const parts = trimmed.split(PROVIDER_MODEL_SEPARATOR, 2);

  if (parts.length < 2) {
    // This should theoretically be caught by the separator check above,
    // but we keep it as a safety check for multiple slashes handling.
    throw new ProviderError(
      PROVIDER_ERRORS.CONFIG_INVALID,
      'unknown',
      'Provider model string is invalid'
    );
  }

  const [provider, model] = parts;

  if (!provider || typeof provider !== 'string' || provider.trim().length === 0) {
    throw new ProviderError(
      PROVIDER_ERRORS.CONFIG_INVALID,
      'unknown',
      'Provider name is invalid'
    );
  }

  if (!model || typeof model !== 'string' || model.trim().length === 0) {
    throw new ProviderError(
      PROVIDER_ERRORS.CONFIG_INVALID,
      'unknown',
      'Model name is invalid'
    );
  }

  // Normalize: provider/model/variant -> provider/model (ignore variant part for parsing)
  // Example: "openai/gpt-4o/variant" -> { provider: "openai", model: "gpt-4o/variant" }
  // However, the requirement says "glm/glm-4.7-flash" -> { provider: "glm", model: "glm-4.7-flash" }
  // and "openai/gpt-4o" -> { provider: "openai", model: "gpt-4o" }
  // The requirement says: multiple `/` -> first split only.
  // This implies we ignore extra slashes or variants.
  // Example: "openai/gpt-4o/variant" -> { provider: "openai", model: "gpt-4o/variant" }
  // This logic handles the "first split only" requirement via `split(separator, 2)`.

  return { provider: provider.trim(), model: model.trim() };
}
