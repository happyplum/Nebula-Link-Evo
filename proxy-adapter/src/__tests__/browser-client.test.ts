import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock setup — must be hoisted above the import of browser-client.js
// ---------------------------------------------------------------------------

const mockBrowserService = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  navigate: vi.fn(),
  screenshot: vi.fn(),
  getSimplifiedDOMV2: vi.fn(),
  click: vi.fn(),
  clickBySelector: vi.fn(),
  executeScript: vi.fn(),
  clickByMarker: vi.fn(),
  typeByMarker: vi.fn(),
  focusByMarker: vi.fn(),
  blurByMarker: vi.fn(),
  hoverByMarker: vi.fn(),
  setValueByMarker: vi.fn(),
  dispatchEventByMarker: vi.fn(),
  type: vi.fn(),
  scroll: vi.fn(),
  focus: vi.fn(),
  blur: vi.fn(),
  hover: vi.fn(),
  setValue: vi.fn(),
  dispatchEvent: vi.fn(),
  isOpen: vi.fn(),
  getCurrentUrl: vi.fn(),
  getTitle: vi.fn(),
  getViewport: vi.fn(),
  getTabs: vi.fn(),
  switchTab: vi.fn(),
  getElementAt: vi.fn(),
  getDebugStatus: vi.fn(),
}));

vi.mock('../browser-engine/index.js', () => ({
  BrowserService: {
    getInstance: () => mockBrowserService,
  },
}));

vi.mock('../services/debug-event-hub.js', () => ({
  debugEventHub: { publish: vi.fn() },
}));

