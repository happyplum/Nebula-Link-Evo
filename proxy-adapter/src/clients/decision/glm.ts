import crypto from 'crypto';
import { Action, UIElement, DOMSnapshotResponse, ActionResult } from '../../config/schema.js';
import { MCPTool } from '../types.js';
import { BaseDecisionClient, BaseDecisionConfig } from './base-impl.js';

export interface GLMDecisionConfig extends BaseDecisionConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  capabilities?: Array<'vision' | 'decision'>;
  temperature?: number;
  maxTokens?: number;
}

function generateJWTToken(apiKey: string): string {
  const parts = apiKey.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid GLM API key format. Expected format: id.secret');
  }
  const [id, secret] = parts;
  const header = { alg: 'HS256', sign_type: 'SIGN' };
  const payload = {
    api_key: id,
    exp: Math.floor(Date.now() / 1000) + 3600,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
  return `${base64Header}.${base64Payload}.${signature}`;
}

export class GLMDecisionClient extends BaseDecisionClient {
  provider = 'glm';
  supportsMultimodal = true;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;
  private modelCapabilities: Set<'vision' | 'decision'>;

  constructor(config: GLMDecisionConfig) {
    super(config);
    this.modelCapabilities = new Set(config.capabilities ?? []);
  }

  protected getToken(): string {
    if (this.cachedToken && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }
    this.cachedToken = generateJWTToken(this.apiKey);
    this.tokenExpiry = Date.now() + 55 * 60 * 1000;
    return this.cachedToken;
  }

  protected buildMessages(
    dom: DOMSnapshotResponse,
    elements: UIElement[],
    instruction: string,
    _previousActions: ActionResult[],
    mcpTools: MCPTool[] | undefined,
    screenshot: string
  ): any[] {
    const systemPrompt = this.getGLMSystemPrompt(mcpTools);
    const hasScreenshot: boolean = !!(screenshot && screenshot.length > 0);
    console.log(
      `[GLM] Building messages, hasScreenshot: ${hasScreenshot}, screenshot length: ${screenshot?.length || 0}`
    );
    const userPrompt = this.buildGLMPrompt(dom, elements, instruction, mcpTools, hasScreenshot);

    // 构建用户消息内容
    let userContent: any[];
    if (hasScreenshot) {
      // 多模态消息：文本 + 图片
      userContent = [
        { type: 'text', text: userPrompt },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${screenshot}` },
        },
      ];
    } else {
      // 纯文本消息
      userContent = [{ type: 'text', text: userPrompt }];
    }

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];
  }

  protected getGLMSystemPrompt(mcpTools?: MCPTool[]): string {
    let prompt = `你是一个浏览器自动化助手。请根据当前页面信息决定下一步操作。

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

可用的MCP工具 (server名称固定为 "browser-control"):
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

请返回JSON格式：
{
  "action": "click|type|scroll|finish|mcp_call",
  "target": "元素ID或坐标",
  "value": "输入文本（type时需要）",
  "reasoning": "你的思考过程"
}

如果是mcp_call操作，必须使用以下格式：
{
  "action": "mcp_call",
  "server": "browser-control",
  "tool": "工具名称",
  "args": {},
  "reasoning": "调用原因"
}

要求：
1. action必须是上述几种之一
2. click时，target填写元素ID
3. type时，target填写元素ID，value填写输入内容
4. scroll时，target填写up/down
5. finish表示任务完成
6. mcp_call时，server必须填写"browser-control"，tool填写工具名称
7. 只返回JSON，不要有其他内容`;

    return prompt;
  }

  protected buildGLMPrompt(
    dom: DOMSnapshotResponse,
    elements: UIElement[],
    instruction: string,
    mcpTools?: MCPTool[],
    hasScreenshot: boolean = false
  ): string {
    const domLike = dom as unknown as {
      snapshot_id?: string;
      version?: string;
      url?: string;
      elements_map?: unknown;
      elements?: unknown;
    };
    const domElements = this.extractDomElements(domLike);
    const snapshotId = domLike.snapshot_id ?? domLike.url ?? 'unknown';
    const version = domLike.version ?? 'legacy';

    const elementsSummary =
      elements.length > 0
        ? elements
            .map(
              (el: UIElement) =>
                `ID:${el.id} Type:${el.type} Text:${el.text || 'N/A'} Pos:${el.bbox?.join(',')}`
            )
            .join('\n')
        : '无检测到的UI元素';

    const domElementsSummary =
      domElements.length > 0
        ? domElements
            .slice(0, 10)
            .map(
              (el, i) =>
                `${i + 1}. [${el.tag}] ${el.text || ''} ${el.bbox ? `坐标: (${Math.round(el.bbox.x)}, ${Math.round(el.bbox.y)})` : ''}`
            )
            .join('\n')
        : '无可用DOM元素';

    let prompt = `任务：${instruction}

页面信息：
- Snapshot ID: ${snapshotId}
- 视图版本: ${version}
- 标记截图: 已包含红色数字标记

${hasScreenshot ? '**已提供页面截图，请直接分析截图内容**' : '**未提供截图**'}

DOM中的可交互元素 (${domElements.length}个):
${domElementsSummary}

视觉检测到的UI元素 (${elements.length}个):
${elementsSummary}`;

    if (mcpTools && mcpTools.length > 0) {
      prompt += `

可用的MCP工具 (优先使用这些工具进行浏览器操作):
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

    return prompt;
  }

  protected parseAction(content: string): Action {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { type: 'wait', params: { delay: 2000 }, reasoning: '无法解析操作，等待' };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.action === 'mcp_call' || parsed.type === 'mcp_call') {
        let server: string | undefined;
        let tool: string | undefined;
        let args: Record<string, unknown> | undefined;

        if (parsed.params) {
          server = parsed.params.server;
          tool = parsed.params.tool;
          args = parsed.params.args || {};
        } else if (parsed.target) {
          server = parsed.target.server;
          tool = parsed.target.tool;
          args = parsed.target.args || {};
        } else {
          server = parsed.server;
          tool = parsed.tool;
          args = parsed.args || {};
        }

        if (tool && tool.includes('.')) {
          const parts = tool.split('.');
          if (parts.length >= 2) {
            tool = parts.pop() || tool;
          }
        }

        server = (server || 'browser-control').replace(/_/g, '-');

        return {
          type: 'mcp_call',
          params: {
            server: server || 'browser-control',
            tool: tool || 'browser_snapshot',
            args: args || {},
          },
          reasoning: parsed.reasoning,
        };
      }

      const params = this.normalizeActionParams(parsed);
      params.delay = 2000;
      this.applyResolvedTarget(params, this.resolveTargetFromParams(params));

      return {
        type: parsed.action || parsed.type || 'wait',
        params,
      };
    } catch (error) {
      console.error('Failed to parse GLM action:', error);
      return {
        type: 'wait',
        params: { delay: 2000 },
        reasoning: '解析错误，等待',
      };
    }
  }

