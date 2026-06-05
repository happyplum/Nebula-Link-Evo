import axios from 'axios';
import { ScreenshotData } from './types.js';

// 为所有 BrowserClient 请求自动附加 x-browser-owner header
// 可选链确保测试 mock 环境下 axios.defaults 不可用时不会崩溃
axios.defaults?.headers?.common && (axios.defaults.headers.common['x-browser-owner'] = 'chat');
import type { DOMSnapshotResponse, ElementInfo, ElementLocator } from '@nebula-link-evo/shared';
import { getServiceEndpointsCached } from './config/services.js';
import { createWorkerLogger } from './services/logger.js';

const logger = createWorkerLogger('BrowserClient');

interface PageStateElement {
  tag: string;
  text?: string;
  bbox: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isInteractable: boolean;
}

const endpoints = getServiceEndpointsCached();
const PLAYWRIGHT_URL = endpoints.playwright.url;

const BROWSER_TIMEOUT_MS = 30000;

export class BrowserClient {
  private cdpPort: number = 9222;

  /**
   * 封装 axios 请求，提取 HTTP 错误响应体到错误消息。
   * 仅增强错误路径；正常返回值由调用方自行处理（如 response.data / response.data.result）。
   */
  private async doRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          logger.error(
            { status: error.response.status, data: error.response.data },
            'Playwright Server returned error'
          );
          throw new Error(
            `Playwright Server error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
          );
        } else if (error.request) {
          logger.error({ message: error.message }, 'No response from Playwright Server');
          throw new Error(`Playwright Server unreachable: ${error.message}`);
        }
      }
      logger.error({ err: error }, 'Unexpected browser request error');
      throw error;
    }
  }

  async openBrowser(): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/browser/open`, {
      headless: false,
      cdpPort: this.cdpPort,
    }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async closeBrowser(): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/browser/close`, {}, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async navigate(url: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, { url }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async screenshot(fullPage: boolean = false): Promise<ScreenshotData> {
    const response = await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/browser/screenshot`, {
      fullPage,
      type: 'png',
    }, { timeout: BROWSER_TIMEOUT_MS }));
    return response.data;
  }

  async getSimplifiedDOM(): Promise<DOMSnapshotResponse> {
    try {
      const response = await axios.get(`${PLAYWRIGHT_URL}/dom/simplified`, { timeout: BROWSER_TIMEOUT_MS });
      const data = response.data;
      if (data.snapshot_id) {
        return data;
      }
      logger.warn('DOM response missing snapshot_id');
      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // Handle network errors or HTTP errors
        if (error.response) {
          // Server responded with error status
          logger.error({ status: error.response.status, data: error.response.data }, 'Playwright Server returned error');
          throw new Error(
            `Playwright Server error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
          );
        } else if (error.request) {
          // Request made but no response received
          logger.error({ message: error.message }, 'No response from Playwright Server');
          throw new Error(`Playwright Server unreachable: ${error.message}`);
        }
      }
      // Other errors
      logger.error({ err: error }, 'Unexpected error fetching DOM');
      throw error;
    }
  }

  async click(x: number, y: number): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/click`, { x, y }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async clickBySelector(selector: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/click-by-selector`, { selector }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async executeScript(script: string, args?: unknown[]): Promise<unknown> {
    const response = await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/dom/script`, {
      script,
      args: args ?? [],
    }, { timeout: BROWSER_TIMEOUT_MS }));
    return response.data.result;
  }

  async getCookies(): Promise<Array<{ name: string; value: string; domain: string }>> {
    const result = await this.executeScript(
      `(() => window.document['cookie']
        .split(';')
        .map((cookie) => cookie.trim())
        .filter(Boolean)
        .map((cookie) => {
          const [name, ...rest] = cookie.split('=');
          return {
            name,
            value: rest.join('='),
            domain: window.location.hostname,
          };
        }))()`
    );
    return Array.isArray(result)
      ? (result as Array<{ name: string; value: string; domain: string }>)
      : [];
  }

  async getLocalStorage(): Promise<Record<string, string>> {
    const result = await this.executeScript(
      `(() => {
        const data = {};
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (key) {
            data[key] = localStorage.getItem(key) ?? '';
          }
        }
        return data;
      })()`
    );
    return result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, string>)
      : {};
  }

  async clickByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/click-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
    }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async typeByMarker(snapshotId: string, nebulaId: number, text: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'type',
      param: text,
    }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async focusByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'focus',
    }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async blurByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'blur',
    }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async hoverByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'hover',
    }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async setValueByMarker(snapshotId: string, nebulaId: number, value: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'value',
      param: value,
    }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async dispatchEventByMarker(
    snapshotId: string,
    nebulaId: number,
    eventType: string
  ): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'dispatch',
      param: eventType,
    }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async type(selector: string, text: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/type`, { selector, text }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async scroll(x: number, y: number): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/scroll`, { x, y }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async focus(selector: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/focus`, { selector }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async blur(selector: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/blur`, { selector }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async hover(selector: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/hover`, { selector }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async setValue(selector: string, value: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/value`, { selector, value }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async dispatchEvent(selector: string, eventType: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/action/dispatch`, { selector, eventType }, { timeout: BROWSER_TIMEOUT_MS }));
  }

  async elementAction(selector: string, action: string, param?: string): Promise<void> {
    switch (action) {
      case 'click':
        await this.clickBySelector(selector);
        break;
      case 'type':
        await this.type(selector, param || '');
        break;
      case 'value':
        await this.setValue(selector, param || '');
        break;
      case 'focus':
        await this.focus(selector);
        break;
      case 'blur':
        await this.blur(selector);
        break;
      case 'hover':
        await this.hover(selector);
        break;
      case 'dispatch':
        await this.dispatchEvent(selector, param || '');
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async getStatus(): Promise<{
    isOpen: boolean;
    url?: string;
    title?: string;
    viewport?: { width: number; height: number };
  }> {
    try {
      const response = await axios.get(`${PLAYWRIGHT_URL}/browser/status`, { timeout: BROWSER_TIMEOUT_MS });
      return {
        isOpen: response.data.isOpen || false,
        url: response.data.currentUrl || response.data.url,
        title: response.data.title,
        viewport: response.data.viewport,
      };
    } catch {
      return { isOpen: false };
    }
  }

  async getTabs(): Promise<Array<{ id: string; url: string; title: string; isActive: boolean }>> {
    try {
      const response = await axios.get(`${PLAYWRIGHT_URL}/browser/tabs`, { timeout: BROWSER_TIMEOUT_MS });
      return response.data.tabs || [];
    } catch {
      return [];
    }
  }

  async switchTab(id: string): Promise<void> {
    await this.doRequest(() => axios.post(`${PLAYWRIGHT_URL}/browser/tabs/switch`, { id }, { timeout: 15000 }));
  }

  async getElementAt(x: number, y: number): Promise<ElementInfo | null> {
    const response = await this.doRequest(() => axios.get(`${PLAYWRIGHT_URL}/dom/element-at`, {
      params: { x, y },
      timeout: BROWSER_TIMEOUT_MS,
    }));
    if (response.data.success && response.data.element) {
      return response.data.element;
    }
    return null;
  }

  async getPageState(): Promise<{
    url: string;
    title: string;
    elements: PageStateElement[];
    viewport: { width: number; height: number };
    screenshot?: string;
  } | null> {
    try {
      const [dom, screenshotData] = await Promise.all([
        this.getSimplifiedDOM(),
        this.screenshot().catch(() => null),
      ]);

      // Extract elements from v2.0 (Record) format
      logger.info('Extracting elements from elements_map');
      let domElements: PageStateElement[] = [];
      if (dom.elements_map && typeof dom.elements_map === 'object') {
        // v2.0 format: Record<string, ElementLocator>
        logger.info('Using v2.0 format (Record)');
        domElements = Object.values(dom.elements_map).map(
          (info: ElementLocator): PageStateElement => ({
            tag: info.tag,
            text: info.text,
            bbox: info.bbox,
            // v2.0 doesn't have isVisible/isInteractable, default to true
            isVisible: true,
            isInteractable: true,
          })
        );
      } else {
        logger.warn({ format: typeof dom.elements_map }, 'Invalid elements_map format');
      }
      return {
        url: dom.snapshot_id, // Use snapshot_id as URL identifier
        title: `Snapshot ${dom.snapshot_id}`,
        elements: domElements || [],
        viewport: { width: 1920, height: 1080 }, // Default viewport since new format doesn't have it
        screenshot: dom.annotated_screenshot_base64 || screenshotData?.screenshot || undefined,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get page state');
      return null;
    }
  }
}

export const browserClient = new BrowserClient();
