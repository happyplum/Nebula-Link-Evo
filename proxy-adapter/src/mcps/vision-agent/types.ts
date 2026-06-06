import type { BrowserClient } from '../../browser-client.js';
import type { SnapshotCache } from './snapshot-cache.js';
import type { VisionAnalyzer } from './vision-analyzer.js';

/** Dependencies injected into all vision-agent tools. */
export interface ToolDeps {
  browserClient: BrowserClient;
  visionAnalyzer: VisionAnalyzer;
  cache: SnapshotCache;
}

/** Vision model matching result. */
export interface VisionMatchResult {
  nebula_id: string | null;
  confidence: number;
  reasoning: string;
}

export type VisionToolName = 'analyze' | 'find_element' | 'get_element_info' | 'screenshot';

export type VisionToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface VisionToolResult {
  content: VisionToolContent[];
  isError?: true;
}

export interface VisionAgentTool {
  name: VisionToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: unknown): Promise<VisionToolResult>;
}
