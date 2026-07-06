import type { LanguageModelV3 } from '@ai-sdk/provider';
import { parseProviderModel } from './errors.js';
import type { ProviderRegistry } from './registry.js';

/** Resolved AI models for a session's decision capabilities. */
export interface ResolvedModels {
  decision: LanguageModelV3;
}

/** Session fields used for model resolution. */
interface SessionModelFields {
  provider: string | null;
  model: string | null;
}

/** Config-level defaults for model selectors (e.g., "glm/glm-4.7-flash"). */
interface ConfigDefaults {
  decision: string;
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

/** Resolves the decision model for a session, falling back to config defaults. */
export async function resolveSessionModels(
  session: SessionModelFields,
  registry: ProviderRegistry,
  defaults: ConfigDefaults,
): Promise<ResolvedModels> {
  const decisionStr =
    session.provider && session.model
      ? `${session.provider}/${session.model}`
      : defaults.decision;

  const decision = await resolveModel(decisionStr, registry);

  return { decision };
}
