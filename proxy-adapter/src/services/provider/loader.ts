/**
 * Dynamic npm package installer and module loader for AI providers.
 *
 * Validates package names against @ai-sdk/* namespace,
 * installs packages via pnpm when allowed, and caches
 * dynamically loaded modules for reuse.
 */

import { execa } from 'execa';
import { ProviderError, PROVIDER_ERRORS, PACKAGE_NAME_RE } from './errors.js';

/**
 * Type alias for a loaded provider module factory.
 * Exact shape varies per @ai-sdk/* package.
 */
export type ProviderFactory = unknown;

/** Cache of already loaded provider modules. */
const moduleCache = new Map<string, ProviderFactory>();

/**
 * Validates that a package name matches the allowed @ai-sdk/* pattern.
 *
 * @throws ProviderError if the package name is invalid
 */
function validatePackageName(npmPackage: string): void {
  if (!PACKAGE_NAME_RE.test(npmPackage)) {
    throw new ProviderError(
      PROVIDER_ERRORS.INSTALL_FAILED,
      npmPackage,
      `Invalid package name: "${npmPackage}". Only @ai-sdk/* packages are allowed.`,
    );
  }
}

/**
 * Installs an npm package via pnpm.
 *
 * @param npmPackage - Package to install (e.g., '@ai-sdk/openai')
 * @param options - Installation options
 * @throws ProviderError if dynamic install is disabled, package name is invalid, or install fails
 */
export async function installProviderPackage(
  npmPackage: string,
  options?: { allowDynamicInstall?: boolean },
): Promise<void> {
  validatePackageName(npmPackage);

  if (options?.allowDynamicInstall !== true) {
    throw new ProviderError(
      PROVIDER_ERRORS.INSTALL_FAILED,
      npmPackage,
      'Dynamic install is disabled',
    );
  }

  try {
    await execa('pnpm', ['add', npmPackage]);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown install error';
    throw new ProviderError(
      PROVIDER_ERRORS.INSTALL_FAILED,
      npmPackage,
      `Install failed: ${message}`,
    );
  }
}

/**
 * Dynamically loads an npm package and caches the result.
 * Returns cached module on subsequent calls for the same package.
 *
 * @param npmPackage - Package to load (e.g., '@ai-sdk/openai')
 * @returns The loaded provider factory
 * @throws ProviderError if the module cannot be loaded
 */
export async function loadProviderPackage(
  npmPackage: string,
): Promise<ProviderFactory> {
  const cached = moduleCache.get(npmPackage);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const mod = await import(npmPackage);
    moduleCache.set(npmPackage, mod);
    return mod;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown load error';
    throw new ProviderError(
      PROVIDER_ERRORS.INSTALL_FAILED,
      npmPackage,
      `Failed to load module: ${message}`,
    );
  }
}

/**
 * Clears the module cache. Intended for testing only.
 */
export function clearModuleCache(): void {
  moduleCache.clear();
}
