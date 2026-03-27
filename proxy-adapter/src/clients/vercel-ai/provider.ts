import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { getProviderModel } from '../../config/resolver.js';
import type { ResolvedConfig } from '../../config/schema.js';

/**
 * Get a language model instance for the specified provider and model.
 * Integrates with the project's config system to retrieve API keys and base URLs.
 */
export function getModel(
  config: ResolvedConfig,
  provider: string,
  model: string
): LanguageModelV3 {
  const resolved = getProviderModel(config, provider, model);

  if (!resolved) {
    throw new Error(
      `Provider '${provider}' or model '${model}' not found in configuration`
    );
  }

  const { provider: providerConfig } = resolved;

  switch (provider) {
    case 'kimi': {
      const kimi = createOpenAICompatible({
        name: 'kimi',
        baseURL: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
      });
      return kimi.languageModel(model);
    }

    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseUrl,
      });
      return anthropic.chat(model);
    }

    case 'openai': {
      const openai = createOpenAICompatible({
        name: 'openai',
        baseURL: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
      });
      return openai.languageModel(model);
    }

    case 'nvidia': {
      const nvidia = createOpenAICompatible({
        name: 'nvidia',
        baseURL: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
      });
      return nvidia.languageModel(model);
    }

    case 'glm': {
      const glm = createOpenAICompatible({
        name: 'glm',
        baseURL: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
      });
      return glm.languageModel(model);
    }

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Create a model client wrapper with lazy initialization.
 */
export function createModelClient(
  config: ResolvedConfig,
  provider: string,
  model: string
) {
  return {
    getModel: () => getModel(config, provider, model),
    provider,
    model,
  };
}