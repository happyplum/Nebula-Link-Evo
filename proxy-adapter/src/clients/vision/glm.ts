import axios from 'axios';
import crypto from 'crypto';
import { UIElement } from '../../config/schema.js';
import { VisionClient } from './base.js';

export interface GLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
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

export class GLMVisionClient implements VisionClient {
  provider = 'glm';
  model: string;
  capabilities = ['vision'];
  private apiKey: string;
  private baseUrl: string;
  private temperature: number;
  private maxTokens: number;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: GLMConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 2000;
  }

  getCapabilities(): string[] {
    return ['vision'];
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }
    this.cachedToken = await generateJWTToken(this.apiKey);
    this.tokenExpiry = Date.now() + 55 * 60 * 1000;
    return this.cachedToken;
  }

  async detect(
    screenshot: string,
    viewport: { width: number; height: number },
    options?: { instruction?: string }
  ): Promise<UIElement[]> {
    const instruction =
      options?.instruction ?? '识别页面中所有可交互的UI元素，包括按钮、输入框、链接、复选框等';

    try {
      const token = await this.getToken();
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: this.buildPrompt(instruction, viewport),
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${screenshot}`,
                  },
                },
              ],
            },
          ],
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const content = response.data.choices[0]?.message?.content;
      return this.parseResponse(content, viewport);
    } catch (error) {
      const err = error as any;
      const errMsg = err.response?.data?.error?.message || err.message || 'Unknown error';
      console.error(`[Vision] GLM API error: ${errMsg}`);
      throw new Error(errMsg);
    }
  }

  private buildPrompt(instruction: string, viewport: { width: number; height: number }): string {
    return `你是一个UI元素检测助手。请分析当前网页截图，${instruction}。

视口大小: ${viewport.width}x${viewport.height}

请返回JSON格式的检测结果:
{
  "elements": [
    {
      "id": 1,
      "type": "button|input|link|checkbox|radio|select|text|image|container",
      "text": "按钮上的文字或空",
      "bbox": [x, y, width, height],
      "confidence": 0.95,
      "description": "元素的简要描述"
    }
  ]
}

要求:
1. 只返回JSON，不要有其他内容
2. bbox是绝对坐标，基于视口左上角
3. confidence是0-1之间的置信度
4. type必须是支持的可交互元素类型`;
  }

  private parseResponse(content: string, _viewport: { width: number; height: number }): UIElement[] {
    try {
      const jsonStr = this.extractJson(content);
      if (!jsonStr) {
        console.warn('No JSON found in GLM response');
        return [];
      }

      const parsed = JSON.parse(jsonStr);
      const elements: UIElement[] = [];

      if (!parsed.elements || !Array.isArray(parsed.elements)) {
        console.warn('No elements array in GLM response');
        return [];
      }

      for (let i = 0; i < parsed.elements.length; i++) {
        const el = parsed.elements[i];
        const bbox = el.bbox || [0, 0, 100, 40];

        elements.push({
          id: el.id ?? i,
          type: this.mapElementType(el.type),
          text: el.text,
          placeholder: el.placeholder,
          bbox: [bbox[0] ?? 0, bbox[1] ?? 0, bbox[2] ?? 100, bbox[3] ?? 40],
          center: [(bbox[0] ?? 0) + (bbox[2] ?? 100) / 2, (bbox[1] ?? 0) + (bbox[3] ?? 40) / 2],
          confidence: el.confidence ?? 0.8,
          description: el.description,
        });
      }

      return elements;
    } catch (error) {
      console.error('Failed to parse GLM response:', error);
      return [];
    }
  }

  private extractJson(content: string): string | null {
    const start = content.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < content.length; i++) {
      const char = content[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            return content.slice(start, i + 1);
          }
        }
      }
    }

    return null;
  }

  private mapElementType(type: string): UIElement['type'] {
    const typeMap: Record<string, UIElement['type']> = {
      button: 'button',
      btn: 'button',
      input: 'input',
      text: 'input',
      link: 'link',
      a: 'link',
      checkbox: 'checkbox',
      radio: 'radio',
      select: 'select',
      dropdown: 'select',
      textarea: 'input',
      image: 'image',
      img: 'image',
      container: 'container',
      div: 'container',
      span: 'container',
    };

    const normalizedType = (type || '').toLowerCase().trim();
    return typeMap[normalizedType] || 'other';
  }
}
