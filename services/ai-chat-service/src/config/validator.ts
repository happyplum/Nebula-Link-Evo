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

    validateDefaultModel(config, config.defaults.decision, 'decision', errors);
    if (config.defaults.vision) {
      validateDefaultModel(config, config.defaults.vision, 'vision', errors);
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

function validateDefaultModel(
  config: ResolvedConfig,
  selector: { provider: string; model: string },
  capability: 'vision' | 'decision',
  errors: string[]
): void {
  const provider = config.providers[selector.provider];
  if (!provider) {
    errors.push(`Default ${capability} provider ${selector.provider} was not found`);
    return;
  }
  if (!provider.enabled) {
    errors.push(`Default ${capability} provider ${selector.provider} is disabled`);
    return;
  }
  const declared = provider.models[selector.model];
  if (Object.keys(provider.models).length > 0 && !declared) {
    errors.push(
      `Default ${capability} model ${selector.model} was not declared by ${selector.provider}`
    );
  } else if (declared && !declared.capabilities.includes(capability)) {
    errors.push(`Default ${capability} model ${selector.model} lacks the ${capability} capability`);
  }
}
