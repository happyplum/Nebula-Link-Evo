/** Browser MCP inventory facade used by the proxy debug surfaces. */
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolProviderStatus } from '../tools/types.js';

export class AppService {
  private toolRegistry: ToolRegistry | null = null;

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

    const providers = [{ id: 'browser-execution-tools', name: 'browser-control' }];

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

    const tools = this.toolRegistry.getAvailableTools();
    return tools
      .filter((t) => t.providerId === 'browser-execution-tools')
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        source: 'built-in' as const,
      }));
  }

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
  status: ToolProviderStatus
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
