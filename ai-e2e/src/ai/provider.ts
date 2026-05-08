import crypto from 'crypto';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { generateText as sdkGenerateText, streamText as sdkStreamText } from 'ai';

export interface AIProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface TextGenerationResult {
  text: string;
  tokenUsage: { promptTokens: number; completionTokens: number };
}

export interface StreamOptions {
  temperature?: number;
  onChunk?: (text: string) => void;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
}

export class AIProvider {
  private model: LanguageModel | null = null;
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    const { provider, apiKey, baseUrl } = this.config;

    let resolvedApiKey = apiKey;
    let resolvedBaseUrl = baseUrl;

    if (provider === 'glm') {
      resolvedApiKey = generateGLMJWT(apiKey);
      resolvedBaseUrl = resolvedBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4';
    }

    const compatible = createOpenAICompatible({
      name: provider,
      baseURL: resolvedBaseUrl ?? '',
      apiKey: resolvedApiKey,
    });

    this.model = compatible.languageModel(this.config.model) as unknown as LanguageModel;
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<TextGenerationResult> {
    const model = this.getModel();

    const result = await sdkGenerateText({
      model: model as never,
      prompt,
      temperature: options?.temperature,
      maxOutputTokens: options?.maxTokens,
    });

    return {
      text: result.text,
      tokenUsage: {
        promptTokens: result.usage.inputTokens ?? 0,
        completionTokens: result.usage.outputTokens ?? 0,
      },
    };
  }

  async streamText(prompt: string, options?: StreamOptions): Promise<TextGenerationResult> {
    const model = this.getModel();

    const result = sdkStreamText({
      model: model as never,
      prompt,
      temperature: options?.temperature,
    });

    let fullText = '';
    for await (const chunk of result.textStream) {
      fullText += chunk;
      options?.onChunk?.(chunk);
    }

    const usage = await result.usage;

    return {
      text: fullText,
      tokenUsage: {
        promptTokens: usage.inputTokens ?? 0,
        completionTokens: usage.outputTokens ?? 0,
      },
    };
  }

  getModel(): LanguageModel {
    if (!this.model) {
      throw new Error('AIProvider not initialized. Call initialize() first.');
    }
    return this.model;
  }
}

/**
 * Generate a JWT token from a GLM API key (format: id.secret).
 */
function generateGLMJWT(apiKey: string): string {
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
