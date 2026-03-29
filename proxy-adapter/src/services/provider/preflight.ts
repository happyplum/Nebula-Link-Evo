import type { ProviderRegistry } from './registry.js';

/**
 * Runs startup provider preflight check to validate configured providers are available.
 *
 * @param registry - ProviderRegistry instance with isAvailable() method
 * @param providerKeys - Array of provider keys to check availability for
 * @throws Error if all providers are unavailable with message containing "no providers available"
 *
 * Behavior:
 * - ALL available: No warnings, no errors
 * - SOME unavailable: Logs warning for each unavailable provider, does NOT throw
 * - ALL unavailable: Throws Error("No providers available. Server cannot start.")
 */
export function runPreflight(
  registry: ProviderRegistry,
  providerKeys: string[],
): void {
  const unavailableProviders: string[] = [];

  for (const key of providerKeys) {
    if (!registry.isAvailable(key)) {
      unavailableProviders.push(key);
    }
  }

  // If no providers are available, throw error
  if (unavailableProviders.length === providerKeys.length) {
    throw new Error('No providers available. Server cannot start.');
  }

  // If some providers are unavailable, log warnings
  for (const key of unavailableProviders) {
    console.warn(`Provider "${key}" is not available`);
  }
}
