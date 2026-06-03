import axios from 'axios';
import type { AxiosInstance } from 'axios';

export class PlaywrightClient {
  private client: AxiosInstance;

  constructor(baseUrl: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
    });
  }

  // ===== Browser lifecycle =====
  async openBrowser(opts?: {
    headless?: boolean;
    viewport?: { width: number; height: number };
    cdpPort?: number;
  }): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.post('/browser/open', opts ?? {});
      return data;
    });
  }

  async closeBrowser(): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.post('/browser/close');
      return data;
    });
  }

  async navigate(url: string, waitUntil?: string, timeout?: number): Promise<unknown> {
    return this.wrapError(async () => {
      const body: Record<string, unknown> = { url };
      if (waitUntil) body.waitUntil = waitUntil;
      if (timeout) body.timeout = timeout;
      const { data } = await this.client.post('/browser/navigate', body);
      return data;
    });
  }

  async getScreenshot(fullPage?: boolean): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.post('/browser/screenshot', {
        fullPage: fullPage ?? false,
      });
      return data;
    });
  }

  async getBrowserStatus(): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.get('/browser/status');
      return data;
    });
  }

  // ===== Tab management =====
  async listTabs(): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.get('/browser/tabs');
      return data;
    });
  }

  async switchTab(id: string): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.post('/browser/tabs/switch', { id });
      return data;
    });
  }

  // ===== Page interaction =====
  async click(x: number, y: number): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.post('/action/click', { x, y });
      return data;
    });
  }

  async clickBySelector(
    selector: string,
    options?: { button?: string; clickCount?: number; delay?: number }
  ): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.post('/action/click-by-selector', { selector, options });
      return data;
    });
  }

  async typeText(
    selector: string,
    text: string,
    options?: { delay?: number; clear?: boolean }
  ): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.post('/action/type', { selector, text, options });
      return data;
    });
  }

  async scroll(x: number, y: number): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.post('/action/scroll', { x, y });
      return data;
    });
  }

  async elementAction(selector: string, action: string, param?: unknown): Promise<unknown> {
    return this.wrapError(async () => {
      let endpoint: string;
      let body: Record<string, unknown>;

      switch (action) {
        case 'focus':
          endpoint = '/action/focus';
          body = { selector };
          break;
        case 'blur':
          endpoint = '/action/blur';
          body = { selector };
          break;
        case 'hover':
          endpoint = '/action/hover';
          body = { selector };
          break;
        case 'value':
          endpoint = '/action/value';
          body = { selector, value: param };
          break;
        case 'dispatch':
          endpoint = '/action/dispatch';
          body = { selector, eventType: param };
          break;
        default:
          endpoint = '/action/dispatch';
          body = { selector, eventType: action };
          break;
      }

      const { data } = await this.client.post(endpoint, body);
      return data;
    });
  }

  // ===== DOM =====
  async getDomSnapshot(): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.get('/dom/simplified');
      return data;
    });
  }

  async executeScript(script: string, args?: unknown[]): Promise<unknown> {
    return this.wrapError(async () => {
      const { data } = await this.client.post('/dom/script', { script, args });
      return data;
    });
  }

  async executeByMarker(
    snapshotId: string,
    nebulaId: number,
    action: string,
    param?: unknown
  ): Promise<unknown> {
    return this.wrapError(async () => {
      const body: Record<string, unknown> = {
        snapshot_id: snapshotId,
        nebula_id: nebulaId,
        action,
      };
      if (param !== undefined) body.param = param;
      const { data } = await this.client.post('/action/execute-by-marker', body);
      return data;
    });
  }

  // ===== Error handling =====
  private async wrapError<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.code === 'ECONNREFUSED') {
          throw new Error(
            `Cannot connect to playwright-server at ${this.client.defaults.baseURL}. Is it running?`
          );
        }
        const message = err.response?.data?.message || err.message;
        throw new Error(`playwright-server error: ${message}`);
      }
      throw err;
    }
  }
}
