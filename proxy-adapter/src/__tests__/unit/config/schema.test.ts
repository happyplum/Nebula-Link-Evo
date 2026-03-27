import { describe, it, expect } from 'vitest';
import type {
  Config,
  Provider,
  ModelConfig,
  MCPConfig,
  MCPServerConfig,
  DefaultsConfig,
  ModelSelector,
  SettingsConfig,
  ResolvedConfig,
  ResolvedProvider,
} from '../../config/schema.js';
import type {
  UIElement,
  SimplifiedDOM,
  DOMElement,
  Action,
  ActionResult,
  TaskRequest,
  TaskResponse,
} from '../../config/schema.js';

describe('schema exports', () => {
  it('should export Config type', () => {
    const config: Config = {
      version: '1.0.0',
      providers: {},
      mcp: {
        enabled: false,
        servers: {},
      },
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

    expect(config).toBeDefined();
    expect(config.version).toBe('1.0.0');
    expect(config.providers).toBeDefined();
    expect(config.mcp).toBeDefined();
    expect(config.defaults).toBeDefined();
    expect(config.settings).toBeDefined();
  });

  it('should export Provider type', () => {
    const provider: Provider = {
      name: 'test-provider',
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://api.test.com',
      mcp: ['test-mcp'],
      models: {
        'test-model': {
          type: 'vision',
          capabilities: ['vision'],
        },
      },
    };

    expect(provider).toBeDefined();
    expect(provider.name).toBe('test-provider');
    expect(provider.enabled).toBe(true);
    expect(provider.apiKey).toBe('test-key');
    expect(provider.baseUrl).toBe('https://api.test.com');
    expect(provider.mcp).toEqual(['test-mcp']);
    expect(provider.models).toBeDefined();
  });

  it('should export ModelConfig type', () => {
    const modelConfig: ModelConfig = {
      type: 'vision',
      capabilities: ['vision'],
      temperature: 0.7,
      maxTokens: 2000,
    };

    expect(modelConfig).toBeDefined();
    expect(modelConfig.type).toBe('vision');
    expect(modelConfig.capabilities).toEqual(['vision']);
    expect(modelConfig.temperature).toBe(0.7);
    expect(modelConfig.maxTokens).toBe(2000);
  });

  it('should export MCPConfig type', () => {
    const mcpConfig: MCPConfig = {
      enabled: true,
      servers: {
        'test-server': {
          enabled: true,
          command: 'node',
          args: ['server.js'],
          env: {},
        },
      },
    };

    expect(mcpConfig).toBeDefined();
    expect(mcpConfig.enabled).toBe(true);
    expect(mcpConfig.servers).toBeDefined();
  });

  it('should export MCPServerConfig type', () => {
    const serverConfig: MCPServerConfig = {
      enabled: true,
      command: 'node',
      args: ['server.js'],
      env: { TEST_VAR: 'value' },
      stdin: false,
      url: 'http://localhost:8000',
    };

    expect(serverConfig).toBeDefined();
    expect(serverConfig.enabled).toBe(true);
    expect(serverConfig.command).toBe('node');
    expect(serverConfig.args).toEqual(['server.js']);
    expect(serverConfig.env).toEqual({ TEST_VAR: 'value' });
    expect(serverConfig.stdin).toBe(false);
    expect(serverConfig.url).toBe('http://localhost:8000');
  });

  it('should export DefaultsConfig type with separation mode', () => {
    const defaultsConfig: DefaultsConfig = {
      mode: 'separation',
      vision: { provider: 'vision-provider', model: 'vision-model' },
      decision: { provider: 'decision-provider', model: 'decision-model' },
    };

    expect(defaultsConfig).toBeDefined();
    expect(defaultsConfig.mode).toBe('separation');
    expect(defaultsConfig.vision).toBeDefined();
    expect(defaultsConfig.decision).toBeDefined();
  });

  it('should export DefaultsConfig type with unified mode', () => {
    const defaultsConfig: DefaultsConfig = {
      mode: 'unified',
      vision: { provider: 'unified-provider', model: 'unified-model' },
      decision: { provider: 'unified-provider', model: 'unified-model' },
    };

    expect(defaultsConfig).toBeDefined();
    expect(defaultsConfig.mode).toBe('unified');
  });

  it('should export ModelSelector type', () => {
    const modelSelector: ModelSelector = {
      provider: 'test-provider',
      model: 'test-model',
    };

    expect(modelSelector).toBeDefined();
    expect(modelSelector.provider).toBe('test-provider');
    expect(modelSelector.model).toBe('test-model');
  });

  it('should export SettingsConfig type', () => {
    const settingsConfig: SettingsConfig = {
      timeout: 30000,
      maxRetries: 3,
      temperature: 0.7,
      maxTokens: 2000,
      maxSteps: 10,
    };

    expect(settingsConfig).toBeDefined();
    expect(settingsConfig.timeout).toBe(30000);
    expect(settingsConfig.maxRetries).toBe(3);
    expect(settingsConfig.temperature).toBe(0.7);
    expect(settingsConfig.maxTokens).toBe(2000);
    expect(settingsConfig.maxSteps).toBe(10);
  });

  it('should export ResolvedConfig type', () => {
    const resolvedConfig: ResolvedConfig = {
      version: '1.0.0',
      providers: {
        'test-provider': {
          name: 'test-provider',
          enabled: true,
          apiKey: 'resolved-key',
          baseUrl: 'https://api.test.com',
          mcp: [],
          models: {
            'test-model': {
              type: 'vision',
              capabilities: ['vision'],
              resolvedTemperature: 0.7,
              resolvedMaxTokens: 2000,
            },
          },
        },
      },
      mcp: {
        enabled: false,
        servers: {},
      },
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
      _resolved: {
        providers: {
          'test-provider': {
            name: 'test-provider',
            enabled: true,
            apiKey: 'resolved-key',
            baseUrl: 'https://api.test.com',
            mcp: [],
            models: {
              'test-model': {
                type: 'vision',
                capabilities: ['vision'],
                resolvedTemperature: 0.7,
                resolvedMaxTokens: 2000,
              },
            },
          },
        },
        settings: {
          timeout: 30000,
          maxRetries: 3,
          temperature: 0.7,
          maxTokens: 2000,
          maxSteps: 10,
        },
      },
    };

    expect(resolvedConfig).toBeDefined();
    expect(resolvedConfig._resolved).toBeDefined();
    expect(resolvedConfig._resolved.providers).toBeDefined();
    expect(resolvedConfig._resolved.settings).toBeDefined();
  });

  it('should export ResolvedProvider type', () => {
    const resolvedProvider: ResolvedProvider = {
      name: 'test-provider',
      enabled: true,
      apiKey: 'resolved-key',
      baseUrl: 'https://api.test.com',
      mcp: [],
      models: {
        'test-model': {
          type: 'vision',
          capabilities: ['vision'],
          resolvedTemperature: 0.7,
          resolvedMaxTokens: 2000,
        },
      },
    };

    expect(resolvedProvider).toBeDefined();
    expect(resolvedProvider.apiKey).toBe('resolved-key');
    expect(resolvedProvider.models).toBeDefined();
    const testModel = resolvedProvider.models['test-model'];
    expect(testModel?.resolvedTemperature).toBe(0.7);
    expect(testModel?.resolvedMaxTokens).toBe(2000);
  });

  it('should export UIElement type', () => {
    const uiElement: UIElement = {
      tag: 'button',
      text: 'Click me',
      bbox: { x: 0, y: 0, width: 100, height: 40 },
      isVisible: true,
    };

    expect(uiElement).toBeDefined();
    expect(uiElement.tag).toBe('button');
    expect(uiElement.text).toBe('Click me');
    expect(uiElement.bbox).toBeDefined();
    expect(uiElement.isVisible).toBe(true);
  });

  it('should export SimplifiedDOM type', () => {
    const simplifiedDOM: SimplifiedDOM = {
      url: 'https://example.com',
      title: 'Test Page',
      elements: [],
      viewport: { width: 1920, height: 1080 },
    };

    expect(simplifiedDOM).toBeDefined();
    expect(simplifiedDOM.url).toBe('https://example.com');
    expect(simplifiedDOM.title).toBe('Test Page');
    expect(simplifiedDOM.elements).toBeDefined();
    expect(simplifiedDOM.viewport).toBeDefined();
  });

  it('should export DOMElement type', () => {
    const domElement: DOMElement = {
      tag: 'div',
      attributes: { id: 'test', class: 'test-class' },
      children: [],
      isVisible: true,
    };

    expect(domElement).toBeDefined();
    expect(domElement.tag).toBe('div');
    expect(domElement.attributes).toBeDefined();
    expect(domElement.children).toBeDefined();
  });

  it('should export Action type', () => {
    const action: Action = {
      type: 'click',
      params: { x: 100, y: 200 },
      reasoning: 'Click button',
    };

    expect(action).toBeDefined();
    expect(action.type).toBe('click');
    expect(action.params).toBeDefined();
    expect(action.reasoning).toBe('Click button');
  });

  it('should export ActionResult type', () => {
    const actionResult: ActionResult = {
      success: true,
      message: 'Action completed',
    };

    expect(actionResult).toBeDefined();
    expect(actionResult.success).toBe(true);
    expect(actionResult.message).toBe('Action completed');
  });

  it('should export TaskRequest type', () => {
    const taskRequest: TaskRequest = {
      url: 'https://example.com',
      instruction: 'Click login button',
    };

    expect(taskRequest).toBeDefined();
    expect(taskRequest.url).toBe('https://example.com');
    expect(taskRequest.instruction).toBe('Click login button');
  });

  it('should export TaskResponse type', () => {
    const taskResponse: TaskResponse = {
      success: true,
      url: 'https://example.com',
      actions: [],
      result: 'Task completed',
    };

    expect(taskResponse).toBeDefined();
    expect(taskResponse.success).toBe(true);
    expect(taskResponse.url).toBe('https://example.com');
    expect(taskResponse.actions).toBeDefined();
    expect(taskResponse.result).toBe('Task completed');
  });

  describe('ModelConfig type variations', () => {
    it('should support vision type', () => {
      const config: ModelConfig = {
        type: 'vision',
        capabilities: ['vision'],
      };

      expect(config.type).toBe('vision');
      expect(config.capabilities).toContain('vision');
    });

    it('should support decision type', () => {
      const config: ModelConfig = {
        type: 'decision',
        capabilities: ['decision'],
      };

      expect(config.type).toBe('decision');
      expect(config.capabilities).toContain('decision');
    });

    it('should support multimodal type', () => {
      const config: ModelConfig = {
        type: 'multimodal',
        capabilities: ['vision', 'decision'],
      };

      expect(config.type).toBe('multimodal');
      expect(config.capabilities).toEqual(['vision', 'decision']);
    });
  });

  describe('Config with optional fields', () => {
    it('should allow optional $schema field', () => {
      const config: Config = {
        $schema: 'schema.json',
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

      expect(config.$schema).toBe('schema.json');
    });

    it('should allow optional description field', () => {
      const config: Config = {
        version: '1.0.0',
        description: 'Test configuration',
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

      expect(config.description).toBe('Test configuration');
    });
  });

  describe('MCPServerConfig with optional fields', () => {
    it('should allow optional stdin field', () => {
      const config: MCPServerConfig = {
        enabled: true,
        command: 'node',
        args: ['server.js'],
        env: {},
      };

      expect(config.stdin).toBeUndefined();
    });

    it('should allow optional url field', () => {
      const config: MCPServerConfig = {
        enabled: true,
        command: 'node',
        args: ['server.js'],
        env: {},
      };

      expect(config.url).toBeUndefined();
    });
  });
});
