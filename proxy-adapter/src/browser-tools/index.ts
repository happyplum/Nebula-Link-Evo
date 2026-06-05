import type { BrowserClient } from '../browser-client.js';
import type { SDKTool } from './types.js';
import { createToolMap } from './tool-map.js';

/**
 * 创建浏览器工具集合
 *
 * @param browserClient - BrowserClient 实例
 * @returns Record<string, SDKTool> - 工具名称到工具定义的映射（15 个工具）
 */
export function createBrowserTools(browserClient: BrowserClient): Record<string, SDKTool> {
  return createToolMap(browserClient);
}
