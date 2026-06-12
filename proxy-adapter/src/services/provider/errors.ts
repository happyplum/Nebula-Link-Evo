/**
 * Union type of all provider error codes.
 */
export type ProviderErrorCode = typeof PROVIDER_ERRORS[keyof typeof PROVIDER_ERRORS];

/**
 * Represents an error specific to AI provider operations.
 *
 * Error taxonomy (three distinct failure categories):
 *
 * **CONFIG_INVALID** — Bad configuration supplied at load time.
 *   Triggers: malformed package names, missing required fields,
 *   invalid provider/model strings. Caught before any I/O occurs.
 *
 * **INSTALL_FAILED** — Package import resolution failed at runtime.
 *   Triggers: dynamic `import()` of the npm package rejected
 *   (module not found, export missing, top-level throw).
 *
 * **INIT_FAILED** — Package loaded but factory unusable.
 *   Triggers: expected factory function not exported, factory
 *   threw during invocation, or returned client is null/undefined.
 *
 * Other codes:
 * - NOT_FOUND: Provider or model not found in configuration
 * - RATE_LIMITED: Provider rate limit exceeded
 */

export class ProviderError extends Error {
  code: ProviderErrorCode;
  provider: string;
  details?: unknown;

  constructor(code: ProviderErrorCode, provider: string, details?: unknown, message?: string) {
    super(message ?? 'Provider Error');
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
  'openai': {
    npmPackage: '@ai-sdk/openai',
    factory: 'createOpenAI',
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

  // Split on first '/' only: everything after it is the model (including further '/' segments)
  const slashIndex = trimmed.indexOf(PROVIDER_MODEL_SEPARATOR);

  const provider = slashIndex > 0 ? trimmed.slice(0, slashIndex).trim() : '';
  const model = slashIndex > 0 ? trimmed.slice(slashIndex + 1).trim() : '';

  if (!provider) {
    throw new ProviderError(
      PROVIDER_ERRORS.CONFIG_INVALID,
      'unknown',
      'Provider name is invalid'
    );
  }

  if (!model) {
    throw new ProviderError(
      PROVIDER_ERRORS.CONFIG_INVALID,
      'unknown',
      'Model name is invalid'
    );
  }

  return { provider, model };
}
