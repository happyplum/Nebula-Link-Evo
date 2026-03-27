import axios, { AxiosResponse, AxiosRequestConfig } from 'axios';
import { DecisionClient } from './base.js';
import { DecisionContext, MCPTool } from '../types.js';
import { UIElement, Action, ActionResult, DOMSnapshotResponse } from '../../config/schema.js';
import type { ResolvedTarget } from '../../types.js';
import { StreamProcessor } from './stream.js';

export interface BaseDecisionConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export abstract class BaseDecisionClient implements DecisionClient {
  provider: string = '';
  model: string;
  capabilities = ['decision'];
  protected apiKey: string;
  protected baseUrl: string;
  protected temperature: number;
  protected maxTokens: number;
  protected supportsMultimodal: boolean = true;

  constructor(config: BaseDecisionConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 1000;
  }

  getCapabilities(): string[] {
    return this.capabilities;
  }

  async decide(context: DecisionContext): Promise<Action> {
    const { screenshot, dom, elements, instruction, previousActions, mcpTools } = context;

    try {
      const messages = this.buildMessages(
        dom,
        elements,
        instruction,
        previousActions,
        mcpTools,
        screenshot
      );

      const options: AxiosRequestConfig = {
        headers: this.getHeaders(),
        timeout: 30000,
      };

      const requestBody = this.getRequestBody(messages, options);
      const response = await axios.post(this.getApiEndpoint(), requestBody, options);

      const content = response.data.choices[0]?.message?.content;
      return this.parseAction(content);
    } catch (error) {
      console.error(`${this.provider} Decision API error:`, error);
      throw new Error(`${this.provider} Decision API failed: ${(error as Error).message}`);
    }
  }

  protected buildMessages(
    dom: DOMSnapshotResponse,
    elements: UIElement[],
    instruction: string,
    previousActions: ActionResult[],
    mcpTools: MCPTool[] | undefined,
    screenshot: string
  ): any[] {
    return [
      {
        role: 'system',
        content: this.getSystemPrompt(mcpTools),
      },
      {
        role: 'user',
        content: this.buildUserPrompt(
          dom,
          elements,
          instruction,
          previousActions,
          mcpTools,
          screenshot
        ),
      },
    ];
  }

  protected getSystemPrompt(mcpTools?: MCPTool[]): string {
    let prompt = `你是一个网页自动化助手。你的任务是根据截图、检测到的UI元素和DOM信息，决定下一步操作。

你可以执行以下操作：
1. click - 点击指定坐标或元素
   params: { "x": number, "y": number } 或 { "selector": string }
   优先使用标记ID格式: { "target_id": number, "snapshot_id": string }
2. type - 在输入框中输入文本
   params: { "selector": string, "text": string }
3. scroll - 滚动页面
   params: { "x": number, "y": number }
4. wait - 等待页面加载
   params: { "delay": number }
5. navigate - 导航到新URL
   params: { "url": string }
6. finish - 任务完成
   params: { "result": string }`;

    if (mcpTools && mcpTools.length > 0) {
      prompt += `\n7. mcp_call - 调用MCP工具执行浏览器操作

可用的MCP工具：
${mcpTools
  .map((tool) => {
    const schema = tool.inputSchema as any;
    const props = schema?.properties || {};
    const required = schema?.required || [];
    const paramsDesc = Object.entries(props)
      .map(([key, val]: [string, any]) => {
        const req = required.includes(key) ? '(必填)' : '(可选)';
        return `    - ${key} ${req}: ${val.description || val.type || 'unknown'}`;
      })
      .join('\n');
    return `- ${tool.name}: ${tool.description}
  参数:
${paramsDesc || '    无参数'}`;
  })
  .join('\n\n')}`;
    }

    prompt += `

返回格式必须是JSON：
{
  "type": "click",
  "params": { "x": 100, "y": 200 },
  "reasoning": "点击搜索按钮"
}

如果是mcp_call操作：
{
  "type": "mcp_call",
  "params": { "server": "browser-control", "tool": "browser_click", "args": { "element": "搜索按钮" } },
  "reasoning": "使用MCP工具点击元素"
}`;

    return prompt;
  }

