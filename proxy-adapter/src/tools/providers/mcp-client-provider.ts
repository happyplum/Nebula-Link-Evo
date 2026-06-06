import { EventEmitter } from 'node:events';
import type { MCPSDKClient, MCPTool } from '../../clients/mcp/sdk-client.js';
import type { GatewayTool, ToolProvider, ToolProviderStatus } from '../types.js';

/**
 * MCPClientProvider 将外部 MCP Client 工具通过 ToolProvider 接入 Registry
 *
 * 从 MCPSDKClient 获取外部 MCP Server 提供的工具（排除 browser-control.*），
 * 仅暴露给 chat 通道，不向下游 MCP Server 传播（不做 MCP proxy）。
 */
export class MCPClientProvider extends EventEmitter implements ToolProvider {
  readonly id = 'mcp-client';
  status: ToolProviderStatus = 'initializing';

  private mcpClient: MCPSDKClient;
  private _tools: GatewayTool[] = [];
  private _onToolsChanged: () => void;

  constructor(mcpClient: MCPSDKClient) {
    super();
    this.mcpClient = mcpClient;
    this._onToolsChanged = () => {
      this._refreshTools();
      this.emit('status-changed', this.status);
    };
  }

  async initialize(): Promise<void> {
    this._refreshTools();
    this.mcpClient.on('toolsChanged', this._onToolsChanged);
    this.status = 'ready';
  }

  getTools(): GatewayTool[] {
    return this._tools;
  }

  async shutdown(): Promise<void> {
    this.mcpClient.removeListener('toolsChanged', this._onToolsChanged);
    this.status = 'disabled';
    this._tools = [];
  }

  private _refreshTools(): void {
    const mcpTools = this.mcpClient.getAvailableTools();

    this._tools = mcpTools
      .filter((mcpTool) => !mcpTool.name.startsWith('browser-control.'))
      .map((mcpTool) => this._toGatewayTool(mcpTool));
  }

  private _toGatewayTool(mcpTool: MCPTool): GatewayTool {
    const dotIndex = mcpTool.name.indexOf('.');
    const serverName = mcpTool.name.substring(0, dotIndex);
    const toolName = mcpTool.name.substring(dotIndex + 1);

    return {
      id: `mcp-client:${mcpTool.name}`,
      name: mcpTool.name,
      description: mcpTool.description,
      inputSchema: mcpTool.inputSchema as Record<string, unknown>,
      providerId: 'mcp-client',
      exposeTo: ['chat'] as const,
      isAvailable: true,
      execute: async (args: unknown) => {
        try {
          const result = await this.mcpClient.callTool(
            serverName,
            toolName,
            args as Record<string, unknown>,
          );
          if (result && typeof result === 'object' && 'text' in result) {
            return (result as { text: string }).text;
          }
          return JSON.stringify(result);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    };
  }
}
