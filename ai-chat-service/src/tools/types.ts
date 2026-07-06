/**
 * 统一工具注册系统类型定义
 */

/**
 * 工具提供方状态机
 */
export type ToolProviderStatus =
  | 'initializing'
  | 'ready'
  | 'degraded'
  | 'disabled'
  | 'failed';

/**
 * 网关工具统一表示
 * 与 SDKTool.execute 签名兼容: (args: unknown) => Promise<string>
 */
export interface GatewayTool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly providerId: string;
  readonly exposeTo: readonly ('chat' | 'mcp-server')[];
  readonly isAvailable: boolean;
  readonly execute: (args: unknown) => Promise<string>;
  readonly source?: {
    readonly type: 'mcp';
    readonly serverName: string;
    readonly toolName: string;
  };
}

/**
 * 工具提供方接口
 */
export interface ToolProvider {
  readonly id: string;
  status: ToolProviderStatus;
  getTools(): GatewayTool[];
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}
