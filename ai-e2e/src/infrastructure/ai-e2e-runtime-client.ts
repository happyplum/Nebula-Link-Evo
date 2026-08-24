import { AiChatClient, type GenerateOptions, type TextGenerationResult } from './ai-chat-client.js';
import { BrowserGatewayClient } from './browser-gateway-client.js';

export type { GenerateOptions, TextGenerationResult };

export interface AiE2eRuntimeClientConfig {
  /** ai-chat-service loopback base URL. */
  aiChatBaseUrl?: string;
  /** proxy-adapter loopback base URL. */
  browserGatewayBaseUrl?: string;
  aiTimeout?: number;
  playwrightTimeout?: number;
  projectId?: string;
}

/** Explicit ai-e2e application boundary over the AI core and browser gateway. */
export class AiE2eRuntimeClient {
  private readonly aiChat: AiChatClient;
  private readonly browserGateway: BrowserGatewayClient;

  constructor(config: AiE2eRuntimeClientConfig = {}) {
    this.aiChat = new AiChatClient({
      baseUrl: config.aiChatBaseUrl,
      aiTimeout: config.aiTimeout,
      projectId: config.projectId,
    });
    this.browserGateway = new BrowserGatewayClient({
      baseUrl: config.browserGatewayBaseUrl,
      playwrightTimeout: config.playwrightTimeout,
      projectId: config.projectId,
    });
  }

  getServiceUrls(): { aiChat: string | null; browserGateway: string | null } {
    return {
      aiChat: this.aiChat.getBaseUrl(),
      browserGateway: this.browserGateway.getBaseUrl(),
    };
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<TextGenerationResult> {
    return this.aiChat.generateText(prompt, options);
  }

  async navigate(url: string): Promise<{ success: boolean; url: string }> {
    return this.browserGateway.navigate(url);
  }

  async getSnapshot(): Promise<{ elements: Record<string, unknown>; screenshot?: string }> {
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

  async executeScript(script: string, args?: unknown[]): Promise<{ result: unknown }> {
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
