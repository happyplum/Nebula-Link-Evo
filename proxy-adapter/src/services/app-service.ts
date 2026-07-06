/**
 * AppService - Facade for configuration, browser actions, and gateway tools
 *
 * Provides config loading and the browser MCP gateway service surface.
 */

import { loadConfig, validateConfig } from '../config/index.js';
import type { ResolvedConfig } from '../config/schema.js';
import { ActionExecutor } from './action-executor.js';
import type { Logger } from 'pino';
import { createWorkerLogger } from './logger.js';
import { browserClient } from '../browser-client.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolProviderStatus } from '../tools/types.js';

export class AppService {
  private config: ResolvedConfig | null = null;
  private configPath: string = '';
  private toolRegistry: ToolRegistry | null = null;
  private actionExecutor: ActionExecutor;
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('AppService');
    this.actionExecutor = new ActionExecutor();
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

    // Verify browser tools availability (local module, not MCP-dependent)
    try {
      // browserClient is a singleton, always available as long as the module exists
      const status = await browserClient.getStatus();
      if (status.isOpen) {
        this.logger.info('Browser client ready — browser operations available');
      } else {
        this.logger.info('Browser client initialized — browser operations available (call browser_open to start)');
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Browser client health check failed, but browser tools are defined locally');
    }
  }

  getConfig(): ResolvedConfig | null {
    return this.config;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getMCPStatus() {
    const builtInServers = this.getBuiltInProviderStatus();

    return {
      enabled: true,
      servers: builtInServers,
    };
  }

  getMCPTools() {
    return this.getBuiltInProviderTools();
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  private getBuiltInProviderStatus(): Array<{
    name: string;
    running: boolean;
    state: 'stopped' | 'starting' | 'running' | 'reconnecting' | 'failed' | 'shutting_down';
    toolsCount: number;
    source: 'built-in';
  }> {
    if (!this.toolRegistry) return [];

    const providers = [
      { id: 'browser-tools', name: 'browser-control' },
      { id: 'vision-agent', name: 'vision-agent' },
    ];

    return providers
      .map(({ id, name }) => {
        const provider = this.toolRegistry!.getProvider(id);
        if (!provider) return null;

        const status = provider.status;
        const tools = provider.getTools();
        const availableTools = tools.filter((t) => t.isAvailable);

        return {
          name,
          running: status === 'ready' || status === 'degraded',
          state: mapProviderStatusToState(status),
          toolsCount: availableTools.length,
          source: 'built-in' as const,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }

  private getBuiltInProviderTools(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    source: 'built-in';
  }> {
    if (!this.toolRegistry) return [];

    const tools = this.toolRegistry.getAvailableTools({ consumer: 'all' });
    return tools
      .filter((t) => t.providerId === 'browser-tools' || t.providerId === 'vision-agent')
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        source: 'built-in' as const,
      }));
  }

  getActionExecutor(): ActionExecutor {
    return this.actionExecutor;
  }

  async shutdown(): Promise<void> {
    return Promise.resolve();
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

}

const appService = new AppService();
AppService.setInstance(appService);
export { appService };

/** 将 ToolProviderStatus 映射为 MCPServerState，用于统一展示 */
function mapProviderStatusToState(
  status: ToolProviderStatus,
): 'stopped' | 'starting' | 'running' | 'reconnecting' | 'failed' | 'shutting_down' {
  switch (status) {
    case 'initializing':
      return 'starting';
    case 'ready':
    case 'degraded':
      return 'running';
    case 'disabled':
      return 'stopped';
    case 'failed':
      return 'failed';
    default:
      return 'stopped';
  }
}
