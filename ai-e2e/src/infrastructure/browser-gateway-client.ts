/**
 * BrowserGatewayClient — HTTP client for the proxy-adapter browser gateway (:3000).
 *
 * After the M2/M3 split, proxy-adapter is a pure browser-control + MCP gateway:
 * it owns Playwright orchestration, the debug DOM/screenshot endpoints, the
 * LiveKit token route and the MCP Server (StreamableHTTP). This client covers
 * the browser/debug HTTP surface ai-e2e needs for site exploration and login
 * recording.
 *
 * Endpoint contract (all under /debug/api/*):
 *   - POST /debug/api/playwright/navigate
 *   - GET  /debug/api/dom
 *   - POST /debug/api/playwright/click
 *   - POST /debug/api/playwright/click-by-selector
 *   - POST /debug/api/playwright/type
 *   - GET  /debug/api/playwright/screenshot
 *   - POST /debug/api/playwright/execute-script
 *   - GET  /debug/api/playwright/cookies
 *   - GET  /debug/api/playwright/local-storage
 *   - GET  /debug/api/playwright/status
 *   - GET  /debug/api/health
 *   - POST /debug/api/playwright/open
 *   - POST /debug/api/playwright/close
 *
 * Defaults to http://127.0.0.1:3000; overridable via `PROXY_ADAPTER_URL`
 * (unchanged from the legacy contract). An explicit empty string disables the
 * client and browser-dependent routes degrade to 503.
 */
import type { AxiosInstance } from 'axios';
import { ServiceError } from '../services/service-error.js';
import {
  buildRequestHeaders,
  createJsonClient,
  ensureConfigured,
  extractServerMessage,
  mapAxiosToServiceError,
  resolveBaseUrl,
  type ClientHeaderOptions,
} from './http-client-helpers.js';

export interface BrowserGatewayClientConfig extends ClientHeaderOptions {
  baseUrl?: string;
  /** Timeout for Playwright / debug requests (ms). */
  playwrightTimeout?: number;
}

interface DebugSuccessEnvelope {
  success?: boolean;
  error?: string;
}

const DEFAULT_PROXY_ADAPTER_URL = 'http://127.0.0.1:3000';
const DEFAULT_PLAYWRIGHT_TIMEOUT_MS = 10_000;

export class BrowserGatewayClient {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string | null;
  private readonly projectId?: string;
  private readonly playwrightTimeout: number;

  constructor(config: BrowserGatewayClientConfig = {}) {
    this.baseUrl = resolveBaseUrl(
      config.baseUrl,
      process.env.PROXY_ADAPTER_URL,
      DEFAULT_PROXY_ADAPTER_URL,
    );
    this.projectId = config.projectId;
    this.playwrightTimeout = config.playwrightTimeout ?? DEFAULT_PLAYWRIGHT_TIMEOUT_MS;
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
      '/debug/api/playwright/screenshot',
    );
    return { base64: response.screenshot ?? '' };
  }

  async executeScript(
    script: string,
    args?: unknown[],
  ): Promise<{ result: unknown }> {
    const response = await this.postDebug<{ result: unknown }>(
      '/debug/api/playwright/execute-script',
      args ? { script, args } : { script },
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
      '/debug/api/playwright/local-storage',
    );
    return { data: response.data ?? {} };
  }

  async getPageInfo(): Promise<{ url: string; title: string }> {
    const response = await this.getDebug<{ url?: string; title?: string }>(
      '/debug/api/playwright/status',
    );
    return {
      url: response.url ?? '',
      title: response.title ?? '',
    };
  }

  async getDOM(): Promise<{ html: string }> {
    const result = await this.executeScript('document.documentElement.outerHTML');
    return {
      html: typeof result.result === 'string' ? result.result : String(result.result ?? ''),
    };
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
    ensureConfigured(this.baseUrl, 'proxy-adapter not configured (PROXY_ADAPTER_URL is empty)');

    try {
      const response = await this.client.get<DebugSuccessEnvelope & T>(
        path,
        this.getRequestConfig(this.playwrightTimeout),
      );
      return this.unwrapDebugEnvelope(response.data);
    } catch (error) {
      throw mapAxiosToServiceError(
        error,
        'proxy-adapter',
        'proxy-adapter Playwright request failed',
      );
    }
  }

  private async postDebug<T extends object>(path: string, body?: object): Promise<T> {
    ensureConfigured(this.baseUrl, 'proxy-adapter not configured (PROXY_ADAPTER_URL is empty)');

    try {
      const response = await this.client.post<DebugSuccessEnvelope & T>(
        path,
        body,
        this.getRequestConfig(this.playwrightTimeout),
      );
      return this.unwrapDebugEnvelope(response.data);
    } catch (error) {
      throw mapAxiosToServiceError(
        error,
        'proxy-adapter',
        'proxy-adapter Playwright request failed',
      );
    }
  }

  private unwrapDebugEnvelope<T extends object>(data: DebugSuccessEnvelope & T): T {
    if (data.success === false) {
      throw ServiceError.internal(
        extractServerMessage({ response: { data } }, 'proxy-adapter Playwright request failed'),
      );
    }
    return data;
  }

  private getRequestConfig(timeout: number) {
    return {
      timeout,
      headers: buildRequestHeaders({ projectId: this.projectId }),
    };
  }
}
