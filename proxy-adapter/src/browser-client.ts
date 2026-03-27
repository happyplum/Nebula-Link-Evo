import axios from 'axios';
import { ScreenshotData } from './types.js';
import type { DOMSnapshotResponse, ElementInfo, ElementLocator } from '@nebula-link-evo/shared';
import { getServiceEndpointsCached } from './config/services.js';

interface PageStateElement {
  tag: string;
  text?: string;
  bbox: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isInteractable: boolean;
}

const endpoints = getServiceEndpointsCached();
const PLAYWRIGHT_URL = endpoints.playwright.url;

export class BrowserClient {
  private cdpPort: number = 9222;

  async openBrowser(): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/browser/open`, {
      headless: false,
      cdpPort: this.cdpPort,
    });
  }

  async closeBrowser(): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/browser/close`, {});
  }

  async navigate(url: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, { url });
  }

  async screenshot(): Promise<ScreenshotData> {
    const response = await axios.post(`${PLAYWRIGHT_URL}/browser/screenshot`, {
      fullPage: false,
      type: 'png',
    });
    return response.data;
  }

  async getSimplifiedDOM(): Promise<DOMSnapshotResponse> {
    try {
      const response = await axios.get(`${PLAYWRIGHT_URL}/dom/simplified`);
      const data = response.data;
      if (data.snapshot_id) {
        return data;
      }
      console.warn('[BrowserClient] DOM response missing snapshot_id');
      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // Handle network errors or HTTP errors
        if (error.response) {
          // Server responded with error status
          console.error('[BrowserClient] Playwright Server returned error:', {
            status: error.response.status,
            data: error.response.data,
          });
          throw new Error(
            `Playwright Server error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
          );
        } else if (error.request) {
          // Request made but no response received
          console.error('[BrowserClient] No response from Playwright Server:', error.message);
          throw new Error(`Playwright Server unreachable: ${error.message}`);
        }
      }
      // Other errors
      console.error('[BrowserClient] Unexpected error fetching DOM:', error);
      throw error;
    }
  }

  async click(x: number, y: number): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/click`, { x, y });
  }

  async clickBySelector(selector: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/click-by-selector`, { selector });
  }

  async clickByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/click-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
    });
  }

  async typeByMarker(snapshotId: string, nebulaId: number, text: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'type',
      param: text,
    });
  }

  async focusByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'focus',
    });
  }

  async blurByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'blur',
    });
  }

  async hoverByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'hover',
    });
  }

  async setValueByMarker(snapshotId: string, nebulaId: number, value: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'value',
      param: value,
    });
  }

  async dispatchEventByMarker(snapshotId: string, nebulaId: number, eventType: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/execute-by-marker`, {
      snapshot_id: snapshotId,
      nebula_id: nebulaId,
      action: 'dispatch',
      param: eventType,
    });
  }

  async type(selector: string, text: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/type`, { selector, text });
  }

  async scroll(x: number, y: number): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/scroll`, { x, y });
  }

  async focus(selector: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/focus`, { selector });
  }

  async blur(selector: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/blur`, { selector });
  }

  async hover(selector: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/hover`, { selector });
  }

  async setValue(selector: string, value: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/value`, { selector, value });
  }

  async dispatchEvent(selector: string, eventType: string): Promise<void> {
    await axios.post(`${PLAYWRIGHT_URL}/action/dispatch`, { selector, eventType });
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

  async getStatus(): Promise<{ isOpen: boolean; url?: string; title?: string }> {
    try {
      const response = await axios.get(`${PLAYWRIGHT_URL}/browser/status`);
      return {
        isOpen: response.data.isOpen || false,
        url: response.data.currentUrl || response.data.url,
        title: response.data.title,
      };
    } catch {
      return { isOpen: false };
    }
  }

  async getElementAt(x: number, y: number): Promise<ElementInfo | null> {
    const response = await axios.get(`${PLAYWRIGHT_URL}/dom/element-at`, {
      params: { x, y },
    });
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
      console.log('[BrowserClient] Extracting elements from elements_map...');
      let domElements: PageStateElement[] = [];
      if (dom.elements_map && typeof dom.elements_map === 'object') {
        // v2.0 format: Record<string, ElementLocator>
        console.log('[BrowserClient] Using v2.0 format (Record)');
        domElements = Object.values(dom.elements_map).map((info: ElementLocator): PageStateElement => ({
          tag: info.tag,
          text: info.text,
          bbox: info.bbox,
          // v2.0 doesn't have isVisible/isInteractable, default to true
          isVisible: true,
          isInteractable: true,
        }));
      } else {
        console.warn('[BrowserClient] Invalid elements_map format:', typeof dom.elements_map);
      }
      return {
        url: dom.snapshot_id, // Use snapshot_id as URL identifier
        title: `Snapshot ${dom.snapshot_id}`,
        elements: domElements || [],
        viewport: { width: 1920, height: 1080 }, // Default viewport since new format doesn't have it
        screenshot: dom.annotated_screenshot_base64 || screenshotData?.screenshot || undefined,
      };
    } catch (error) {
      console.error('[BrowserClient] Failed to get page state:', error);
      return null;
    }
  }
}

export const browserClient = new BrowserClient();
