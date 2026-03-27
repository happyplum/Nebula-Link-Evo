import axios from 'axios';
import { UIElement } from '../../config/schema.js';
import { VisionClient } from './base.js';

export interface AnthropicVisionConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export class AnthropicVisionClient implements VisionClient {
  provider = 'anthropic';
  model: string;
  capabilities = ['vision'];
  private apiKey: string;
  private baseUrl: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: AnthropicVisionConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 1000;
  }

  getCapabilities(): string[] {
    return ['vision'];
  }

  async detect(
    screenshot: string,
    viewport: { width: number; height: number },
    options?: { instruction?: string }
  ): Promise<UIElement[]> {
    const instruction =
      options?.instruction ?? '识别页面中所有可交互的UI元素，包括按钮、输入框、链接、复选框等';

    try {
      const response = await axios.post(
        `${this.baseUrl}/messages`,
        {
          model: this.model,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: this.buildPrompt(instruction, viewport),
                },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: screenshot,
                  },
                },
              ],
            },
          ],
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const content = response.data.content?.[0]?.text;
      return this.parseResponse(content, viewport);
    } catch (error) {
      console.error('Anthropic Vision API error:', error);
      throw new Error(`Anthropic Vision API failed: ${(error as Error).message}`);
    }
  }

  private buildPrompt(instruction: string, viewport: { width: number; height: number }): string {
    return `你是一个UI元素检测助手。请分析当前网页截图，${instruction}。

视口大小: ${viewport.width}x${viewport.height}

请返回JSON格式的检测结果:
{"elements": [{"id": 1, "type": "button|input|link|checkbox|radio|select|text|image|container", "text": "按钮上的文字", "bbox": [x, y, width, height], "confidence": 0.95}]}

要求:
1. 只返回JSON，不要有其他内容
2. bbox是绝对坐标
3. confidence是0-1之间的置信度`;
  }

  private parseResponse(content: string, _viewport: { width: number; height: number }): UIElement[] {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const elements: UIElement[] = [];

      if (!parsed.elements || !Array.isArray(parsed.elements)) {
        return [];
      }

      for (let i = 0; i < parsed.elements.length; i++) {
        const el = parsed.elements[i];
        const bbox = el.bbox || [0, 0, 100, 40];

        elements.push({
          id: el.id ?? i,
          type: this.mapElementType(el.type),
          text: el.text,
          bbox: [bbox[0] ?? 0, bbox[1] ?? 0, bbox[2] ?? 100, bbox[3] ?? 40],
          center: [(bbox[0] ?? 0) + (bbox[2] ?? 100) / 2, (bbox[1] ?? 0) + (bbox[3] ?? 40) / 2],
          confidence: el.confidence ?? 0.8,
        });
      }

      return elements;
    } catch (error) {
      console.error('Failed to parse Anthropic response:', error);
      return [];
    }
  }

  private mapElementType(type: string): UIElement['type'] {
    const typeMap: Record<string, UIElement['type']> = {
      button: 'button',
      input: 'input',
      link: 'link',
      checkbox: 'checkbox',
      radio: 'radio',
      select: 'select',
      image: 'image',
      container: 'container',
    };
    return typeMap[(type || '').toLowerCase()] || 'other';
  }
}
