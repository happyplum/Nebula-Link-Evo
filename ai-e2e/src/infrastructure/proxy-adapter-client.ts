/**
 * ProxyAdapterClient — backward-compatible facade over the dual-backend client
 * layer.
 *
 * Historically ai-e2e reached a single backend (proxy-adapter) for both AI
 * generation and browser control. After the ai-chat-service split (M2/M3), AI
 * generation moved to `ai-chat-service` (:3001) while browser control stayed
 * on `proxy-adapter` (:3000).
 *
 * To keep the existing orchestration services and their tests stable, this
 * class preserves the original unified public API but delegates each call to
 * the appropriate client:
 *   - `generateText()`            → AiChatClient (:3001)
 *   - all browser/debug methods   → BrowserGatewayClient (:3000)
 *
 * New code SHOULD depend on `AiChatClient` or `BrowserGatewayClient` directly
 * when it only needs one backend. The facade exists so services that genuinely
 * use both (e.g. ExplorerService, which defines an ExplorerRuntimeClient that
 * combines AI + browser) keep a single injection point.
 */
import { AiChatClient, type GenerateOptions, type TextGenerationResult } from './ai-chat-client.js';
import { BrowserGatewayClient } from './browser-gateway-client.js';

export type { GenerateOptions, TextGenerationResult };

export interface ProxyAdapterClientConfig {
  /** Base URL for ai-chat-service (:3001). When omitted, reads AI_CHAT_SERVICE_URL / AI_CHAT_URL. */
  aiChatBaseUrl?: string;
  /** Base URL for proxy-adapter browser gateway (:3000). When omitted, reads PROXY_ADAPTER_URL. */
  browserGatewayBaseUrl?: string;
  /** Legacy single timeout applied to both AI and Playwright requests. */
  timeout?: number;
  /** Timeout for AI text generation requests (ms). */
  aiTimeout?: number;
  /** Timeout for Playwright / debug requests (ms). */
  playwrightTimeout?: number;
  projectId?: string;
}

export class ProxyAdapterClient {
  private readonly aiChat: AiChatClient;
  private readonly browserGateway: BrowserGatewayClient;

  constructor(config: ProxyAdapterClientConfig = {}) {
    this.aiChat = new AiChatClient({
      baseUrl: config.aiChatBaseUrl,
      aiTimeout: config.aiTimeout ?? config.timeout,
      projectId: config.projectId,
    });
    this.browserGateway = new BrowserGatewayClient({
      baseUrl: config.browserGatewayBaseUrl,
      playwrightTimeout: config.playwrightTimeout ?? config.timeout,
      projectId: config.projectId,
    });
  }

  /** The underlying ai-chat-service client (:3001). */
  get aiChatClient(): AiChatClient {
    return this.aiChat;
  }

  /** The underlying browser-gateway client (:3000). */
  get browserGatewayClient(): BrowserGatewayClient {
    return this.browserGateway;
  }

  // ===== AI (ai-chat-service :3001) =====

  async generateText(
    prompt: string,
    options?: GenerateOptions,
  ): Promise<TextGenerationResult> {
    return this.aiChat.generateText(prompt, options);
  }

  // ===== Browser control (proxy-adapter :3000) =====

  async navigate(url: string): Promise<{ success: boolean; url: string }> {
    return this.browserGateway.navigate(url);
  }

  async getSnapshot(): Promise<{
    elements: Record<string, unknown>;
    screenshot?: string;
  }> {
    return this.browserGateway.getSnapshot();
  }

  async click(x: number, y: number): Promise<{ success: boolean }> {
    return this.browserGateway.click(x, y);
  }

  async clickBySelector(selector: string): Promise<{ success: boolean }> {
    return this.browserGateway.clickBySelector(selector);
  }

  async type(selector: string, text: string): Promise<{ success: boolean }> {
    return this.browserGateway.type(selector, text);
  }

  async screenshot(): Promise<{ base64: string }> {
    return this.browserGateway.screenshot();
  }

  async executeScript(
    script: string,
    args?: unknown[],
  ): Promise<{ result: unknown }> {
    return this.browserGateway.executeScript(script, args);
  }

  async getCookies(): Promise<{
    cookies: Array<{ name: string; value: string; domain: string }>;
  }> {
    return this.browserGateway.getCookies();
  }

  async getLocalStorage(): Promise<{ data: Record<string, string> }> {
    return this.browserGateway.getLocalStorage();
  }

  async getPageInfo(): Promise<{ url: string; title: string }> {
    return this.browserGateway.getPageInfo();
  }

  async getDOM(): Promise<{ html: string }> {
    return this.browserGateway.getDOM();
  }

  async healthCheck(): Promise<boolean> {
    return this.browserGateway.healthCheck();
  }

  async openBrowser(): Promise<{ success: boolean }> {
    return this.browserGateway.openBrowser();
  }

  async closeBrowser(): Promise<{ success: boolean }> {
    return this.browserGateway.closeBrowser();
  }
}
