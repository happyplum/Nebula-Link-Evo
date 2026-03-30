import type { ProviderRegistry } from './registry.js';

/**
 * Runs startup provider preflight check by probing each enabled provider
 * through real load (normalization, importability, factory discovery, initialization).
 *
 * @param registry - ProviderRegistry instance with probeProvider() and isAvailable() methods
 * @param providerKeys - Array of provider keys to probe
 * @throws Error if zero providers are available after probing
 *
 * Behavior:
 * - Probes each provider via registry.probeProvider() which attempts real load
 * - ALL available: No warnings, no errors
 * - SOME unavailable: Logs warning with provider-specific error for each, does NOT throw
 * - ALL unavailable: Throws Error("No providers available. Server cannot start.")
 */
export async function runPreflight(
  registry: ProviderRegistry,
  providerKeys: string[],
): Promise<void> {
  // Probe all enabled providers (errors recorded internally, not thrown)
  for (const key of providerKeys) {
    await registry.probeProvider(key);
  }

  // Collect unavailable providers after probing
  const unavailableProviders: string[] = [];
  for (const key of providerKeys) {
    if (!registry.isAvailable(key)) {
      unavailableProviders.push(key);
    }
  }

  // Zero available → fatal
  if (unavailableProviders.length === providerKeys.length) {
    throw new Error('No providers available. Server cannot start.');
  }

  // Partial — warn per provider with error detail
  for (const key of unavailableProviders) {
    const error = registry.getAvailabilityError(key) ?? 'unknown error';
    console.warn(`Provider "${key}" is not available: ${error}`);
  }
}
