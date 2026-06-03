import axios, { type AxiosInstance } from 'axios';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';

export class PlaywrightClient {
  private client: AxiosInstance;

  constructor(baseUrl: string) {
    this.client = axios.create({ baseURL: baseUrl, timeout: 30000 });
  }

  /** GET /dom/simplified — returns full DOM snapshot with markers */
  async getSimplifiedDOM(): Promise<DOMSnapshotResponse> {
    try {
      const { data } = await this.client.get<DOMSnapshotResponse>('/dom/simplified');
      return data;
    } catch (error) {
      throw wrapError(error, this.client.defaults.baseURL);
    }
  }

  /** POST /browser/screenshot — returns raw PNG screenshot */
  async getScreenshot(
    fullPage?: boolean
  ): Promise<{ screenshot: string; viewport: { width: number; height: number } }> {
    try {
      const { data } = await this.client.post('/browser/screenshot', { fullPage });
      if (data.success === false) {
        throw new Error(data.message ?? 'Screenshot request failed');
      }
      return data;
    } catch (error) {
      throw wrapError(error, this.client.defaults.baseURL);
    }
  }

  /** GET /browser/status — check if browser is open */
  async getBrowserStatus(): Promise<{ isOpen: boolean; currentUrl?: string; title?: string }> {
    try {
      const { data } = await this.client.get('/browser/status');
      return data;
    } catch (error) {
      throw wrapError(error, this.client.defaults.baseURL);
    }
  }
}

function wrapError(error: unknown, baseUrl: string | undefined): Error {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNREFUSED') {
      return new Error(`playwright-server not reachable at ${baseUrl}`);
    }
    if (error.response) {
      return new Error(
        `playwright-server returned ${error.response.status}: ${error.response.statusText}`
      );
    }
    if (error.request) {
      return new Error(`playwright-server not reachable at ${baseUrl}`);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}
