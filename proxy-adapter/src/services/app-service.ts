/**
 * AppService - Facade for configuration, MCP, and provider registry
 *
 * Provides config loading, MCP client management, provider registry,
 * and connectivity testing. Task execution orchestration removed.
 */

import { loadConfig, validateConfig } from '../config/index.js';
import { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import type { ResolvedConfig } from '../config/schema.js';
import { ActionExecutor } from './action-executor.js';
import { ProviderRegistry } from './provider/registry.js';
import type { ProviderConfig } from './provider/types.js';
import type { Logger } from 'pino';
import { createWorkerLogger } from './logger.js';

export class AppService {
  private config: ResolvedConfig | null = null;
  private configPath: string = '';
  private registry: ProviderRegistry | null = null;
  private mcpClient: MCPSDKClient | null = null;
  private actionExecutor: ActionExecutor;
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('AppService');
    this.actionExecutor = new ActionExecutor({ mcpClient: null });
  }

  async initialize(): Promise<void> {
    const loadResult = loadConfig();
    this.config = loadResult.config || null;
    this.configPath = loadResult.configPath;

    if (!this.config) {
      throw new Error('Failed to load config: ' + loadResult.result.errors.join(', '));
    }

    const validation = validateConfig(this.config);
    if (!validation.valid) {
      this.logger.warn({ warnings: validation.warnings }, 'Config validation warnings');
      if (validation.errors.length > 0) {
        throw new Error('Config validation failed: ' + validation.errors.join(', '));
      }
    }

    const configProviders: Record<string, ProviderConfig> = {};
    for (const [key, provider] of Object.entries(this.config.providers)) {
      if (provider.enabled) {
        configProviders[key] = {
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl || undefined,
          npmPackage: provider.npmPackage,
        };
      }
    }
    this.registry = new ProviderRegistry(configProviders);

    this.mcpClient = new MCPSDKClient(this.config);
    try {
      await this.mcpClient.initialize();
      this.actionExecutor.setMCPClient(this.mcpClient);
    } catch (error) {
      this.logger.warn({ err: error }, 'MCP initialization failed, continuing without MCP');
    }
  }

  getConfig(): ResolvedConfig | null {
    return this.config;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getRegistry(): ProviderRegistry | null {
    return this.registry;
  }

  getMCPStatus() {
    return {
      enabled: this.mcpClient?.isEnabled() || false,
      servers: this.mcpClient?.getServerList() || [],
    };
  }

  getMCPTools() {
    return this.mcpClient?.getAvailableTools() || [];
  }

  getMCPSDKClient() {
    return this.mcpClient;
  }

  getActionExecutor(): ActionExecutor {
    return this.actionExecutor;
  }

  async shutdown(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.shutdown();
    }
  }

  /**
   * Execute a single action (backward compatibility)
   */
  async executeAction(action: import('../types.js').Action): Promise<import('../types.js').ActionResult> {
    return this.actionExecutor.execute(action);
  }

  /**
   * Get singleton instance (backward compatibility)
   */
  static getInstance(): AppService {
    if (!AppService.instance) {
      AppService.instance = new AppService();
    }
    return AppService.instance;
  }

  private static instance: AppService | null = null;

  static setInstance(instance: AppService): void {
    AppService.instance = instance;
  }

  async testAIConnectivity(): Promise<{
    vision: {
      status: string;
      provider?: string;
      model?: string;
      responseTime: number;
      error?: string | null;
      intro?: string;
    };
    decision: {
      status: string;
      provider?: string;
      model?: string;
      responseTime: number;
      error?: string | null;
      intro?: string;
    };
    totalResponseTime: number;
  }> {
    const startTime = Date.now();
    this.logger.info('Starting AI connectivity test');

    const defaults = this.config?.defaults;
    if (!defaults || !this.registry) {
      return {
        vision: { status: 'not_configured', responseTime: 0, error: 'No config or registry' },
        decision: { status: 'not_configured', responseTime: 0, error: 'No config or registry' },
        totalResponseTime: Date.now() - startTime,
      };
    }

    let visionResult: {
      status: string;
      provider?: string;
      model?: string;
      responseTime: number;
      error?: string | null;
      intro?: string;
    };
    const visionStart = Date.now();
    const visionProvider = defaults.vision.provider;
    const visionModel = defaults.vision.model;
    try {
      if (!this.registry.isAvailable(visionProvider)) {
        this.logger.info('Vision: not configured');
        visionResult = {
          status: 'not_configured',
          responseTime: Date.now() - visionStart,
          error: 'No vision provider available',
        };
      } else {
        this.logger.info({ provider: visionProvider, model: visionModel }, 'Testing Vision');
        await this.registry.resolve(visionProvider, visionModel);
        const intro = await this.getModelIntro(visionProvider, visionModel);
        visionResult = {
          status: 'connected',
          provider: visionProvider,
          model: visionModel,
          responseTime: Date.now() - visionStart,
          error: null,
          intro,
        };
        this.logger.info({ responseTime: visionResult.responseTime }, 'Vision: OK');
        this.logger.info({ introLength: intro?.length ?? 0 }, 'Vision AI Response');
        this.logger.debug({ intro }, 'Vision AI Response (full)');
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      const truncatedError = errMsg.length > 200 ? errMsg.substring(0, 200) + '...' : errMsg;
        this.logger.warn({ error: truncatedError }, 'Vision: FAILED');
      visionResult = {
        status: 'disconnected',
        responseTime: Date.now() - visionStart,
        error: truncatedError,
      };
    }

    let decisionResult: {
      status: string;
      provider?: string;
      model?: string;
      responseTime: number;
      error?: string | null;
      intro?: string;
    };
    const decisionStart = Date.now();
    const decisionProvider = defaults.decision.provider;
    const decisionModel = defaults.decision.model;
    try {
      if (!this.registry.isAvailable(decisionProvider)) {
        this.logger.info('Decision: not configured');
        decisionResult = {
          status: 'not_configured',
          responseTime: Date.now() - decisionStart,
          error: 'No decision provider available',
        };
      } else {
        this.logger.info({ provider: decisionProvider, model: decisionModel }, 'Testing Decision');
        const intro = await this.getModelIntro(decisionProvider, decisionModel);
        decisionResult = {
          status: 'connected',
          provider: decisionProvider,
          model: decisionModel,
          responseTime: Date.now() - decisionStart,
          error: null,
          intro,
        };
        this.logger.info({ responseTime: decisionResult.responseTime }, 'Decision: OK');
        this.logger.info({ introLength: intro?.length ?? 0 }, 'AI Response');
        this.logger.debug({ intro }, 'AI Response (full)');
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      const truncatedError = errMsg.length > 200 ? errMsg.substring(0, 200) + '...' : errMsg;
        this.logger.warn({ error: truncatedError }, 'Decision: FAILED');
      decisionResult = {
        status: 'disconnected',
        responseTime: Date.now() - decisionStart,
        error: truncatedError,
      };
    }

    this.logger.info({ elapsedMs: Date.now() - startTime }, 'AI connectivity test completed');
    return {
      vision: visionResult,
      decision: decisionResult,
      totalResponseTime: Date.now() - startTime,
    };
  }

  private getProviderDisplayName(provider: string): string {
    const names: Record<string, string> = {
      kimi: 'Moonshot AI',
      glm: '智谱 AI',
      nvidia: 'NVIDIA',
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      google: 'Google',
    };
    return names[provider] || provider;
  }

  private async getModelIntro(provider: string, model: string): Promise<string> {
    try {
      const config = this.config;
      if (!config?.providers?.[provider]) {
        return `我是 ${model} 决策模型，由 ${this.getProviderDisplayName(provider)} 提供。`;
      }
      const providerConfig = config.providers[provider];
      const apiKey = providerConfig?.apiKey;
      const baseUrl = providerConfig?.baseUrl || 'https://api.moonshot.cn/v1';
      if (!apiKey || apiKey.startsWith('{')) {
        return `我是 ${model} 决策模型，由 ${this.getProviderDisplayName(provider)} 提供。`;
      }
      const axios = (await import('axios')).default;
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages: [
            {
              role: 'user',
              content: '请用一句话简短介绍你自己（不超过50字），说明你的模型名称和能力。',
            },
          ],
          temperature: 0.7,
          max_tokens: 100,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );
      const intro = response.data.choices[0]?.message?.content || `我是 ${model} 决策模型。`;
      return intro.trim();
    } catch {
      return `我是 ${model} 决策模型，由 ${this.getProviderDisplayName(provider)} 提供。`;
    }
  }
}

const appService = new AppService();
AppService.setInstance(appService);
export { appService };
