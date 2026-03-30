/**
 * Provider Service Public API Barrel
 *
 * Central exports for the AI provider system:
 * - Type definitions for provider configuration and model resolution
 * - Error handling and parsing utilities
 * - Schema validation for provider configuration
 * - Registry for provider resolution and caching
 * - Model resolution for decision and vision models
 * - Alias adapter factories
 * - Dynamic provider package installation and loading
 * - Vision tool for screenshot analysis
 * - Preflight checks for provider availability
 */

// Types
export type {
  ProviderConfig,
  ProviderEntry,
  ModelResolution,
  VisionToolResult,
  ModelConfig,
} from './types.js';

// Errors
export {
  ProviderError,
  PROVIDER_ERRORS,
  BUILTIN_PROVIDERS,
  DEFAULT_NPM_PACKAGE,
  parseProviderModel,
} from './errors.js';

// Schema
export type {
  ProviderSchemaV2Input,
  ProviderSchemaV2Output,
} from './schema.js';
export { ProviderSchemaV2 } from './schema.js';

// Registry
export { ProviderRegistry } from './registry.js';

// Resolver
export type { ResolvedModels } from './resolver.js';
export { resolveModel, resolveSessionModels } from './resolver.js';

// Built-in provider
export { createBuiltinProvider } from './built-in.js';

// Loader
export type { ProviderFactory } from './loader.js';
export {
  installProviderPackage,
  loadProviderPackage,
  clearModuleCache,
} from './loader.js';

// Vision tool
export type {
  VisionToolOptions,
  ScreenshotResult,
} from './vision-tool.js';
export { createVisionTool } from './vision-tool.js';

// Preflight
export { runPreflight } from './preflight.js';

// Adapters
export { createGLMAdapter } from './adapters/glm.js';
