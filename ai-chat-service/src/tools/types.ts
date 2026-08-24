/**
 * 统一工具注册系统类型定义
 */

/**
 * 工具提供方状态机
 */
export type ToolProviderStatus = 'initializing' | 'ready' | 'degraded' | 'disabled' | 'failed';

export interface GatewayToolExecutionContext {
  readonly toolCallId?: string;
  readonly abortSignal?: AbortSignal;
}

/**
 * 网关工具统一表示
 * 工具执行入口统一返回可持久化字符串。
 */
export interface GatewayTool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly providerId: string;
  readonly isAvailable: boolean;
  readonly execute: (args: unknown, context?: GatewayToolExecutionContext) => Promise<string>;
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
