import axios, { type AxiosInstance, isAxiosError } from 'axios';

export interface PlaywrightClientConfig {
  baseUrl: string;
  timeout?: number;
}

export class PlaywrightClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isNetworkError: boolean = false
  ) {
    super(message);
    this.name = 'PlaywrightClientError';
  }
}

export class PlaywrightClient {
  private client: AxiosInstance;
  private static instance: PlaywrightClient | null = null;

  private constructor(config: PlaywrightClientConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  static getInstance(): PlaywrightClient {
    if (!PlaywrightClient.instance) {
      throw new PlaywrightClientError(
        'PlaywrightClient not initialized. Call PlaywrightClient.initialize() first.',
        undefined,
        true
      );
    }
    return PlaywrightClient.instance;
  }

  static initialize(config: PlaywrightClientConfig): PlaywrightClient {
    PlaywrightClient.instance = new PlaywrightClient(config);
    return PlaywrightClient.instance;
  }

  static resetInstance(): void {
    PlaywrightClient.instance = null;
  }

  private async wrapRequest<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.response) {
          throw new PlaywrightClientError(
            `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`,
            error.response.status,
            false
          );
        } else if (error.request) {
          throw new PlaywrightClientError(
            `Network error: ${error.message}`,
            undefined,
            true
          );
        }
      }
      throw new PlaywrightClientError(
        error instanceof Error ? error.message : 'Unknown error',
        undefined,
        false
      );
    }
  }

  async navigate(url: string): Promise<{ success: boolean; url: string }> {
    const response = await this.wrapRequest(() =>
      this.client.post('/browser/navigate', { url })
    );
    return {
      success: true,
      url: response.data.currentUrl || url,
    };
  }

  async getSnapshot(): Promise<{
    elements: Record<string, unknown>;
    screenshot?: string;
  }> {
    const response = await this.wrapRequest(() =>
      this.client.get('/dom/simplified')
    );
    return {
      elements: response.data.elements_map || {},
      screenshot: response.data.annotated_screenshot_base64,
    };
  }

  async click(selector: string): Promise<{ success: boolean }> {
    await this.wrapRequest(() =>
      this.client.post('/action/click-by-selector', { selector })
    );
    return { success: true };
  }

  async type(selector: string, text: string): Promise<{ success: boolean }> {
    await this.wrapRequest(() =>
      this.client.post('/action/type', { selector, text })
    );
    return { success: true };
  }

  async screenshot(): Promise<{ base64: string }> {
    const response = await this.wrapRequest(() =>
      this.client.post('/browser/screenshot', {
        fullPage: false,
        type: 'png',
      })
    );
    return { base64: response.data.screenshot || '' };
  }

  async executeScript(script: string): Promise<{ result: unknown }> {
    const response = await this.wrapRequest(() =>
      this.client.post('/dom/script', { script, args: [] })
    );
    return { result: response.data.result };
  }

  async getDOM(): Promise<{ html: string }> {
    const result = await this.executeScript(
      'document.documentElement.outerHTML'
    );
    return { html: String(result.result || '') };
  }

  async get_cookies(): Promise<{
    cookies: Array<{ name: string; value: string; domain: string }>;
  }> {
    const result = await this.executeScript(
      'document.cookie.split(";").map(c => { const [name, ...rest] = c.trim().split("="); return { name, value: rest.join("="), domain: window.location.hostname }; })'
    );
    return {
      cookies: (result.result as Array<{ name: string; value: string; domain: string }>) || [],
    };
  }

  async get_localStorage(): Promise<{ data: Record<string, string> }> {
    const result = await this.executeScript(
      '(() => { const data = {}; for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key) { data[key] = localStorage.getItem(key) || ""; } } return data; })()'
    );
    return { data: (result.result as Record<string, string>) || {} };
  }

  async getPageInfo(): Promise<{ url: string; title: string }> {
    const response = await this.wrapRequest(() =>
      this.client.get('/browser/status')
    );
    return {
      url: response.data.currentUrl || '',
      title: response.data.title || '',
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.wrapRequest(() => this.client.get('/health'));
      return response.data.status === 'healthy';
    } catch {
      return false;
    }
  }
}
