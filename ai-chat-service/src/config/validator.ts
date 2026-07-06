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

  // --- Provider checks ---
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
  }

  if (config.mcp?.enabled) {
    for (const [name, server] of Object.entries(config.mcp.servers)) {
      if (!server.enabled) continue;

      if (!server.command && !server.url) {
        errors.push(`MCP server ${name}: missing command or url`);
      }

      if (server.command && (!server.args || server.args.length === 0)) {
        warnings.push(`MCP server ${name}: no args specified`);
      }
    }

    if (config.mcp.reconnect) {
      const r = config.mcp.reconnect;
      if (r.maxAttempts !== undefined && r.maxAttempts < 0) {
        errors.push('mcp.reconnect.maxAttempts must be >= 0');
      }
      if (r.baseDelayMs !== undefined && r.baseDelayMs < 0) {
        errors.push('mcp.reconnect.baseDelayMs must be >= 0');
      }
      if (r.maxDelayMs !== undefined && r.maxDelayMs < 0) {
        errors.push('mcp.reconnect.maxDelayMs must be >= 0');
      }
      if (r.jitterMs !== undefined && r.jitterMs < 0) {
        errors.push('mcp.reconnect.jitterMs must be >= 0');
      }
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
