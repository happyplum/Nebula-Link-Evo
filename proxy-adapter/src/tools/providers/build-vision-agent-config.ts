import type { ResolvedConfig } from '../../config/schema.js';
import type { VisionConfigOverride } from '../../mcps/vision-agent/config.js';

/**
 * Build a configOverride for VisionAgentProvider from the resolved config.
 * Maps config.defaults.vision → providerBaseUrl, apiKey, modelId + settings.
 */
export function buildVisionAgentConfig(
  config: ResolvedConfig,
): VisionConfigOverride | undefined {
  const visionSelector = config.defaults.vision;
  if (!visionSelector?.provider || !visionSelector?.model) {
    return undefined;
  }

  const provider = config.providers[visionSelector.provider];
  if (!provider?.enabled || !provider?.baseUrl || !provider?.apiKey) {
    return undefined;
  }

  return {
    providerBaseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    modelId: visionSelector.model,
    maxTokens: config.settings.maxTokens,
    temperature: config.settings.temperature,
    timeoutMs: config.settings.timeout,
    maxRetries: config.settings.maxRetries,
  };
}
