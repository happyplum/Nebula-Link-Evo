import type {
  DOMSnapshotResponse,
  ElementInfo,
  ElementLocator,
} from '@nebula-link-evo/shared';
import type {
  DebugMarkerEvent,
  DebugOverlayEvent,
  DebugStatusReason,
} from '@nebula-link-evo/shared/types/debug-events.js';
import { BrowserService } from './browser-engine/index.js';
import type { MarkerActionResult } from './browser-engine/index.js';
import { debugEventHub } from './services/debug-event-hub.js';
import { createWorkerLogger } from './services/logger.js';
import type { ScreenshotData } from './types.js';

const logger = createWorkerLogger('BrowserClient');

const browserService = BrowserService.getInstance();

// Replaces the previous x-browser-owner header (always 'chat' for BrowserClient calls)
const OWNER = 'chat';

const DEBUG_MARKER_TTL_MS = 5000;

// Patterns from the former /dom/script route safety check
const DANGEROUS_SCRIPT_PATTERNS: readonly RegExp[] = [
  /eval\s*\(/,
  /Function\s*\(/,
  /document\.cookie/,
  /localStorage\.setItem/,
  /fetch\s*\(/,
  /XMLHttpRequest/,
  /\$http/,
];

interface PageStateElement {
  tag: string;
  text?: string;
  bbox: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isInteractable: boolean;
}

// ---------------------------------------------------------------------------
// Debug event helpers (migrated from playwright-server route handlers)
// ---------------------------------------------------------------------------

type MarkerDebugAction = NonNullable<DebugMarkerEvent['marker']['action']>;

async function publishDebugStatus(reason: DebugStatusReason): Promise<void> {
  try {
    debugEventHub.publish({
      type: 'debug.status',
      status: await browserService.getDebugStatus(reason, OWNER),
      emittedAt: new Date().toISOString(),
    });
  } catch {
    // Best-effort publishing must never affect browser operations.
  }
}

async function publishMarkerDebugEvents(
  action: MarkerDebugAction,
  result: MarkerActionResult
): Promise<void> {
  if (!result.bbox) {
    return;
  }

  try {
    const pageX = result.bbox.x + result.bbox.width / 2;
    const pageY = result.bbox.y + result.bbox.height / 2;

    const markerEvent: DebugMarkerEvent = {
      type: 'debug.marker',
      marker: {
        source: 'ai',
        action,
        pageX,
        pageY,
        bbox: result.bbox,
        selector: result.selector,
        nebulaId: result.nebulaId,
        ttlMs: DEBUG_MARKER_TTL_MS,
      },
      emittedAt: new Date().toISOString(),
    };

    const overlayEvent: DebugOverlayEvent = {
      type: 'debug.overlay',
      overlay: {
        kind: 'highlight',
        source: 'ai',
        bbox: result.bbox,
        selector: result.selector,
        ttlMs: DEBUG_MARKER_TTL_MS,
      },
      emittedAt: new Date().toISOString(),
    };

    debugEventHub.publish(markerEvent);
    debugEventHub.publish(overlayEvent);
  } catch {
    // Best-effort only: debug push must never affect browser operations.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BrowserClient {
  private cdpPort: number = 9222;

  async openBrowser(): Promise<void> {
    await browserService.open(false, { width: 1920, height: 1080 }, this.cdpPort, OWNER);
    await publishDebugStatus('open');
  }

  async closeBrowser(): Promise<void> {
    await browserService.close(OWNER);
    await publishDebugStatus('close');
  }

  async navigate(url: string): Promise<void> {
    await browserService.navigate(url, 'networkidle', OWNER);
    await publishDebugStatus('navigate');
  }

  async screenshot(fullPage: boolean = false): Promise<ScreenshotData> {
    const result = await browserService.screenshot(fullPage, OWNER);
    return { screenshot: result.screenshot, viewport: result.viewport };
  }

  async getSimplifiedDOM(): Promise<DOMSnapshotResponse> {
    const data = await browserService.getSimplifiedDOMV2(OWNER);
    if (!data.snapshot_id) {
      logger.warn('DOM response missing snapshot_id');
    }
    return data;
  }

  async click(x: number, y: number): Promise<void> {
    // Preserves the 3-attempt retry from the former /action/click route
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await browserService.click(x, y, OWNER);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 3) {
          await delay(attempt * 1000);
        }
      }
    }
    throw lastError!;
  }

  async clickBySelector(selector: string): Promise<void> {
    // Preserves the force-click fallback from the former /action/click-by-selector route
    try {
      await browserService.clickBySelector(selector, undefined, OWNER);
    } catch {
      logger.info({ selector }, 'Normal click failed, retrying with force');
      await browserService.clickBySelector(selector, { force: true }, OWNER);
    }
  }

  async executeScript(script: string, args?: unknown[]): Promise<unknown> {
    // Preserves the safety check from the former /dom/script route
    for (const pattern of DANGEROUS_SCRIPT_PATTERNS) {
      if (pattern.test(script)) {
        throw new Error('Potentially dangerous script detected');
      }
    }
    const result = await browserService.executeScript(script, args ?? [], OWNER);
    return result;
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
    const result = await browserService.clickByMarker(snapshotId, nebulaId, OWNER);
    if (result.success) {
      await publishMarkerDebugEvents('click', result);
    }
  }

  async typeByMarker(snapshotId: string, nebulaId: number, text: string): Promise<void> {
    const result = await browserService.typeByMarker(snapshotId, nebulaId, text, undefined, OWNER);
    if (result.success) {
      await publishMarkerDebugEvents('type', result);
    }
  }

  async focusByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    const result = await browserService.focusByMarker(snapshotId, nebulaId, OWNER);
    if (result.success) {
      await publishMarkerDebugEvents('focus', result);
    }
  }

  async blurByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    const result = await browserService.blurByMarker(snapshotId, nebulaId, OWNER);
    if (result.success) {
      await publishMarkerDebugEvents('blur', result);
    }
  }

  async hoverByMarker(snapshotId: string, nebulaId: number): Promise<void> {
    const result = await browserService.hoverByMarker(snapshotId, nebulaId, OWNER);
    if (result.success) {
      await publishMarkerDebugEvents('hover', result);
    }
  }

  async setValueByMarker(snapshotId: string, nebulaId: number, value: string): Promise<void> {
    const result = await browserService.setValueByMarker(snapshotId, nebulaId, value, OWNER);
    if (result.success) {
      await publishMarkerDebugEvents('value', result);
    }
  }

  async dispatchEventByMarker(
    snapshotId: string,
    nebulaId: number,
    eventType: string
  ): Promise<void> {
    const result = await browserService.dispatchEventByMarker(snapshotId, nebulaId, eventType, OWNER);
    if (result.success) {
      await publishMarkerDebugEvents('dispatch', result);
    }
  }

  async type(selector: string, text: string): Promise<void> {
    // Preserves the 3-attempt retry with force escalation from the former /action/type route
    let currentOptions: { delay?: number; clear?: boolean; force?: boolean } | undefined = undefined;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await browserService.type(selector, text, currentOptions, OWNER);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < 3) {
          logger.info({ attempt }, 'Type attempt failed, retrying');
          await delay(attempt * 1000);
          if (!currentOptions?.force) {
            currentOptions = { ...(currentOptions ?? {}), force: true };
          }
        }
      }
    }

    throw lastError!;
  }

  async scroll(x: number, y: number): Promise<void> {
    await browserService.scroll(x, y, OWNER);
  }

  async focus(selector: string): Promise<void> {
    await browserService.focus(selector, OWNER);
  }

  async blur(selector: string): Promise<void> {
    await browserService.blur(selector, OWNER);
  }

  async hover(selector: string): Promise<void> {
    await browserService.hover(selector, OWNER);
  }

  async setValue(selector: string, value: string): Promise<void> {
    await browserService.setValue(selector, value, OWNER);
  }

  async dispatchEvent(selector: string, eventType: string): Promise<void> {
    await browserService.dispatchEvent(selector, eventType, OWNER);
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
      return {
        isOpen: browserService.isOpen(),
        url: browserService.getCurrentUrl(),
        title: await browserService.getTitle(OWNER),
        viewport: browserService.getViewport() ?? undefined,
      };
    } catch {
      return { isOpen: false };
    }
  }

  async getTabs(): Promise<Array<{ id: string; url: string; title: string; isActive: boolean }>> {
    try {
      return await browserService.getTabs(OWNER);
    } catch {
      return [];
    }
  }

  async switchTab(id: string): Promise<void> {
    await browserService.switchTab(id, OWNER);
    await publishDebugStatus('switch_tab');
  }

  async getElementAt(x: number, y: number): Promise<ElementInfo | null> {
    const element = await browserService.getElementAt(x, y, OWNER);
    return element;
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
        viewport: dom.simplified_dom?.viewport ?? { width: 1920, height: 1080 },
        screenshot: dom.annotated_screenshot_base64 || screenshotData?.screenshot || undefined,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get page state');
      return null;
    }
  }
}

export const browserClient = new BrowserClient();