  protected buildPrompt(
    dom: DOMSnapshotResponse,
    elements: UIElement[],
    instruction: string,
    previousActions: ActionResult[],
    mcpTools?: MCPTool[]
  ): string {
    const domLike = dom as unknown as {
      snapshot_id?: string;
      version?: string;
      url?: string;
      elements_map?: unknown;
    };
    const domElements = this.extractDomElements(domLike);
    const snapshotId = domLike.snapshot_id ?? domLike.url ?? 'unknown';
    const version = domLike.version ?? 'legacy';

    let prompt = `请分析当前网页截图，完成以下任务：

**任务指令**: ${instruction}

**页面信息**:
- Snapshot ID: ${snapshotId}
- 视图版本: ${version}
- 标记截图: 已包含红色数字标记

**DOM中的可交互元素** (${domElements.length}个):
${domElements
  .slice(0, 10)
  .map(
    (el, i: number) =>
      `${i + 1}. [${el.tag}] ${el.text || ''} ${el.bbox ? `坐标: (${Math.round(el.bbox.x)}, ${Math.round(el.bbox.y)})` : ''}`
  )
  .join('\n')}

**视觉检测到的UI元素** (${elements.length}个):
${elements
  .slice(0, 20)
  .map(
    (el, i) =>
      `${i + 1}. [${el.type}] ${el.text || el.description || ''} ${el.center ? `坐标: (${Math.round(el.center[0])}, ${Math.round(el.center[1])})` : ''} 置信度: ${el.confidence ? (el.confidence * 100).toFixed(1) : 'N/A'}%`
  )
  .join('\n')}

${
  previousActions.length > 0
    ? `**已执行的操作**:
${previousActions.map((a, i) => `${i + 1}. ${a.action.type}: ${JSON.stringify(a.action.params)} (${a.success ? '成功' : '失败'})`).join('\n')}`
    : ''
}`;

    if (mcpTools && mcpTools.length > 0) {
      prompt += `

**可用的MCP工具** (优先使用这些工具进行浏览器操作):
${mcpTools
  .map((tool) => {
    const schema = tool.inputSchema as any;
    const props = schema?.properties || {};
    const required = schema?.required || [];
    const paramsDesc = Object.entries(props)
      .map(([key, val]: [string, any]) => {
        const req = required.includes(key) ? '(必填)' : '(可选)';
        return `    - ${key} ${req}: ${val.description || val.type || 'unknown'}`;
      })
      .join('\n');
    return `- ${tool.name}: ${tool.description}
  参数:
${paramsDesc || '    无参数'}`;
  })
  .join('\n\n')}`;
    }

    prompt += `

请返回下一步操作的JSON格式指令。`;

    return prompt;
  }

