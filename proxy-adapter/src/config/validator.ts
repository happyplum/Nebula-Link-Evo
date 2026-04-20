import type { ResolvedConfig, ModelConfig } from './schema.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Internal helper for centralized resolved-model access
function getResolvedModels(
  config: ResolvedConfig,
  provider: string
): Record<string, ModelConfig> | undefined {
  return config.providers[provider]?.models;
}

export function validateConfig(config: ResolvedConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Declaration-layer checks ---
  const enabledProviders = Object.entries(config.providers).filter(([_, p]) => p.enabled);

  if (enabledProviders.length === 0) {
    warnings.push('No providers enabled');
  }

  for (const [name, provider] of Object.entries(config.providers)) {
    if (!provider.enabled) continue;

    if (!provider.apiKey) {
      errors.push(`Provider ${name}: missing apiKey`);
    }

    if (!provider.baseUrl) {
      errors.push(`Provider ${name}: missing baseUrl`);
    }
  }

  if (!config.defaults) {
    errors.push('Missing defaults configuration');
  } else {
    const mode = config.defaults.mode;

    if (mode === 'separation') {
      if (!config.defaults.vision?.provider) {
        errors.push('Separation mode requires vision.provider');
      }
      if (!config.defaults.vision?.model) {
        errors.push('Separation mode requires vision.model');
      }
      if (!config.defaults.decision?.provider) {
        errors.push('Separation mode requires decision.provider');
      }
      if (!config.defaults.decision?.model) {
        errors.push('Separation mode requires decision.model');
      }

      const visionProvider = config.providers[config.defaults.vision.provider];
      if (visionProvider && !visionProvider.enabled) {
        warnings.push(`Default vision provider ${config.defaults.vision.provider} is disabled`);
      }

      const decisionProvider = config.providers[config.defaults.decision.provider];
      if (decisionProvider && !decisionProvider.enabled) {
        warnings.push(`Default decision provider ${config.defaults.decision.provider} is disabled`);
      }
    } else if (mode === 'unified') {
      if (!config.defaults.decision?.provider) {
        errors.push('Unified mode requires decision.provider');
      }
      if (!config.defaults.decision?.model) {
        errors.push('Unified mode requires decision.model');
      }

      const decisionProvider = config.providers[config.defaults.decision.provider];
      if (decisionProvider && !decisionProvider.enabled) {
        warnings.push(`Default decision provider ${config.defaults.decision.provider} is disabled`);
      }
    } else {
      errors.push(`Unknown mode: ${mode}`);
    }
  }

  if (config.mcp?.enabled) {
    for (const [name, server] of Object.entries(config.mcp.servers)) {
      if (!server.enabled) continue;

      if (!server.command) {
        errors.push(`MCP server ${name}: missing command`);
      }

      if (!server.args || server.args.length === 0) {
        warnings.push(`MCP server ${name}: no args specified`);
      }
    }
  }

  // --- Runtime resolved-key checks ---
  for (const [name, provider] of Object.entries(config.providers)) {
    if (!provider.enabled) continue;
    if (!provider.apiKey) {
      errors.push(`Provider ${name}: apiKey not resolved`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateProviderModel(
  config: ResolvedConfig,
  provider: string,
  model: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // --- Declaration-layer checks ---
  const providerConfig = config.providers[provider];
  if (!providerConfig) {
    errors.push(`Provider ${provider} not found`);
    return { valid: false, errors };
  }

  if (!providerConfig.enabled) {
    errors.push(`Provider ${provider} is disabled`);
  }

  // --- Resolved-layer checks ---
  if (!model || model.trim().length === 0) {
    errors.push(`Model ${model} not found in provider ${provider}`);
  } else {
    const resolvedModels = getResolvedModels(config, provider);
    if (resolvedModels && Object.keys(resolvedModels).length > 0 && !resolvedModels[model]) {
      errors.push(`Model ${model} not found in provider ${provider}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function canProviderDo(
  provider: string,
  model: string,
  capability: 'vision' | 'decision',
  config: ResolvedConfig
): boolean {
  // --- Declaration-layer checks ---
  const providerConfig = config.providers[provider];
  if (!providerConfig || !providerConfig.enabled) {
    return false;
  }

  if (!model || model.trim().length === 0) {
    return false;
  }

  // --- Resolved-layer checks ---
  const resolvedModels = getResolvedModels(config, provider);
  if (resolvedModels && Object.keys(resolvedModels).length > 0) {
    const modelConfig = resolvedModels[model];
    if (!modelConfig) {
      return false;
    }

    // Check capability support if model declares capabilities
    if (modelConfig.capabilities && modelConfig.capabilities.length > 0) {
      return modelConfig.capabilities.includes(capability);
    }
  }

  return capability === 'vision' || capability === 'decision';
}
