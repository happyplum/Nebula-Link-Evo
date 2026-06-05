import type { BrowserClient } from '../browser-client.js';

export interface BrowserToolContext {
  browserClient: BrowserClient;
}

// AI SDK tool 类型 — 与 chat-handler 中 tool() 返回值一致
export type SDKTool = {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: unknown) => Promise<string>;
};