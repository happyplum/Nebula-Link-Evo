import { generateText } from 'ai';
import type { Logger } from 'pino';
import { loadConfig, validateConfig } from '../config/index.js';
import type { ResolvedConfig } from '../config/schema.js';
import { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import { ProviderRegistry } from './provider/registry.js';
import type { ProviderConfig } from './provider/types.js';
import { createWorkerLogger } from './logger.js';
import type { ToolRegistry } from '../tools/registry.js';

export interface ApiKeyStatus {
  readonly provider: string;
  readonly displayName: string;
  readonly status: 'configured' | 'missing' | 'disabled';
  readonly keyPreview: string;
}

export class AppService {
  private static instance: AppService | null = null;
  private config: ResolvedConfig | null = null;
  private configPath = '';
  private registry: ProviderRegistry | null = null;
  private mcpClient: MCPSDKClient | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('AppService');
  }

  static getInstance(): AppService {
    if (!AppService.instance) {
      AppService.instance = new AppService();
    }
    return AppService.instance;
  }

  static setInstance(instance: AppService): void {
    AppService.instance = instance;
  }

  async initialize(): Promise<void> {
    const loadResult = loadConfig();
    this.config = loadResult.config;
    this.configPath = loadResult.configPath;

    if (!this.config) {
      throw new Error(`Failed to load config: ${loadResult.result.errors.join(', ')}`);
    }

    const validation = validateConfig(this.config);
    if (!validation.valid) {
      throw new Error(`Config validation failed: ${validation.errors.join(', ')}`);
    }
    if (validation.warnings.length > 0) {
      this.logger.warn({ warnings: validation.warnings }, 'Config validation warnings');
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
    } catch (error) {
      this.logger.warn({ err: error }, 'MCP initialization failed, continuing without MCP tools');
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

  getMCPSDKClient(): MCPSDKClient | null {
    return this.mcpClient;
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  getMCPStatus(): {
    readonly enabled: boolean;
    readonly servers: Array<{ readonly name: string; readonly state: string; readonly running: boolean; readonly toolsCount: number }>;
  } {
    return {
      enabled: this.mcpClient?.isEnabled() ?? false,
      servers: this.mcpClient?.getServerList() ?? [],
    };
  }

  getMCPTools(): Array<{ readonly name: string; readonly description: string; readonly inputSchema?: object; readonly annotations?: unknown; readonly source: 'external' }> {
    return (this.mcpClient?.getAvailableTools() ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      source: 'external' as const,
    }));
  }

  async shutdown(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.shutdown();
    }
  }

  getApiKeyStatuses(): ApiKeyStatus[] {
    if (!this.config?.providers) {
      return [];
    }

    return Object.entries(this.config.providers).map(([provider, config]) => {
      const hasKey = Boolean(config.apiKey) && !config.apiKey.startsWith('{');
      return {
        provider,
        displayName: this.getProviderDisplayName(provider),
        status: config.enabled ? (hasKey ? 'configured' : 'missing') : 'disabled',
        keyPreview: hasKey ? this.previewKey(config.apiKey) : '',
      };
    });
  }

  async testAIConnectivity(): Promise<{
    readonly decision: { readonly status: string; readonly provider?: string; readonly model?: string; readonly responseTime: number; readonly error?: string | null; readonly intro?: string };
    readonly visionAgent: { readonly status: string; readonly tools: string[]; readonly responseTime: number; readonly error?: string | null };
    readonly totalResponseTime: number;
  }> {
    const startedAt = Date.now();
    const decisionStartedAt = Date.now();
    const defaults = this.config?.defaults;
    const registry = this.registry;

    let decision: { status: string; provider?: string; model?: string; responseTime: number; error?: string | null; intro?: string };
    if (!defaults || !registry) {
      decision = { status: 'not_configured', responseTime: Date.now() - decisionStartedAt, error: 'No config or registry' };
    } else {
      const provider = defaults.decision.provider;
      const model = defaults.decision.model;
      try {
        if (!registry.isAvailable(provider)) {
          decision = { status: 'not_configured', responseTime: Date.now() - decisionStartedAt, error: 'No decision provider available' };
        } else {
          const languageModel = await registry.resolve(provider, model);
          const result = await generateText({
            model: languageModel,
            prompt: '请用一句话简短介绍你自己（不超过50字），说明你的模型名称和能力。',
            temperature: 0.7,
            maxOutputTokens: 100,
            abortSignal: AbortSignal.timeout(10000),
          });
          decision = {
            status: 'connected',
            provider,
            model,
            responseTime: Date.now() - decisionStartedAt,
            error: null,
            intro: result.text.trim(),
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        decision = {
          status: 'disconnected',
          provider,
          model,
          responseTime: Date.now() - decisionStartedAt,
          error: message.length > 200 ? `${message.slice(0, 200)}...` : message,
        };
      }
    }

    const visionStartedAt = Date.now();
    const visionTools = this.toolRegistry
      ?.getAvailableTools({ consumer: 'chat' })
      .filter((tool) => tool.name.startsWith('vision-agent.')) ?? [];
    const visionAgent = {
      status: visionTools.length > 0 ? 'connected' : 'degraded',
      tools: visionTools.map((tool) => tool.name),
      responseTime: Date.now() - visionStartedAt,
      error: visionTools.length > 0 ? null : 'Vision agent tools are unavailable from the MCP gateway',
    };

    return { decision, visionAgent, totalResponseTime: Date.now() - startedAt };
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

  private previewKey(apiKey: string): string {
    if (apiKey.length <= 8) {
      return '***';
    }
    return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
  }
}

const appService = new AppService();
AppService.setInstance(appService);
export { appService };
