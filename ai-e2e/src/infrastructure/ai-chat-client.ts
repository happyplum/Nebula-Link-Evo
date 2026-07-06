/**
 * AiChatClient — HTTP client for ai-chat-service (:3001).
 *
 * After the M2/M3 split, AI text generation, provider connectivity probes and
 * chat session management live in `ai-chat-service`. This client is the single
 * entry point ai-e2e uses to reach those endpoints.
 *
 * Endpoint contract (registered under both `/api/*` and `/api/v1/*` prefixes):
 *   - POST   /api/ai/generate       — plain text generation (decision model)
 *   - POST   /api/test-ai           — provider connectivity probe
 *   - GET    /api/verify-keys       — API key configuration status
 *   - POST   /api/chat/sessions     — create a chat session
 *   - GET    /api/chat/sessions/:id — fetch a chat session
 *   - POST   /api/chat/sessions/:id/messages — send a message
 *
 * Defaults to http://127.0.0.1:3001; overridable via `AI_CHAT_SERVICE_URL`
 * (legacy alias `AI_CHAT_URL`). An explicit empty string disables the client
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
      process.env.AI_CHAT_SERVICE_URL ?? process.env.AI_CHAT_URL,
      DEFAULT_AI_CHAT_SERVICE_URL,
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
   * Mirrors the legacy `ProxyAdapterClient.generateText()` contract so the
   * existing orchestration services keep working unchanged.
   */
  async generateText(
    prompt: string,
    options?: GenerateOptions,
  ): Promise<TextGenerationResult> {
    ensureConfigured(this.baseUrl, 'ai-chat-service not configured (AI_CHAT_SERVICE_URL is empty)');

    try {
      const response = await this.client.post<AiGenerateResponse>(
        '/api/ai/generate',
        {
          prompt,
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
        },
        this.getRequestConfig(this.aiTimeout),
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
        'AI generation failed',
      );
    }
  }

  /** Probe AI provider connectivity (POST /api/test-ai). */
  async testAi(): Promise<unknown> {
    ensureConfigured(this.baseUrl, 'ai-chat-service not configured (AI_CHAT_SERVICE_URL is empty)');

    try {
      const response = await this.client.post(
        '/api/test-ai',
        {},
        this.getRequestConfig(this.aiTimeout),
      );
      return response.data;
    } catch (error) {
      throw mapAxiosToServiceError(
        error,
        'ai-chat-service',
        'ai-chat-service test-ai request failed',
      );
    }
  }

  /** Verify API key configuration status (GET /api/verify-keys). */
  async verifyKeys(): Promise<unknown> {
    ensureConfigured(this.baseUrl, 'ai-chat-service not configured (AI_CHAT_SERVICE_URL is empty)');

    try {
      const response = await this.client.get(
        '/api/verify-keys',
        this.getRequestConfig(this.aiTimeout),
      );
      return response.data;
    } catch (error) {
      throw mapAxiosToServiceError(
        error,
        'ai-chat-service',
        'ai-chat-service verify-keys request failed',
      );
    }
  }

  /** Create a chat session (POST /api/chat/sessions). */
  async createChatSession(body: {
    provider: string;
    model: string;
    title?: string;
  }): Promise<unknown> {
    ensureConfigured(this.baseUrl, 'ai-chat-service not configured (AI_CHAT_SERVICE_URL is empty)');

    try {
      const response = await this.client.post(
        '/api/chat/sessions',
        body,
        this.getRequestConfig(this.aiTimeout),
      );
      return response.data;
    } catch (error) {
      throw mapAxiosToServiceError(
        error,
        'ai-chat-service',
        'ai-chat-service create-session request failed',
      );
    }
  }

  /** Fetch a chat session by id (GET /api/chat/sessions/:id). */
  async getChatSession(sessionId: string): Promise<unknown> {
    ensureConfigured(this.baseUrl, 'ai-chat-service not configured (AI_CHAT_SERVICE_URL is empty)');

    try {
      const response = await this.client.get(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
        this.getRequestConfig(this.aiTimeout),
      );
      return response.data;
    } catch (error) {
      throw mapAxiosToServiceError(
        error,
        'ai-chat-service',
        'ai-chat-service get-session request failed',
      );
    }
  }

  /** Send a message to a chat session (POST /api/chat/sessions/:id/messages). */
  async sendChatMessage(
    sessionId: string,
    body: { content: string },
  ): Promise<unknown> {
    ensureConfigured(this.baseUrl, 'ai-chat-service not configured (AI_CHAT_SERVICE_URL is empty)');

    try {
      const response = await this.client.post(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
        body,
        this.getRequestConfig(this.aiTimeout),
      );
      return response.data;
    } catch (error) {
      throw mapAxiosToServiceError(
        error,
        'ai-chat-service',
        'ai-chat-service send-message request failed',
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
