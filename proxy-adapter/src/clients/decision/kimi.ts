import { BaseDecisionClient, BaseDecisionConfig } from './base-impl.js';

export interface KimiDecisionConfig extends BaseDecisionConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export class KimiDecisionClient extends BaseDecisionClient {
  provider = 'kimi';

  constructor(config: KimiDecisionConfig) {
    super(config);
  }

  getApiEndpoint(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  getRequestBody(messages: any[], options?: any): any {
    return {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };
  }
}
