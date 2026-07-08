import { EventEmitter } from 'node:events';
import { gunzipSync } from 'node:zlib';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import type { MCPSDKClient } from '../../clients/mcp/sdk-client.js';
import { MCPServerUnavailableError } from '../../clients/mcp/sdk-client.js';
import type { VisionAnalyzer } from '../../vision/vision-analyzer.js';
import type { VisionConfig } from '../../vision/types.js';
import type { GatewayTool, ToolProvider, ToolProviderStatus } from '../types.js';

/**
 * VisionToolProvider 在 ai-chat-service 内注册 vision.find_element 工具。
 * 内部通过 MCP Client 调用 gateway 的 browser-control.dom_snapshot 获取截图和 DOM，
 * 再使用 VisionAnalyzer 进行视觉分析，返回结构化匹配结果。
 */
export class VisionToolProvider extends EventEmitter implements ToolProvider {
  readonly id = 'vision';
  status: ToolProviderStatus = 'initializing';

  private visionAnalyzer: VisionAnalyzer;
  private mcpClient: MCPSDKClient;
  private config: VisionConfig;
  private _tools: GatewayTool[] = [];

  constructor(visionAnalyzer: VisionAnalyzer, mcpClient: MCPSDKClient, config: VisionConfig) {
    super();
    this.visionAnalyzer = visionAnalyzer;
    this.mcpClient = mcpClient;
    this.config = config;
  }

  async initialize(): Promise<void> {
    this._tools = [this.buildFindElementTool()];
    this.status = 'ready';
  }

  getTools(): GatewayTool[] {
    return this._tools;
  }

  async shutdown(): Promise<void> {
    this.status = 'disabled';
    this._tools = [];
  }

  private buildFindElementTool(): GatewayTool {
    return {
      id: 'vision:find_element',
      name: 'vision.find_element',
      description: 'Find a DOM element by natural language description using vision AI',
      inputSchema: {
        type: 'object',
        required: ['description'],
        properties: {
          description: {
            type: 'string',
            description: 'Natural language description of the target element',
          },
          snapshot_id: {
            type: 'string',
            description: 'Optional snapshot ID from a previous call',
          },
        },
      },
      providerId: this.id,
      exposeTo: ['chat'] as const,
      isAvailable: true,
      execute: async (args: unknown) => {
        return this.executeFindElement(args);
      },
    };
  }

  private async executeFindElement(args: unknown): Promise<string> {
    const input = args as Record<string, unknown>;
    const description = typeof input.description === 'string' ? input.description : '';
    if (!description) {
      return JSON.stringify({ ok: false, code: 'INVALID_INPUT', message: 'description is required', retryable: false });
    }

    // 1. Call MCP gateway for DOM snapshot
    let snapshot: DOMSnapshotResponse;
    try {
      const result = await this.mcpClient.callTool('gateway', 'browser-control.dom_snapshot', {});
      snapshot = this.extractSnapshot(result);
    } catch (error) {
      if (error instanceof MCPServerUnavailableError) {
        return JSON.stringify({ ok: false, code: 'MCP_UNAVAILABLE', message: error.message, retryable: true });
      }
      return JSON.stringify({ ok: false, code: 'MCP_UNAVAILABLE', message: (error as Error).message, retryable: true });
    }

    // 2. Validate snapshot
    if (!snapshot || !snapshot.elements_map || Object.keys(snapshot.elements_map).length === 0) {
      return JSON.stringify({ ok: false, code: 'SNAPSHOT_EMPTY', message: 'DOM snapshot is empty or invalid', retryable: true });
    }

    // 3. Decompress annotated screenshot (gzip base64 → raw base64)
    let rawImage: string;
    try {
      const compressed = Buffer.from(snapshot.annotated_screenshot_base64, 'base64');
      rawImage = gunzipSync(compressed).toString('base64');
    } catch {
      return JSON.stringify({ ok: false, code: 'SNAPSHOT_DECODE_FAILED', message: 'Failed to decompress annotated screenshot', retryable: true });
    }

    // 4. Call VisionAnalyzer
    try {
      const match = await this.visionAnalyzer.findElement(
        { ...snapshot, annotated_screenshot_base64: rawImage },
        description,
      );

      if (match.nebula_id === null) {
        return JSON.stringify({
          ok: true,
          nebula_id: null,
          snapshot_id: snapshot.snapshot_id,
          confidence: match.confidence,
          reasoning: match.reasoning,
        });
      }

      const element = snapshot.elements_map[match.nebula_id];
      const enriched = element ? { tag: element.tag, text: element.text, bbox: element.bbox } : undefined;

      return JSON.stringify({
        ok: true,
        nebula_id: match.nebula_id,
        snapshot_id: snapshot.snapshot_id,
        confidence: match.confidence,
        reasoning: match.reasoning,
        element: enriched,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('timeout') || message.includes('aborted') || message.includes('AbortError')) {
        return JSON.stringify({ ok: false, code: 'VISION_TIMEOUT', message, retryable: true });
      }
      return JSON.stringify({ ok: false, code: 'VISION_ERROR', message, retryable: false });
    }
  }

  private extractSnapshot(result: unknown): DOMSnapshotResponse {
    if (result && typeof result === 'object') {
      // MCPToolCallTextResult has { raw, text, parsed }
      if ('parsed' in result && (result as Record<string, unknown>).parsed) {
        return (result as Record<string, unknown>).parsed as DOMSnapshotResponse;
      }
      // Fallback: parse text field
      if ('text' in result && typeof (result as Record<string, unknown>).text === 'string') {
        return JSON.parse((result as Record<string, string>).text) as DOMSnapshotResponse;
      }
    }
    // Last resort: try to parse the whole result as JSON string
    return JSON.parse(JSON.stringify(result)) as DOMSnapshotResponse;
  }
}
