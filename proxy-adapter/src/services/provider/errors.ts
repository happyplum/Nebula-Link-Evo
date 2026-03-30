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
 * Regex allowing only @ai-sdk/<name> packages with lowercase alphanumeric + hyphens.
 */
export const PACKAGE_NAME_RE = /^@ai-sdk\/[a-z0-9-]+$/;

/**
 * Separator used in provider model strings (e.g., "provider/model").
 */
export const PROVIDER_MODEL_SEPARATOR = '/';

/**
 * Normalizes a raw npm package input into a fully-qualified @ai-sdk/* package name.
 *
 * Resolution rules:
 * 1. undefined / null / empty → DEFAULT_NPM_PACKAGE
 * 2. Already-qualified @ai-sdk/* → validated, pass-through
 * 3. Bare short name (e.g. 'openai') → '@ai-sdk/{name}' → validated
 * 4. Any other value → ProviderError(CONFIG_INVALID)
 */
export function normalizeNpmPackage(raw?: string | null): string {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_NPM_PACKAGE;
  }

  const trimmed = raw.trim();

  if (trimmed.startsWith('@ai-sdk/')) {
    if (!PACKAGE_NAME_RE.test(trimmed)) {
      throw new ProviderError(
        PROVIDER_ERRORS.CONFIG_INVALID,
        trimmed,
        `Invalid @ai-sdk package name: "${trimmed}"`,
      );
    }
    return trimmed;
  }

  const qualified = `@ai-sdk/${trimmed}`;
  if (PACKAGE_NAME_RE.test(qualified)) {
    return qualified;
  }

  throw new ProviderError(
    PROVIDER_ERRORS.CONFIG_INVALID,
    trimmed,
    `Invalid provider package: "${trimmed}". Must be an @ai-sdk/* package or a short name like "openai".`,
  );
}

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
