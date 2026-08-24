import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from './schema.js';
import { validateConfig } from './validator.js';

function config(): ResolvedConfig {
  return {
    version: '2.0',
    providers: {
      decision: {
        enabled: true,
        apiKey: 'secret-in-memory',
        baseUrl: 'http://127.0.0.1:9000',
        models: {
          model: { type: 'decision', capabilities: ['decision'] },
        },
      },
      vision: {
        enabled: true,
        apiKey: 'secret-in-memory',
        baseUrl: 'http://127.0.0.1:9001',
        models: {
          model: { type: 'vision', capabilities: ['vision'] },
        },
      },
    },
    defaults: {
      mode: 'unified',
      decision: { provider: 'decision', model: 'model' },
      vision: { provider: 'vision', model: 'model' },
    },
    mcp: { enabled: true, servers: {} },
    settings: {
      timeout: 30_000,
      maxRetries: 3,
      temperature: 0.2,
      maxTokens: 1_000,
      maxSteps: 3,
      contextWindowTokens: 128_000,
    },
  };
}

describe('validateConfig', () => {
  it('accepts explicitly capable default model routes', () => {
    expect(validateConfig(config())).toMatchObject({ valid: true, errors: [] });
  });

  it('fails closed for missing, disabled, undeclared, or incapable default routes', () => {
    const missing = config();
    missing.defaults.decision.provider = 'missing';
    expect(validateConfig(missing).errors).toContain(
      'Default decision provider missing was not found'
    );

    const disabled = config();
    const disabledVision = disabled.providers.vision;
    if (!disabledVision) throw new Error('vision fixture is missing');
    disabledVision.enabled = false;
    expect(validateConfig(disabled).errors).toContain('Default vision provider vision is disabled');

    const undeclared = config();
    undeclared.defaults.decision.model = 'other';
    expect(validateConfig(undeclared).errors).toContain(
      'Default decision model other was not declared by decision'
    );

    const incapable = config();
    const incapableVisionModel = incapable.providers.vision?.models.model;
    if (!incapableVisionModel) throw new Error('vision model fixture is missing');
    incapableVisionModel.capabilities = ['decision'];
    expect(validateConfig(incapable).errors).toContain(
      'Default vision model model lacks the vision capability'
    );
  });
});
