import type { ProviderConfig } from './types.js';
import { ProviderError, PROVIDER_ERRORS } from './errors.js';
import { BUILTIN_PROVIDERS } from './errors.js';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

type FactoryParams = {
  name: string;
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
};

const BUILTIN_FACTORIES: Record<string, (params: FactoryParams) => unknown> = {
  'createOpenAICompatible': (params) => createOpenAICompatible(params),
} as const;

export function createBuiltinProvider(
  name: string,
  config: ProviderConfig
): unknown {
  const builtin = BUILTIN_PROVIDERS[name as keyof typeof BUILTIN_PROVIDERS];

  if (!builtin) {
    throw new ProviderError(
      PROVIDER_ERRORS.NOT_FOUND,
      name,
      `Built-in provider '${name}' not found. Available: ${Object.keys(BUILTIN_PROVIDERS).join(', ')}`
    );
  }

  const factoryName = builtin.factory as keyof typeof BUILTIN_FACTORIES;
  const factory = BUILTIN_FACTORIES[factoryName];

  if (!factory) {
    throw new ProviderError(
      PROVIDER_ERRORS.INIT_FAILED,
      name,
      `Factory function '${factoryName}' not found in registry`
    );
  }

  const factoryParams = {
    name: name,
    baseURL: config.baseUrl ?? 'https://api.openai.com/v1',
    apiKey: config.apiKey,
    headers: config.headers,
  };

  return factory(factoryParams) as unknown;
}