vi.mock('../services/logger.js', () => ({
  createWorkerLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { BrowserClient } from '../browser-client.js';

// Marker result returned by BrowserService on success (no bbox → no debug events)
const SUCCESS_MARKER_RESULT = {
  success: true,
  strategy_used: 'nebula-id',
  attempts: 1,
  latency_ms: 10,
};

describe('BrowserClient', () => {
  let client: BrowserClient;

  beforeEach(() => {
    client = new BrowserClient();
    vi.clearAllMocks();
    // Default: getDebugStatus succeeds so publishDebugStatus doesn't throw
    mockBrowserService.getDebugStatus.mockResolvedValue({
      isOpen: false,
      url: null,
      title: null,
      status: 'unknown',
    });
  });

  // -------------------------------------------------------------------
  // Browser lifecycle
  // -------------------------------------------------------------------

  describe('openBrowser', () => {
    it('should call BrowserService.open with correct args', async () => {
      mockBrowserService.open.mockResolvedValue(undefined);
      await client.openBrowser();
      expect(mockBrowserService.open).toHaveBeenCalledWith(
        false,
        { width: 1920, height: 1080 },
        9222,
        'chat'
      );
    });
  });

  describe('closeBrowser', () => {
    it('should call BrowserService.close with owner', async () => {
      mockBrowserService.close.mockResolvedValue(undefined);
      await client.closeBrowser();
      expect(mockBrowserService.close).toHaveBeenCalledWith('chat');
    });
  });

  describe('navigate', () => {
    it('should call BrowserService.navigate with url and waitUntil', async () => {
      mockBrowserService.navigate.mockResolvedValue(undefined);
      await client.navigate('https://example.com');
      expect(mockBrowserService.navigate).toHaveBeenCalledWith(
        'https://example.com',
        'networkidle',
        'chat'
      );
    });
  });

  // -------------------------------------------------------------------
  // Screenshot
  // -------------------------------------------------------------------

  describe('screenshot', () => {
    it('should return screenshot data from BrowserService', async () => {
      mockBrowserService.screenshot.mockResolvedValue({
        screenshot: 'base64',
        viewport: { width: 1920, height: 1080 },
      });
      const result = await client.screenshot();
      expect(mockBrowserService.screenshot).toHaveBeenCalledWith(false, 'chat');
      expect(result).toEqual({ screenshot: 'base64', viewport: { width: 1920, height: 1080 } });
    });

    it('should pass fullPage option', async () => {
      mockBrowserService.screenshot.mockResolvedValue({
        screenshot: 'base64',
        viewport: { width: 1920, height: 1080 },
      });
      await client.screenshot(true);
      expect(mockBrowserService.screenshot).toHaveBeenCalledWith(true, 'chat');
    });
  });

  // -------------------------------------------------------------------
  // getSimplifiedDOM
  // -------------------------------------------------------------------

  describe('getSimplifiedDOM', () => {
    it('should return DOM data from BrowserService', async () => {
      const mockData = { snapshot_id: '123', elements_map: {}, version: '2.0' as const, annotated_screenshot_base64: '', simplified_dom: { elements: [], viewport: { width: 1920, height: 1080 } } };
      mockBrowserService.getSimplifiedDOMV2.mockResolvedValue(mockData);
      const result = await client.getSimplifiedDOM();
      expect(result).toEqual(mockData);
    });

    it('should handle missing snapshot_id', async () => {
      const mockData = { snapshot_id: '', elements_map: {}, version: '2.0' as const, annotated_screenshot_base64: '', simplified_dom: { elements: [], viewport: { width: 1920, height: 1080 } } };
      mockBrowserService.getSimplifiedDOMV2.mockResolvedValue(mockData);
      const result = await client.getSimplifiedDOM();
      expect(result).toEqual(mockData);
    });

    it('should propagate errors from BrowserService', async () => {
      mockBrowserService.getSimplifiedDOMV2.mockRejectedValue(new Error('Browser not opened'));
      await expect(client.getSimplifiedDOM()).rejects.toThrow('Browser not opened');
    });
  });

  // -------------------------------------------------------------------
  // Actions — direct
  // -------------------------------------------------------------------

  describe('actions', () => {
    it('should call click on BrowserService', async () => {
      mockBrowserService.click.mockResolvedValue(undefined);
      await client.click(100, 200);
      expect(mockBrowserService.click).toHaveBeenCalledWith(100, 200, 'chat');
    });

    it('should retry click up to 3 times on failure', async () => {
      mockBrowserService.click
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce(undefined);
      await client.click(100, 200);
      expect(mockBrowserService.click).toHaveBeenCalledTimes(3);
    });

    it('should throw after 3 failed click attempts', async () => {
      mockBrowserService.click.mockRejectedValue(new Error('always fails'));
      await expect(client.click(100, 200)).rejects.toThrow('always fails');
      expect(mockBrowserService.click).toHaveBeenCalledTimes(3);
    });

    it('should call clickBySelector on BrowserService', async () => {
      mockBrowserService.clickBySelector.mockResolvedValue(undefined);
      await client.clickBySelector('#test');
      expect(mockBrowserService.clickBySelector).toHaveBeenCalledWith('#test', undefined, 'chat');
    });

    it('should retry clickBySelector with force on failure', async () => {
      mockBrowserService.clickBySelector
        .mockRejectedValueOnce(new Error('normal fail'))
        .mockResolvedValueOnce(undefined);
      await client.clickBySelector('#test');
      expect(mockBrowserService.clickBySelector).toHaveBeenCalledTimes(2);
      expect(mockBrowserService.clickBySelector).toHaveBeenLastCalledWith('#test', { force: true }, 'chat');
    });

    it('should call executeScript on BrowserService and return result', async () => {
      mockBrowserService.executeScript.mockResolvedValue({ ok: true });
      const result = await client.executeScript('return true', ['arg']);
      expect(mockBrowserService.executeScript).toHaveBeenCalledWith('return true', ['arg'], 'chat');
      expect(result).toEqual({ ok: true });
    });

    it('should reject dangerous scripts before calling BrowserService', async () => {
      await expect(client.executeScript('eval("malicious")')).rejects.toThrow(
        'Potentially dangerous script detected'
      );
      expect(mockBrowserService.executeScript).not.toHaveBeenCalled();
    });

    it('should get cookies via executeScript', async () => {
      const cookies = [{ name: 'session', value: 'abc', domain: 'example.com' }];
      mockBrowserService.executeScript.mockResolvedValue(cookies);
      const result = await client.getCookies();
      expect(mockBrowserService.executeScript).toHaveBeenCalledWith(
        expect.any(String),
        [],
        'chat'
      );
      expect(result).toEqual(cookies);
    });

    it('should get localStorage via executeScript', async () => {
      const storage = { token: 'abc' };
      mockBrowserService.executeScript.mockResolvedValue(storage);
      const result = await client.getLocalStorage();
      expect(result).toEqual(storage);
    });

    it('should call clickByMarker on BrowserService', async () => {
      mockBrowserService.clickByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
      await client.clickByMarker('snap-1', 123);
      expect(mockBrowserService.clickByMarker).toHaveBeenCalledWith('snap-1', 123, 'chat');
    });

    it('should call typeByMarker on BrowserService', async () => {
      mockBrowserService.typeByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
      await client.typeByMarker('snap-1', 123, 'hello');
      expect(mockBrowserService.typeByMarker).toHaveBeenCalledWith('snap-1', 123, 'hello', undefined, 'chat');
    });

    it('should call focusByMarker on BrowserService', async () => {
      mockBrowserService.focusByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
      await client.focusByMarker('snap-1', 123);
      expect(mockBrowserService.focusByMarker).toHaveBeenCalledWith('snap-1', 123, 'chat');
    });

    it('should call blurByMarker on BrowserService', async () => {
      mockBrowserService.blurByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
      await client.blurByMarker('snap-1', 123);
      expect(mockBrowserService.blurByMarker).toHaveBeenCalledWith('snap-1', 123, 'chat');
    });

    it('should call hoverByMarker on BrowserService', async () => {
      mockBrowserService.hoverByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
      await client.hoverByMarker('snap-1', 123);
      expect(mockBrowserService.hoverByMarker).toHaveBeenCalledWith('snap-1', 123, 'chat');
    });

    it('should call setValueByMarker on BrowserService', async () => {
      mockBrowserService.setValueByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
      await client.setValueByMarker('snap-1', 123, 'val');
      expect(mockBrowserService.setValueByMarker).toHaveBeenCalledWith('snap-1', 123, 'val', 'chat');
    });

    it('should call dispatchEventByMarker on BrowserService', async () => {
      mockBrowserService.dispatchEventByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
      await client.dispatchEventByMarker('snap-1', 123, 'change');
      expect(mockBrowserService.dispatchEventByMarker).toHaveBeenCalledWith('snap-1', 123, 'change', 'chat');
    });

    it('should call type on BrowserService', async () => {
      mockBrowserService.type.mockResolvedValue(undefined);
      await client.type('#test', 'hello');
      expect(mockBrowserService.type).toHaveBeenCalledWith('#test', 'hello', undefined, 'chat');
    });

    it('should retry type with force escalation on failure', async () => {
      mockBrowserService.type
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValueOnce(undefined);
      await client.type('#test', 'hello');
      expect(mockBrowserService.type).toHaveBeenCalledTimes(2);
      // Second attempt should have force: true
      expect(mockBrowserService.type).toHaveBeenLastCalledWith('#test', 'hello', { force: true }, 'chat');
    });

    it('should throw after 3 failed type attempts', async () => {
      mockBrowserService.type.mockRejectedValue(new Error('always fails'));
      await expect(client.type('#test', 'hello')).rejects.toThrow('always fails');
      expect(mockBrowserService.type).toHaveBeenCalledTimes(3);
    });

    it('should call scroll on BrowserService', async () => {
      mockBrowserService.scroll.mockResolvedValue(undefined);
      await client.scroll(0, 500);
      expect(mockBrowserService.scroll).toHaveBeenCalledWith(0, 500, 'chat');
    });

    it('should call focus on BrowserService', async () => {
      mockBrowserService.focus.mockResolvedValue(undefined);
      await client.focus('#test');
      expect(mockBrowserService.focus).toHaveBeenCalledWith('#test', 'chat');
    });

    it('should call blur on BrowserService', async () => {
      mockBrowserService.blur.mockResolvedValue(undefined);
      await client.blur('#test');
      expect(mockBrowserService.blur).toHaveBeenCalledWith('#test', 'chat');
    });

    it('should call hover on BrowserService', async () => {
      mockBrowserService.hover.mockResolvedValue(undefined);
      await client.hover('#test');
      expect(mockBrowserService.hover).toHaveBeenCalledWith('#test', 'chat');
    });

    it('should call setValue on BrowserService', async () => {
      mockBrowserService.setValue.mockResolvedValue(undefined);
      await client.setValue('#test', 'val');
      expect(mockBrowserService.setValue).toHaveBeenCalledWith('#test', 'val', 'chat');
    });

    it('should call dispatchEvent on BrowserService', async () => {
      mockBrowserService.dispatchEvent.mockResolvedValue(undefined);
      await client.dispatchEvent('#test', 'change');
      expect(mockBrowserService.dispatchEvent).toHaveBeenCalledWith('#test', 'change', 'chat');
    });
  });

  // -------------------------------------------------------------------
  // elementAction routing
  // -------------------------------------------------------------------

  describe('elementAction', () => {
    it('should route to correct BrowserService methods', async () => {
      mockBrowserService.clickBySelector.mockResolvedValue(undefined);
      mockBrowserService.type.mockResolvedValue(undefined);
      mockBrowserService.setValue.mockResolvedValue(undefined);
      mockBrowserService.focus.mockResolvedValue(undefined);
      mockBrowserService.blur.mockResolvedValue(undefined);
      mockBrowserService.hover.mockResolvedValue(undefined);
      mockBrowserService.dispatchEvent.mockResolvedValue(undefined);

      await client.elementAction('#test', 'click');
      expect(mockBrowserService.clickBySelector).toHaveBeenCalledWith('#test', undefined, 'chat');

      vi.clearAllMocks();
      await client.elementAction('#test', 'type', 'hello');
      expect(mockBrowserService.type).toHaveBeenCalledWith('#test', 'hello', undefined, 'chat');

      vi.clearAllMocks();
      await client.elementAction('#test', 'value', 'val');
      expect(mockBrowserService.setValue).toHaveBeenCalledWith('#test', 'val', 'chat');

      vi.clearAllMocks();
      await client.elementAction('#test', 'focus');
      expect(mockBrowserService.focus).toHaveBeenCalledWith('#test', 'chat');

      vi.clearAllMocks();
      await client.elementAction('#test', 'blur');
      expect(mockBrowserService.blur).toHaveBeenCalledWith('#test', 'chat');

      vi.clearAllMocks();
      await client.elementAction('#test', 'hover');
      expect(mockBrowserService.hover).toHaveBeenCalledWith('#test', 'chat');

      vi.clearAllMocks();
      await client.elementAction('#test', 'dispatch', 'change');
      expect(mockBrowserService.dispatchEvent).toHaveBeenCalledWith('#test', 'change', 'chat');
    });

    it('should throw on unknown action', async () => {
      await expect(client.elementAction('#test', 'unknown')).rejects.toThrow('Unknown action: unknown');
    });
  });

  // -------------------------------------------------------------------
  // getStatus
  // -------------------------------------------------------------------

  describe('getStatus', () => {
    it('should return status from BrowserService', async () => {
      mockBrowserService.isOpen.mockReturnValue(true);
      mockBrowserService.getCurrentUrl.mockReturnValue('https://example.com');
      mockBrowserService.getTitle.mockResolvedValue('Example');
      mockBrowserService.getViewport.mockReturnValue({ width: 1920, height: 1080 });

      const result = await client.getStatus();
      expect(result).toEqual({
        isOpen: true,
        url: 'https://example.com',
        title: 'Example',
        viewport: { width: 1920, height: 1080 },
      });
    });

    it('should return isOpen false on error', async () => {
      mockBrowserService.isOpen.mockImplementation(() => {
        throw new Error('Failed');
      });
      const result = await client.getStatus();
      expect(result).toEqual({ isOpen: false });
    });
  });

  // -------------------------------------------------------------------
  // getElementAt
  // -------------------------------------------------------------------

  describe('getElementAt', () => {
    it('should return element from BrowserService', async () => {
      const element = { tag: 'div', selector: 'div', isVisible: true, isInteractable: true };
      mockBrowserService.getElementAt.mockResolvedValue(element);
      const result = await client.getElementAt(100, 200);
      expect(mockBrowserService.getElementAt).toHaveBeenCalledWith(100, 200, 'chat');
      expect(result).toEqual(element);
    });

    it('should return null when no element found', async () => {
      mockBrowserService.getElementAt.mockResolvedValue(null);
      const result = await client.getElementAt(100, 200);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // getTabs
  // -------------------------------------------------------------------

  describe('getTabs', () => {
    it('should return tabs from BrowserService', async () => {
      const tabs = [{ id: '1', url: 'https://example.com', title: 'Example', isActive: true }];
      mockBrowserService.getTabs.mockResolvedValue(tabs);
      const result = await client.getTabs();
      expect(result).toEqual(tabs);
    });

    it('should return empty array on error', async () => {
      mockBrowserService.getTabs.mockRejectedValue(new Error('Failed'));
      const result = await client.getTabs();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // switchTab
  // -------------------------------------------------------------------

  describe('switchTab', () => {
    it('should call BrowserService.switchTab with id and owner', async () => {
      mockBrowserService.switchTab.mockResolvedValue(undefined);
      await client.switchTab('tab-1');
      expect(mockBrowserService.switchTab).toHaveBeenCalledWith('tab-1', 'chat');
    });
  });

  // -------------------------------------------------------------------
  // getPageState
  // -------------------------------------------------------------------

  describe('getPageState', () => {
    it('should return page state with viewport from DOM snapshot', async () => {
      mockBrowserService.getSimplifiedDOMV2.mockResolvedValue({
        snapshot_id: 'snap-1',
        version: '2.0',
        annotated_screenshot_base64: 'base64',
        elements_map: {
          '1': {
            id: '1',
            tag: 'div',
            text: 'hello',
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            locator_bundle: {},
          },
        },
        simplified_dom: {
          elements: [],
          viewport: { width: 1440, height: 900 },
        },
      });
      mockBrowserService.screenshot.mockResolvedValue({
        screenshot: 'base64-screenshot',
        viewport: { width: 1440, height: 900 },
      });

      const result = await client.getPageState();
      expect(result).toEqual({
        url: 'snap-1',
        title: 'Snapshot snap-1',
        elements: [
          { tag: 'div', text: 'hello', bbox: { x: 0, y: 0, width: 10, height: 10 }, isVisible: true, isInteractable: true },
        ],
        viewport: { width: 1440, height: 900 },
        screenshot: 'base64',
      });
    });

    it('should fallback to default viewport when unavailable', async () => {
      mockBrowserService.getSimplifiedDOMV2.mockResolvedValue({
        snapshot_id: 'snap-2',
        version: '2.0',
        annotated_screenshot_base64: 'base64',
        elements_map: {
          '1': {
            id: '1',
            tag: 'div',
            text: 'hello',
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            locator_bundle: {},
          },
        },
        simplified_dom: {
          elements: [],
          viewport: { width: 1920, height: 1080 },
        },
      });
      mockBrowserService.screenshot.mockResolvedValue({
        screenshot: 'base64-screenshot',
        viewport: { width: 1920, height: 1080 },
      });

      const result = await client.getPageState();
      expect(result).toEqual({
        url: 'snap-2',
        title: 'Snapshot snap-2',
        elements: [
          { tag: 'div', text: 'hello', bbox: { x: 0, y: 0, width: 10, height: 10 }, isVisible: true, isInteractable: true },
        ],
        viewport: { width: 1920, height: 1080 },
        screenshot: 'base64',
      });
    });

    it('should return null on error', async () => {
      mockBrowserService.getSimplifiedDOMV2.mockRejectedValue(new Error('Failed'));
      const result = await client.getPageState();
      expect(result).toBeNull();
    });
  });
});
