/**
 * MCP CallToolResult 类型（内联定义，不依赖外部）
 */
interface CallToolResult {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * 把任意结果转为 AI SDK 期望的字符串
 * 参照 MCP 的 textResult(JSON.stringify(result)) 模式
 */
export function toSDKResult(data: unknown): string {
  if (data === undefined || data === null) {
    return '';
  }
  const mcpResult = data as Partial<CallToolResult>;
  if (
    mcpResult.content?.[0]?.type === 'text' &&
    typeof mcpResult.content[0].text === 'string'
  ) {
    return mcpResult.content[0].text;
  }

  if (typeof data === 'string') {
    return data;
  }

  return JSON.stringify(data);
}

/**
 * 把异常转为错误文本
 * 参照 MCP 的 errorResult(message) 模式
 */
export function toSDKError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error: ${message}`;
}