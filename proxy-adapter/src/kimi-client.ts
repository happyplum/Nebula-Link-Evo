import axios from 'axios';
import type {
  Action,
  ActionResult,
  DOMElement,
  SimplifiedDOM,
  UIElement,
} from './types.js';

export class KimiClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.KIMI_API_KEY || '';
    this.baseUrl = process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
    this.model = process.env.KIMI_MODEL || 'moonshot-v1-vision-preview';

    if (!this.apiKey) {
      console.warn('KIMI_API_KEY is not set. Kimi API calls will fail.');
    }
  }

  async analyze(
    screenshot: string,
    dom: SimplifiedDOM,
    elements: UIElement[],
    instruction: string,
    previousActions: ActionResult[] = []
  ): Promise<Action> {
    const prompt = this.buildPrompt(screenshot, dom, elements, instruction, previousActions);

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: this.getSystemPrompt(),
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 1000,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const content = response.data.choices[0]?.message?.content;
      return this.parseAction(content);
    } catch (error) {
      console.error('Kimi API error:', error);
      throw new Error(`Kimi API call failed: ${(error as Error).message}`);
    }
  }

  private getSystemPrompt(): string {
    return `你是一个网页自动化助手。你的任务是根据截图和DOM信息，决定下一步操作。

你可以执行以下操作：
1. click - 点击指定坐标或元素
2. type - 在输入框中输入文本
3. scroll - 滚动页面
4. wait - 等待页面加载
5. navigate - 导航到新URL
6. finish - 任务完成

返回格式必须是JSON：
{
  "type": "click",
  "params": { "x": 100, "y": 200 },
  "reasoning": "点击搜索按钮"
}`;
  }

  private buildPrompt(
    screenshot: string,
    dom: SimplifiedDOM,
    elements: UIElement[],
    instruction: string,
    previousActions: ActionResult[]
  ): Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
    const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
      {
        type: 'text',
        text: `请分析当前网页截图，完成以下任务：

**任务指令**: ${instruction}

**页面信息**:
- URL: ${dom.url}
- 标题: ${dom.title}
- 视口: ${dom.viewport.width}x${dom.viewport.height}

**检测到的UI元素** (${elements.length}个):
${elements
  .map(
    (el, i) =>
      `${i + 1}. [${el.type}] 坐标: (${Math.round(el.center[0])}, ${Math.round(el.center[1])}) 置信度: ${(el.confidence * 100).toFixed(1)}%`
  )
  .join('\n')}

**DOM中的可交互元素** (${dom.elements.length}个):
${dom.elements
  .slice(0, 10)
  .map(
    (el: DOMElement, i: number) =>
      `${i + 1}. [${el.tag}] ${el.text || el.placeholder || el.name || ''} (${Math.round(el.bbox?.x || 0)}, ${Math.round(el.bbox?.y || 0)})`
  )
  .join('\n')}

${previousActions.length > 0 ? `**已执行的操作**:\n${previousActions.map((a, i) => `${i + 1}. ${a.action.type}: ${JSON.stringify(a.action.params)}`).join('\n')}` : ''}

请返回下一步操作的JSON格式指令。`,
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${screenshot}`,
        },
      },
    ];

    return content;
  }

  private parseAction(content: string): Action {
    try {
      // 尝试提取JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const action = JSON.parse(jsonMatch[0]);
        return {
          type: action.type,
          params: action.params || {},
          reasoning: action.reasoning,
        };
      }

      // 如果解析失败，返回等待
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
}

export const kimiClient = new KimiClient();
