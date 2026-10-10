/**
 * 统一工具注册系统类型定义
 */

/**
 * 工具提供方状态机
 */
export type ToolProviderStatus = 'initializing' | 'ready' | 'degraded' | 'disabled' | 'failed';

/**
 * 网关工具统一表示
 * proxy-adapter 仅注册受控 MCP 工具。
 */
export interface GatewayTool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly providerId: string;
  readonly isAvailable: boolean;
  readonly execute: (args: unknown) => Promise<string>;
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