  getApiEndpoint(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.getToken()}`,
      'Content-Type': 'application/json',
    };
  }

  getRequestBody(messages: any[], options?: any): any {
    let processedMessages = messages;
    if (!this.isVisionCapableModel()) {
      processedMessages = this.convertToTextOnlyMessages(messages);
      processedMessages = this.rebuildSystemInstructions(processedMessages);
      processedMessages = this.ensureValidTextMessages(processedMessages);
    }

    return {
      model: this.model,
      messages: processedMessages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: options?.stream || false,
    };
  }

  private isVisionCapableModel(): boolean {
    if (this.modelCapabilities.has('vision')) {
      return true;
    }
    const normalizedModel = this.model.trim().toLowerCase();
    const knownVisionModelPattern = /^glm-\d+(?:\.\d+)?v(?:$|[-_].*)/;
    return knownVisionModelPattern.test(normalizedModel);
  }

  private convertToTextOnlyMessages(
    messages: Array<{ role: string; content: unknown }>
  ): Array<{ role: string; content: string }> {
    return messages.map((message) => ({
      role: message.role,
      content: this.normalizeContentToText(message.content),
    }));
  }

  private normalizeContentToText(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part || typeof part !== 'object') {
            return '';
          }
          const candidate = part as { type?: unknown; text?: unknown };
          if (candidate.type === 'text' && typeof candidate.text === 'string') {
            return candidate.text;
          }
          return '';
        })
        .filter((part) => part.length > 0)
        .join('\n');
    }
    if (content == null) {
      return '';
    }
    return String(content);
  }

  private rebuildSystemInstructions(
    messages: Array<{ role: string; content: string }>
  ): Array<{ role: string; content: string }> {
    const systemContent = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content.trim())
      .filter((content) => content.length > 0)
      .join('\n\n');
    const nonSystemMessages = messages.filter((message) => message.role !== 'system');
    if (systemContent.length === 0) {
      return nonSystemMessages;
    }
    const firstUserIndex = nonSystemMessages.findIndex((message) => message.role === 'user');
    if (firstUserIndex >= 0) {
      const firstUser = nonSystemMessages[firstUserIndex];
      const updatedFirstUser = {
        ...firstUser,
        content: `[System Instructions]\n${systemContent}\n\n[User Query]\n${firstUser.content}`,
      };
      return nonSystemMessages.map((message, index) =>
        index === firstUserIndex ? updatedFirstUser : message
      );
    }
    return [{ role: 'user', content: `[System Instructions]\n${systemContent}` }, ...nonSystemMessages];
  }

  private ensureValidTextMessages(
    messages: Array<{ role: string; content: string }>
  ): Array<{ role: string; content: string }> {
    const normalized = messages.map((message) => ({
      ...message,
      content: message.content.trim() === '' ? ' ' : message.content,
    }));
    if (normalized.length > 0) {
      return normalized;
    }
    return [{ role: 'user', content: 'hello' }];
  }
}
