import { generateText } from 'ai';
import type { Logger } from 'pino';
import { loadConfig, validateConfig } from '../config/index.js';
import type { ResolvedConfig } from '../config/schema.js';
import { ProviderRegistry } from './provider/registry.js';
import type { ProviderConfig } from './provider/types.js';
import { createWorkerLogger } from './logger.js';
import type { ToolRegistry } from '../tools/registry.js';
import { GATEWAY_MCP_SERVER_NAME } from '../config/service-config.js';

export class AppService {
  private static instance: AppService | null = null;
  private config: ResolvedConfig | null = null;
  private configPath = '';
  private registry: ProviderRegistry | null = null;
  private mcpServers: Array<{ name: string; state: string; running: boolean; toolsCount: number }> =
    [];
  private mcpTools: string[] = [];
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

  async initialize(configPath?: string, gatewayUrl?: string): Promise<void> {
    const loadResult = loadConfig(configPath, gatewayUrl);
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

  setHarnessMcpInventory(serverNames: readonly string[], toolNames: readonly string[]): void {
    this.mcpTools = [...toolNames];
    this.mcpServers = serverNames.map((name) => {
      const toolsCount = toolNames.filter((tool) => tool.startsWith(`mcp__${name}__`)).length;
      return {
        name,
        state: toolsCount > 0 ? 'running' : 'degraded',
        running: toolsCount > 0,
        toolsCount,
      };
    });
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  getMCPStatus(): {
    readonly enabled: boolean;
    readonly servers: Array<{
      readonly name: string;
      readonly state: string;
      readonly running: boolean;
      readonly toolsCount: number;
    }>;
  } {
    return {
      enabled: this.mcpServers.length > 0,
      servers: this.mcpServers,
    };
  }

  getMCPTools(): Array<{
    readonly name: string;
    readonly description: string;
    readonly inputSchema?: object;
    readonly annotations?: unknown;
    readonly source: 'external';
  }> {
    return this.mcpTools.map((name) => ({
      name,
      description: '',
      source: 'external' as const,
    }));
  }

  async shutdown(): Promise<void> {}

  async testAIConnectivity(): Promise<{
    readonly decision: {
      readonly status: string;
      readonly provider?: string;
      readonly model?: string;
      readonly responseTime: number;
      readonly error?: string | null;
      readonly intro?: string;
    };
    readonly visionAgent: {
      readonly status: string;
      readonly tools: string[];
      readonly responseTime: number;
      readonly error?: string | null;
    };
    readonly totalResponseTime: number;
  }> {
    const startedAt = Date.now();
    const decisionStartedAt = Date.now();
    const defaults = this.config?.defaults;
    const registry = this.registry;

    let decision: {
      status: string;
      provider?: string;
      model?: string;
      responseTime: number;
      error?: string | null;
      intro?: string;
    };
    if (!defaults || !registry) {
      decision = {
        status: 'not_configured',
        responseTime: Date.now() - decisionStartedAt,
        error: 'No config or registry',
      };
    } else {
      const provider = defaults.decision.provider;
      const model = defaults.decision.model;
      try {
        if (!registry.isAvailable(provider)) {
          decision = {
            status: 'not_configured',
            responseTime: Date.now() - decisionStartedAt,
            error: 'No decision provider available',
          };
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
    const visionTools =
      this.toolRegistry?.getAvailableTools().filter((tool) => tool.name.startsWith('vision.')) ??
      [];
    const gatewayServer = this.mcpServers.find((server) => server.name === GATEWAY_MCP_SERVER_NAME);
    const gatewayRunning = gatewayServer?.running === true;
    const visionStatus = visionTools.length > 0 && gatewayRunning ? 'connected' : 'degraded';
    const visionError =
      visionTools.length === 0
        ? 'Vision tools are unavailable'
        : gatewayRunning
          ? null
          : `Gateway MCP server is unavailable${gatewayServer ? ` (state: ${gatewayServer.state})` : ''}`;
    const visionAgent = {
      status: visionStatus,
      tools: visionTools.map((tool) => tool.name),
      responseTime: Date.now() - visionStartedAt,
      error: visionError,
    };

    return { decision, visionAgent, totalResponseTime: Date.now() - startedAt };
  }
}

const appService = new AppService();
AppService.setInstance(appService);
export { appService };