  protected buildUserPrompt(
    dom: DOMSnapshotResponse,
    elements: UIElement[],
    instruction: string,
    previousActions: ActionResult[],
    mcpTools: MCPTool[] | undefined,
    screenshot: string
  ): any[] {
    const textContent = {
      type: 'text',
      text: this.buildPrompt(dom, elements, instruction, previousActions, mcpTools),
    };

    // 只有当有截图时才添加图片
    if (screenshot && screenshot.length > 0) {
      return [
        textContent,
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${screenshot}`,
          },
        },
      ];
    }

    return [textContent];
  }

  /**
   * Extract DOM elements from the snapshot.
   * Handles v2.0 Record format (elements_map).
   */
  protected extractDomElements(dom: {
    elements_map?: unknown;
  }): Array<{
    tag: string;
    text?: string;
    bbox?: { x: number; y: number; width: number; height: number };
    isVisible: boolean;
    isInteractable: boolean;
  }> {

    if (dom.elements_map && typeof dom.elements_map === 'object') {
      return Object.values(dom.elements_map as Record<string, unknown>)
        .map((value) => this.normalizeElementInfo(value))
        .filter((item): item is NonNullable<typeof item> => item !== null);
    }

    return [];
  }

  private normalizeElementInfo(value: unknown): {
    tag: string;
    text?: string;
    bbox?: { x: number; y: number; width: number; height: number };
    isVisible: boolean;
    isInteractable: boolean;
  } | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const info = value as Record<string, unknown>;
    const tagCandidate = info.tagName ?? info.tag;
    if (typeof tagCandidate !== 'string' || tagCandidate.length === 0) {
      return null;
    }

    const bboxRaw = info.bbox;
    const bbox = this.normalizeBbox(bboxRaw);

    return {
      tag: tagCandidate,
      text: typeof info.text === 'string' ? info.text : undefined,
      bbox,
      isVisible: typeof info.isVisible === 'boolean' ? info.isVisible : true,
      isInteractable: typeof info.isInteractable === 'boolean' ? info.isInteractable : true,
    };
  }

  private normalizeBbox(
    value: unknown
  ): { x: number; y: number; width: number; height: number } | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const bbox = value as Record<string, unknown>;
    if (
      typeof bbox.x === 'number' &&
      typeof bbox.y === 'number' &&
      typeof bbox.width === 'number' &&
      typeof bbox.height === 'number'
    ) {
      return {
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
      };
    }

    return undefined;
  }

  protected parseAction(content: string): Action {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const action = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        const params = this.normalizeActionParams(action);
        const resolvedTarget = this.resolveTargetFromParams(params);
        this.applyResolvedTarget(params, resolvedTarget);
        return {
          type: this.normalizeActionType(action.type),
          params,
          reasoning: typeof action.reasoning === 'string' ? action.reasoning : undefined,
        };
      }

      return {
        type: 'wait',
        params: {},
        reasoning: '无法解析操作，等待下一步',
      };
    } catch (error) {
      console.error('Failed to parse action:', error);
      return {
        type: 'wait',
        params: {},
        reasoning: '解析错误，等待下一步',
      };
    }
  }

  protected normalizeActionParams(action: Record<string, unknown>): Record<string, unknown> {
    const params =
      action.params && typeof action.params === 'object'
        ? { ...(action.params as Record<string, unknown>) }
        : {};

    if (action.target !== undefined && params.target === undefined) {
      params.target = action.target;
    }

    if (action.value !== undefined && params.value === undefined) {
      params.value = action.value;
    }

    return params;
  }

  protected resolveTargetFromParams(params: Record<string, unknown>): ResolvedTarget | undefined {
    const targetId = this.coerceTargetId(params.target_id);
    const snapshotId = typeof params.snapshot_id === 'string' ? params.snapshot_id : undefined;
    if (targetId !== undefined) {
      return {
        format: 'target_id',
        target_id: targetId,
        snapshot_id: snapshotId,
      };
    }

    if (typeof params.selector === 'string' && params.selector.length > 0) {
      return {
        format: 'selector',
        selector: params.selector,
      };
    }

    const target = params.target;
    if (!target || typeof target !== 'object') {
      return undefined;
    }

    const targetRecord = target as Record<string, unknown>;
    const nestedTargetId = this.coerceTargetId(targetRecord.target_id);
    if (nestedTargetId !== undefined) {
      return {
        format: 'target_id',
        target_id: nestedTargetId,
        snapshot_id: typeof targetRecord.snapshot_id === 'string' ? targetRecord.snapshot_id : undefined,
      };
    }

    if (typeof targetRecord.selector === 'string' && targetRecord.selector.length > 0) {
      return {
        format: 'selector',
        selector: targetRecord.selector,
      };
    }

    return undefined;
  }

  protected applyResolvedTarget(
    params: Record<string, unknown>,
    resolvedTarget: ResolvedTarget | undefined
  ): void {
    if (!resolvedTarget) {
      return;
    }

    if (resolvedTarget.format === 'target_id') {
      params.target_id = resolvedTarget.target_id;
      if (resolvedTarget.snapshot_id) {
        params.snapshot_id = resolvedTarget.snapshot_id;
      }
    }

    if (resolvedTarget.format === 'selector') {
      params.selector = resolvedTarget.selector;
    }

    params.resolved_target = resolvedTarget;
  }

  private coerceTargetId(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private normalizeActionType(value: unknown): Action['type'] {
    if (
      value === 'click' ||
      value === 'type' ||
      value === 'scroll' ||
      value === 'wait' ||
      value === 'navigate' ||
      value === 'finish' ||
      value === 'mcp_call'
    ) {
      return value;
    }

    return 'wait';
  }

  abstract getApiEndpoint(): string;
  abstract getHeaders(): Record<string, string>;
  abstract getRequestBody(messages: any[], options: AxiosRequestConfig): any;

  async decideStream(
    context: DecisionContext,
    callbacks: {
      onToken?: (text: string) => void;
      onThinking?: (text: string) => void;
      onToolCall?: (call: unknown) => void;
      onUsage?: (usage: unknown) => void;
      onDone?: () => void;
    },
    signal?: AbortSignal
  ): Promise<void> {
    const { screenshot, dom, elements, instruction, previousActions, mcpTools } = context;

    try {
      const messages = this.buildMessages(
        dom,
        elements,
        instruction,
        previousActions,
        mcpTools,
        screenshot
      );

      const options: AxiosRequestConfig = {
        headers: this.getHeaders(),
        timeout: 30000,
        responseType: 'stream',
        signal,
        validateStatus: () => true, // Don't throw on error status codes
      };

      const requestBody = {
        ...this.getRequestBody(messages, options),
        stream: true,
      };

      // Ensure that stream is set to true even if getRequestBody didn't do it or we override it
      requestBody.stream = true;

      const response = await axios.post(this.getApiEndpoint(), requestBody, options);
      console.log(`[BaseDecisionClient] Stream response status: ${response.status}`);

      const processor = new StreamProcessor();
      await processor.processSSEStream(response as AxiosResponse, {
        onToken: callbacks.onToken || (() => {}),
        onThinking: callbacks.onThinking || (() => {}),
        onToolCall: callbacks.onToolCall || (() => {}),
        onUsage: callbacks.onUsage || (() => {}),
        onDone: callbacks.onDone || (() => {}),
      });
    } catch (error) {
      console.error(`${this.provider} Decision Stream API error:`, error);
      throw new Error(`${this.provider} Decision Stream API failed: ${(error as Error).message}`);
    }
  }
}
