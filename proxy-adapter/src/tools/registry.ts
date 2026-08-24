/**
 * 统一工具注册系统实现
 */

import { EventEmitter } from 'node:events';
import { createWorkerLogger } from '../services/logger.js';
import type { GatewayTool, ToolProvider, ToolProviderStatus } from './types.js';

const logger = createWorkerLogger('ToolRegistry');

/**
 * 工具注册表 - 统一管理所有工具提供方
 */
export class ToolRegistry extends EventEmitter {
  private providers: Map<string, ToolProvider> = new Map();

  /**
   * 注册工具提供方
   */
  registerProvider(provider: ToolProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" already registered`);
    }

    this.providers.set(provider.id, provider);

    provider.on('status-changed', (...args: unknown[]) => {
      const newStatus = args[0] as ToolProviderStatus;
      this.emit('provider:status-changed', provider.id, newStatus);
      this.emit('tools:changed');
    });

    provider.on('tools-changed', () => {
      this.emit('tools:changed');
    });
  }

  /**
   * 注销工具提供方
   */
  unregisterProvider(id: string): void {
    const provider = this.providers.get(id);
    if (!provider) {
      return;
    }

    this.providers.delete(id);
    this.emit('tools:changed');
  }

  /**
   * 获取所有可用的受控 MCP 工具。
   */
  getAvailableTools(): GatewayTool[] {
    const tools: GatewayTool[] = [];

    for (const provider of this.providers.values()) {
      for (const tool of provider.getTools()) {
        if (!tool.isAvailable) {
          continue;
        }

        tools.push(tool);
      }
    }

    return tools;
  }

  /**
   * 获取所有工具（无过滤）
   */
  getAllTools(): GatewayTool[] {
    const tools: GatewayTool[] = [];

    for (const provider of this.providers.values()) {
      tools.push(...provider.getTools());
    }

    return tools;
  }

  /**
   * 初始化所有工具提供方
   */
  async initializeAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.providers.values()).map((provider) => provider.initialize())
    );

    const providerKeys = Array.from(this.providers.keys());
    let failureCount = 0;

    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        failureCount++;
        const providerId = providerKeys[index];
        const provider = this.providers.get(providerId);
        if (provider) {
          provider.status = 'degraded';
        }
        logger.warn(
          { providerId, error: result.reason },
          'Tool provider initialization failed, set to degraded'
        );
      }
    }

    if (failureCount > 0 && failureCount === results.length) {
      logger.error('All tool providers failed to initialize — no tools available');
    }
  }

  /**
   * 关闭所有工具提供方
   */
  async shutdownAll(): Promise<void> {
    await Promise.all(Array.from(this.providers.values()).map((provider) => provider.shutdown()));
  }

  /**
   * 获取提供方状态
   */
  getProviderStatus(id: string): ToolProviderStatus | undefined {
    const provider = this.providers.get(id);
    return provider?.status;
  }

  /**
   * 获取提供方实例
   */
  getProvider(id: string): ToolProvider | undefined {
    return this.providers.get(id);
  }
}
