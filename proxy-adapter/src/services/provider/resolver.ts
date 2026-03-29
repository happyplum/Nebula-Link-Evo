import type { LanguageModelV3 } from '@ai-sdk/provider';
import { parseProviderModel } from './errors.js';
import type { ProviderRegistry } from './registry.js';

/** Resolved AI models for a session's decision and vision capabilities. */
export interface ResolvedModels {
  decision: LanguageModelV3;
  vision: LanguageModelV3;
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
 * Resolves a "provider/model" string to a concrete LanguageModelV3
 * by parsing the provider key and delegating to the registry.
 */
export async function resolveModel(
  providerModel: string,
  registry: ProviderRegistry,
): Promise<LanguageModelV3> {
  const { provider, model } = parseProviderModel(providerModel);
  return registry.resolve(provider, model);
}

/**
 * Resolves both decision and vision models for a session.
 * Falls back to config defaults when session fields are null.
 */
export async function resolveSessionModels(
  session: SessionModelFields,
  registry: ProviderRegistry,
  defaults: ConfigDefaults,
): Promise<ResolvedModels> {
  const decisionStr =
    session.provider && session.model
      ? `${session.provider}/${session.model}`
      : defaults.decision;

  const visionStr =
    session.vision_provider && session.vision_model
      ? `${session.vision_provider}/${session.vision_model}`
      : defaults.vision;

  const [decision, vision] = await Promise.all([
    resolveModel(decisionStr, registry),
    resolveModel(visionStr, registry),
  ]);

  return { decision, vision };
}
