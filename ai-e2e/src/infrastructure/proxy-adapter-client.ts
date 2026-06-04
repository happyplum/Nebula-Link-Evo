import crypto from 'node:crypto';
import axios, { type AxiosInstance, isAxiosError } from 'axios';
import { ServiceError } from '../services/service-error.js';

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface TextGenerationResult {
  text: string;
  tokenUsage: { promptTokens: number; completionTokens: number };
}

export interface ProxyAdapterClientConfig {
  baseUrl?: string;
  projectId?: string;
  timeout?: number;
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

interface ProxyAdapterErrorResponse {
  error?: string;
}

interface DebugSuccessEnvelope {
  success?: boolean;
  error?: string;
}

const DEFAULT_PROXY_ADAPTER_URL = 'http://localhost:3000';
const DEFAULT_AI_TIMEOUT_MS = 300_000;
const DEFAULT_PLAYWRIGHT_TIMEOUT_MS = 10_000;

export class ProxyAdapterClient {
  private readonly client: AxiosInstance;

  private readonly baseUrl: string | null;

  private readonly projectId?: string;

  private readonly aiTimeout: number;

  private readonly playwrightTimeout: number;

  constructor(config: ProxyAdapterClientConfig = {}) {
    this.baseUrl = resolveBaseUrl(config.baseUrl);
    this.projectId = config.projectId;
    this.aiTimeout = config.timeout ?? DEFAULT_AI_TIMEOUT_MS;
    this.playwrightTimeout = config.timeout ?? DEFAULT_PLAYWRIGHT_TIMEOUT_MS;
    this.client = axios.create({
      baseURL: this.baseUrl ?? undefined,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async generateText(
    prompt: string,
    options?: GenerateOptions
  ): Promise<TextGenerationResult> {
    this.ensureConfigured();

    try {
      const response = await this.client.post<AiGenerateResponse>(
        '/api/ai/generate',
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
      throw this.mapAiError(error);
    }
  }

  async navigate(url: string): Promise<{ success: boolean; url: string }> {
    await this.postDebug('/debug/api/playwright/navigate', { url });
    return { success: true, url };
  }

  async getSnapshot(): Promise<{
    elements: Record<string, unknown>;
    screenshot?: string;
  }> {
    const response = await this.getDebug<{
      dom?: {
        elements_map?: Record<string, unknown>;
        annotated_screenshot_base64?: string;
      };
    }>('/debug/api/dom');

    return {
      elements: response.dom?.elements_map ?? {},
      screenshot: response.dom?.annotated_screenshot_base64,
    };
  }

  async click(x: number, y: number): Promise<{ success: boolean }> {
    await this.postDebug('/debug/api/playwright/click', { x, y });
    return { success: true };
  }

  async clickBySelector(selector: string): Promise<{ success: boolean }> {
    await this.postDebug('/debug/api/playwright/click-by-selector', { selector });
    return { success: true };
  }

  async type(selector: string, text: string): Promise<{ success: boolean }> {
    await this.postDebug('/debug/api/playwright/type', { selector, text });
    return { success: true };
  }

  async screenshot(): Promise<{ base64: string }> {
    const response = await this.getDebug<{ screenshot?: string }>(
      '/debug/api/playwright/screenshot'
    );
    return { base64: response.screenshot ?? '' };
  }

  async executeScript(
    script: string,
    args?: unknown[]
  ): Promise<{ result: unknown }> {
    const response = await this.postDebug<{ result: unknown }>(
      '/debug/api/playwright/execute-script',
      args ? { script, args } : { script }
    );
    return { result: response.result };
  }

  async getCookies(): Promise<{
    cookies: Array<{ name: string; value: string; domain: string }>;
  }> {
    const response = await this.getDebug<{
      cookies?: Array<{ name: string; value: string; domain: string }>;
    }>('/debug/api/playwright/cookies');
    return { cookies: response.cookies ?? [] };
  }

  async getLocalStorage(): Promise<{ data: Record<string, string> }> {
    const response = await this.getDebug<{ data?: Record<string, string> }>(
      '/debug/api/playwright/local-storage'
    );
    return { data: response.data ?? {} };
  }

  async getPageInfo(): Promise<{ url: string; title: string }> {
    const response = await this.getDebug<{ url?: string; title?: string }>(
      '/debug/api/playwright/status'
    );
    return {
      url: response.url ?? '',
      title: response.title ?? '',
    };
  }

  async getDOM(): Promise<{ html: string }> {
    const result = await this.executeScript('document.documentElement.outerHTML');
    return { html: typeof result.result === 'string' ? result.result : String(result.result ?? '') };
  }

  async healthCheck(): Promise<boolean> {
    if (!this.baseUrl) {
      return false;
    }

    try {
      const response = await this.client.get<{
        services?: {
          playwright?: {
            status?: string;
          };
        };
      }>('/debug/api/health', this.getRequestConfig(this.playwrightTimeout));

      return response.data.services?.playwright?.status === 'healthy';
    } catch {
      return false;
    }
  }

  async openBrowser(): Promise<{ success: boolean }> {
    await this.postDebug('/debug/api/playwright/open');
    return { success: true };
  }

  async closeBrowser(): Promise<{ success: boolean }> {
    await this.postDebug('/debug/api/playwright/close');
    return { success: true };
  }

  private async getDebug<T extends object>(path: string): Promise<T> {
    this.ensureConfigured();

    try {
      const response = await this.client.get<DebugSuccessEnvelope & T>(
        path,
        this.getRequestConfig(this.playwrightTimeout)
      );
      return this.unwrapDebugEnvelope(response.data);
    } catch (error) {
      throw this.mapPlaywrightError(error);
    }
  }

  private async postDebug<T extends object>(path: string, body?: object): Promise<T> {
    this.ensureConfigured();

    try {
      const response = await this.client.post<DebugSuccessEnvelope & T>(
        path,
        body,
        this.getRequestConfig(this.playwrightTimeout)
      );
      return this.unwrapDebugEnvelope(response.data);
    } catch (error) {
      throw this.mapPlaywrightError(error);
    }
  }

  private unwrapDebugEnvelope<T extends object>(data: DebugSuccessEnvelope & T): T {
    if (data.success === false) {
      throw ServiceError.internal(data.error || 'proxy-adapter Playwright request failed');
    }

    return data;
  }

  private getRequestConfig(timeout: number) {
    return {
      timeout,
      headers: this.getHeaders(),
    };
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'x-request-id': crypto.randomUUID(),
    };

    if (this.projectId) {
      headers['x-project-id'] = this.projectId;
    }

    return headers;
  }

  private ensureConfigured(): string {
    if (!this.baseUrl) {
      throw ServiceError.internal('proxy-adapter not configured (PROXY_ADAPTER_URL is empty)');
    }

    return this.baseUrl;
  }

  private mapAiError(error: unknown): ServiceError {
    if (error instanceof ServiceError) {
      return error;
    }

    if (isAxiosError(error)) {
      if (error.request == null) {
        return ServiceError.internal('proxy-adapter AI request failed');
      }

      if (error.response == null) {
        const detail = error.code ? ` (code: ${error.code})` : '';
        return ServiceError.internal(`proxy-adapter unreachable${detail}`);
      }

      const status = error.response.status;
      const message = this.extractErrorMessage(error, 'proxy-adapter AI request failed');

      if (status === 502) {
        return ServiceError.internal('AI generation failed');
      }

      return this.mapHttpStatusToServiceError(status, message);
    }

    return ServiceError.internal(error instanceof Error ? error.message : 'proxy-adapter AI request failed');
  }

  private mapPlaywrightError(error: unknown): ServiceError {
    if (error instanceof ServiceError) {
      return error;
    }

    if (isAxiosError(error)) {
      if (error.request == null) {
        return ServiceError.internal('proxy-adapter Playwright request failed');
      }

      if (error.response == null) {
        const detail = error.code ? ` (code: ${error.code})` : '';
        return ServiceError.internal(`proxy-adapter unreachable${detail}`);
      }

      const status = error.response.status;
      const message = this.extractErrorMessage(error, 'proxy-adapter Playwright request failed');
      return this.mapHttpStatusToServiceError(status, message);
    }

    return ServiceError.internal(
      error instanceof Error ? error.message : 'proxy-adapter Playwright request failed'
    );
  }

  private mapHttpStatusToServiceError(status: number, message: string): ServiceError {
    switch (status) {
      case 400: return ServiceError.validation(message);
      case 401: return ServiceError.unauthorized(message);
      case 403: return ServiceError.forbidden(message);
      case 404: return ServiceError.notFound(message);
      case 409: return ServiceError.conflict(message);
      case 503: return ServiceError.internal('proxy-adapter unavailable');
      default: return ServiceError.internal(message);
    }
  }

  private extractErrorMessage(
    error: { response?: { data?: { error?: string } } },
    fallback: string
  ): string {
    const serverMessage = error.response?.data?.error;
    return serverMessage || fallback;
  }
}

function resolveBaseUrl(explicitBaseUrl?: string): string | null {
  if (explicitBaseUrl !== undefined) {
    return normalizeBaseUrl(explicitBaseUrl);
  }

  if (process.env.PROXY_ADAPTER_URL !== undefined) {
    return normalizeBaseUrl(process.env.PROXY_ADAPTER_URL);
  }

  return DEFAULT_PROXY_ADAPTER_URL;
}

function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, '');
}
