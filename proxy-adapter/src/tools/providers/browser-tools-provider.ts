import { EventEmitter } from 'node:events';
import type { BrowserClient } from '../../browser-client.js';
import type { GatewayTool, ToolProvider, ToolProviderStatus } from '../types.js';
import { createBrowserTools } from '../../browser-tools/index.js';
import { TOOL_DEFINITIONS } from '../../browser-tools/definitions.js';

/**
 * BrowserToolsProvider 将 browser-tools 包装为 ToolProvider
 *
 * 提供 15 个 browser-control.* 工具，由 BrowserClient 单例执行
 */
export class BrowserToolsProvider extends EventEmitter implements ToolProvider {
  readonly id = 'browser-tools';
  status: ToolProviderStatus = 'initializing';
  private browserClient: BrowserClient;
  private _toolMap: Record<string, unknown> = {};
  private _tools: GatewayTool[] = [];

  constructor(browserClient: BrowserClient) {
    super();
    this.browserClient = browserClient;
  }

  /**
   * 初始化工具提供方
   * 构建 SDKTool 映射并转换为 GatewayTool 数组
   */
  async initialize(): Promise<void> {
    this._toolMap = createBrowserTools(this.browserClient);
    this._tools = TOOL_DEFINITIONS.map((definition) => {
      const sdkTool = this._toolMap[definition.name] as {
        execute: (args: unknown) => Promise<string>;
      } | undefined;

      if (!sdkTool) {
        throw new Error(`Tool not found: ${definition.name}`);
      }

      return {
        id: `browser-tools:${definition.name}`,
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
        providerId: 'browser-tools',
        exposeTo: ['chat', 'mcp-server'] as const,
        isAvailable: true,
        execute: (args: unknown) => sdkTool.execute(args),
      };
    });
    this.status = 'ready';
    this.emit('status-changed', 'ready');
  }

  /**
   * 获取所有工具
   */
  getTools(): GatewayTool[] {
    return this._tools;
  }

  /**
   * 关闭工具提供方
   */
  async shutdown(): Promise<void> {
    this.status = 'disabled';
    this._toolMap = {};
    this._tools = [];
    this.emit('status-changed', 'disabled');
  }
}