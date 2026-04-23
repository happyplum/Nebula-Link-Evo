import type { LanguageModelV3, LanguageModelV3StreamResult } from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import type { ProviderRegistry } from '../../services/provider/registry.js';
import { resolveSessionModels, type ResolvedModels } from '../../services/provider/resolver.js';
import { ProviderError, PROVIDER_ERRORS } from '../../services/provider/errors.js';

/**
 * Get a language model instance for the specified provider and model.
 * Delegates resolution to ProviderRegistry.
 */
export async function getModel(
  registry: ProviderRegistry,
  provider: string,
  model: string,
): Promise<LanguageModelV3> {
  // Test-only mock provider — bypass registry resolution
  if (provider === 'test-provider') {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('test-provider is only available in test environment');
    }
    return new MockLanguageModelV3({
      doStream: async () => {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-delta', textDelta: 'Hello' },
              { type: 'text-delta', textDelta: ' ' },
              { type: 'text-delta', textDelta: 'world' },
              { type: 'text-delta', textDelta: '!' },
              {
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage: {
                  promptTokens: 10,
                  completionTokens: 4,
                },
              },
            ],
          }),
        } as unknown as LanguageModelV3StreamResult;
      },
    }) as unknown as LanguageModelV3;
  }

  return registry.resolve(provider, model);
}

/** Session fields used for model resolution. */
interface SessionModelFields {
  provider: string | null;
  model: string | null;
  vision_provider: string | null;
  vision_model: string | null;
}

/** Config-level defaults for model selectors (e.g., "glm/glm-4.7-flash"). */
interface ConfigDefaults {
  decision: string;
  vision: string;
}

/**
 * Resolve the decision model for a session using the provider registry.
 */
export async function getDecisionModel(
  session: SessionModelFields,
  registry: ProviderRegistry,
  defaults: ConfigDefaults,
): Promise<LanguageModelV3> {
  const { decision } = await resolveSessionModels(session, registry, defaults);
  return decision;
}

/**
 * Resolve the vision model for a session using the provider registry.
 */
export async function getVisionModel(
  session: SessionModelFields,
  registry: ProviderRegistry,
  defaults: ConfigDefaults,
): Promise<LanguageModelV3> {
  const { vision } = await resolveSessionModels(session, registry, defaults);
  return vision;
}

/**
 * Create a model client wrapper with lazy initialization.
 */
export function createModelClient(
  registry: ProviderRegistry,
  provider: string,
  model: string,
) {
  return {
    getModel: () => getModel(registry, provider, model),
    provider,
    model,
  };
}
