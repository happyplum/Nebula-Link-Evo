/**
 * AiChatClient — HTTP client for ai-chat-service (:3001).
 *
 * This bounded client exposes only the stateless decision-model operation
 * used by ai-e2e business services.
 *
 * Endpoint contract uses only the canonical `/api/v1/*` surface.
 *
 * Defaults to http://127.0.0.1:3001; overridable via `AI_CHAT_SERVICE_URL`
 * An explicit empty string disables the client
 * and AI-dependent routes degrade to 503, mirroring the PROXY_ADAPTER_URL
 * convention used for the browser gateway.
 */
import type { AxiosInstance } from 'axios';
import { ServiceError } from '../services/service-error.js';
import {
  buildRequestHeaders,
  createJsonClient,
  ensureConfigured,
  mapAxiosToServiceError,
  resolveBaseUrl,
  type ClientHeaderOptions,
} from './http-client-helpers.js';

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface TextGenerationResult {
  text: string;
  tokenUsage: { promptTokens: number; completionTokens: number };
}

export interface AiChatClientConfig extends ClientHeaderOptions {
  baseUrl?: string;
  /** Timeout for AI text generation requests (ms). */
  aiTimeout?: number;
}

interface AiGenerateResponse {
  success: true;
  text: string;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
  model?: string;
}

const DEFAULT_AI_CHAT_SERVICE_URL = 'http://127.0.0.1:3001';
const DEFAULT_AI_TIMEOUT_MS = 300_000;

export class AiChatClient {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string | null;
  private readonly projectId?: string;
  private readonly aiTimeout: number;

  constructor(config: AiChatClientConfig = {}) {
    this.baseUrl = resolveBaseUrl(
      config.baseUrl,
      process.env.AI_CHAT_SERVICE_URL,
      DEFAULT_AI_CHAT_SERVICE_URL
    );
    this.projectId = config.projectId;
    this.aiTimeout = config.aiTimeout ?? DEFAULT_AI_TIMEOUT_MS;
    this.client = createJsonClient(this.baseUrl);
  }

  /** Returns the resolved base URL (null when unconfigured). */
  getBaseUrl(): string | null {
    return this.baseUrl;
  }

  /** Whether the client has a non-null base URL. */
  isConfigured(): boolean {
    return this.baseUrl !== null;
  }

  /**
   * Generate plain text with the configured decision model.
   * Generate plain text without creating a Harness session or exposing tools.
   */
  async generateText(prompt: string, options?: GenerateOptions): Promise<TextGenerationResult> {
    ensureConfigured(this.baseUrl, 'ai-chat-service not configured (AI_CHAT_SERVICE_URL is empty)');

    try {
      const response = await this.client.post<AiGenerateResponse>(
        '/api/v1/ai/generate',
        {
          prompt,
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
        },
        this.getRequestConfig(this.aiTimeout)
      );

      return {
        text: response.data.text,
        tokenUsage: {
          promptTokens: response.data.tokenUsage?.promptTokens ?? 0,
          completionTokens: response.data.tokenUsage?.completionTokens ?? 0,
        },
      };
    } catch (error) {
      throw mapAxiosToServiceError(
        error,
        'ai-chat-service',
        'ai-chat-service AI request failed',
        'AI generation failed'
      );
    }
  }

  private getRequestConfig(timeout: number) {
    return {
      timeout,
      headers: buildRequestHeaders({ projectId: this.projectId }),
    };
  }
}
