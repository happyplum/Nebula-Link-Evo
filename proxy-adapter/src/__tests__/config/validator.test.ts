import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  validateProviderModel,
  canProviderDo,
} from '../../config/validator.js';
import type { ResolvedConfig } from '../../config/schema.js';

describe('validateConfig', () => {
  describe('valid configuration', () => {
    it('should pass with unified mode config and legacy vision default present', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'vision-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.vision.com',
          },
          'decision-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.decision.com',
          },
        },
        mcp: {
          enabled: false,
          servers: {},
        },
        defaults: {
          mode: 'unified',
          decision: { provider: 'decision-provider', model: 'decision-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('should pass with valid unified mode config', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'unified-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.unified.com',
          },
        },
        mcp: {
          enabled: false,
          servers: {},
        },
        defaults: {
          mode: 'unified',
          decision: { provider: 'unified-provider', model: 'unified-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('provider validation', () => {
    it('should warn when provider missing apiKey', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: '',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'unified',
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.warnings).toContain('Provider test-provider: missing apiKey');
    });

    it('should warn when provider missing baseUrl', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: '',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'unified',
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.warnings).toContain('Provider test-provider: missing baseUrl');
    });

    it('should allow provider with no models (dynamic resolution)', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'unified',
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should warn when no providers enabled', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: false,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'unified',
          decision: { provider: 'test', model: 'test' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.warnings).toContain('No providers enabled');
    });

    it('should allow model with missing type (dynamic resolution)', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'unified',
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should allow model with missing capabilities (dynamic resolution)', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'unified',
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('unified mode validation', () => {
    it('should warn when default decision provider is disabled', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'vision-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.vision.com',
          },
          'decision-provider': {
            enabled: false,
            apiKey: 'test-key',
            baseUrl: 'https://api.decision.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'unified',
          decision: { provider: 'decision-provider', model: 'decision-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.warnings).toContain(
        'Default decision provider decision-provider is disabled'
      );
    });
  });

  describe('unified mode required decision fields', () => {
    it('should error when unified mode missing decision.provider', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'unified-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.unified.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'unified',
          decision: { provider: '', model: 'unified-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unified mode requires decision.provider');
    });

    it('should error when unified mode missing decision.model', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'unified-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.unified.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'unified',
          decision: { provider: 'unified-provider', model: '' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unified mode requires decision.model');
    });

    it('should allow unified mode with model missing decision capability (dynamic resolution)', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'unified-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.unified.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'unified',
          decision: { provider: 'unified-provider', model: 'vision-only-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('missing defaults', () => {
    it('should warn when defaults configuration is missing', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {},
        mcp: { enabled: false, servers: {} },
        defaults: null as any,
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.warnings).toContain('Missing defaults configuration');
    });
  });

  describe('MCP server validation', () => {
    it('should error when MCP server missing command', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: {
          enabled: true,
          servers: {
            'test-server': {
              enabled: true,
              command: '',
              args: ['test.js'],
              env: {},
            },
          },
        },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'test-model' },
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MCP server test-server: missing command');
    });

    it('should warn when MCP server has no args', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: {
          enabled: true,
          servers: {
            'test-server': {
              enabled: true,
              command: 'node',
              args: [],
              env: {},
            },
          },
        },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'test-model' },
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.warnings).toContain('MCP server test-server: no args specified');
    });

    it('should not validate disabled MCP servers', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: {
          enabled: true,
          servers: {
            'disabled-server': {
              enabled: false,
              command: '',
              args: [],
              env: {},
            },
          },
        },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'test-model' },
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.errors).not.toContain(
        'MCP server disabled-server: missing command'
      );
    });
  });

  describe('resolved provider validation', () => {
    it('should warn when provider apiKey not resolved', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: '',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'test-model' },
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateConfig(config);
      expect(result.warnings).toContain('Provider test-provider: missing apiKey');
    });
  });
});

describe('validateProviderModel', () => {
  describe('valid provider/model combinations', () => {
    it('should return valid for existing enabled provider and model', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'test-model' },
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateProviderModel(
        config,
        'test-provider',
        'test-model'
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('invalid provider/model combinations', () => {
    it('should error for non-existent provider', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {},
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test', model: 'test' },
          decision: { provider: 'test', model: 'test' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateProviderModel(
        config,
        'non-existent-provider',
        'test-model'
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Provider non-existent-provider not found'
      );
    });

    it('should error for disabled provider', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: false,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'test-model' },
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateProviderModel(
        config,
        'test-provider',
        'test-model'
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Provider test-provider is disabled');
    });

    it('should error for non-existent model', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
            models: {
              'existing-model': {
                type: 'multimodal',
                capabilities: ['vision', 'decision'],
              },
            },
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'test-model' },
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = validateProviderModel(
        config,
        'test-provider',
        'non-existent-model'
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Model non-existent-model not found in provider test-provider'
      );
    });
  });
});

describe('canProviderDo', () => {
  describe('capability checks', () => {
    it('should return true for vision capability', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'vision-model' },
          decision: { provider: 'test-provider', model: 'vision-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = canProviderDo(
        'test-provider',
        'vision-model',
        'vision',
        config
      );
      expect(result).toBe(true);
    });

    it('should return true for decision capability', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'decision-model' },
          decision: { provider: 'test-provider', model: 'decision-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = canProviderDo(
        'test-provider',
        'decision-model',
        'decision',
        config
      );
      expect(result).toBe(true);
    });

    it('should return true for multimodal model with both capabilities', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'multimodal-model' },
          decision: { provider: 'test-provider', model: 'multimodal-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const visionResult = canProviderDo(
        'test-provider',
        'multimodal-model',
        'vision',
        config
      );
      const decisionResult = canProviderDo(
        'test-provider',
        'multimodal-model',
        'decision',
        config
      );
      expect(visionResult).toBe(true);
      expect(decisionResult).toBe(true);
    });
  });

  describe('negative cases', () => {
    it('should return false for non-existent provider', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {},
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test', model: 'test' },
          decision: { provider: 'test', model: 'test' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = canProviderDo(
        'non-existent-provider',
        'test-model',
        'vision',
        config
      );
      expect(result).toBe(false);
    });

    it('should return false for disabled provider', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: false,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'test-model' },
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = canProviderDo(
        'test-provider',
        'test-model',
        'vision',
        config
      );
      expect(result).toBe(false);
    });

    it('should return false for non-existent model', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
            models: {
              'existing-model': {
                type: 'multimodal',
                capabilities: ['vision', 'decision'],
              },
            },
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'test-model' },
          decision: { provider: 'test-provider', model: 'test-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = canProviderDo(
        'test-provider',
        'non-existent-model',
        'vision',
        config
      );
      expect(result).toBe(false);
    });

    it('should return false when model does not support capability', () => {
      const config: ResolvedConfig = {
        version: '1.0.0',
        providers: {
          'test-provider': {
            enabled: true,
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
            models: {
              'vision-model': {
                type: 'multimodal',
                capabilities: ['vision'],
              },
            },
          },
        },
        mcp: { enabled: false, servers: {} },
        defaults: {
          mode: 'separation',
          vision: { provider: 'test-provider', model: 'vision-model' },
          decision: { provider: 'test-provider', model: 'vision-model' },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
};

      const result = canProviderDo(
        'test-provider',
        'vision-model',
        'decision',
        config
      );
      expect(result).toBe(false);
    });
  });
});
