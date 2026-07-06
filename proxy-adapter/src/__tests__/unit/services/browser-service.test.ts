import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserContextMock, createMockPage } from '../../../../../shared/test-utils/mocks/BrowserContext.mock.js';

// Mock the browser-lifecycle module
const mockBrowserLifecycle = {
  isOpen: vi.fn(),
  getCdpPort: vi.fn(),
  getCurrentUrl: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  navigate: vi.fn(),
  screenshot: vi.fn(),
  getCdpEndpoint: vi.fn(),
  getTitle: vi.fn(),
  getPage: vi.fn(),
};

const mockPageActions = {
  setPage: vi.fn(),
  click: vi.fn(),
  clickBySelector: vi.fn(),
  clickByMarker: vi.fn(),
  type: vi.fn(),
  typeByMarker: vi.fn(),
  scroll: vi.fn(),
  focus: vi.fn(),
  blur: vi.fn(),
  hover: vi.fn(),
  setValue: vi.fn(),
  dispatchEvent: vi.fn(),
  focusByMarker: vi.fn(),
  blurByMarker: vi.fn(),
  hoverByMarker: vi.fn(),
  setValueByMarker: vi.fn(),
  dispatchEventByMarker: vi.fn(),
  executeScript: vi.fn(),
  getElementAt: vi.fn(),
};

const mockDOMExtractor = {
  setPage: vi.fn(),
  getSimplifiedDOMV2: vi.fn(),

};

vi.mock('../../../browser-engine/services/browser-lifecycle.js', () => ({
  BrowserLifecycle: vi.fn(function() {
    return mockBrowserLifecycle;
  }),
}));

vi.mock('../../../browser-engine/services/page-actions.js', () => ({
  PageActions: vi.fn(function() {
    return mockPageActions;
  }),
  MarkerActionResult: {},
}));

vi.mock('../../../browser-engine/services/dom-extractor.js', () => ({
  DOMExtractor: vi.fn(function() {
    return mockDOMExtractor;
  }),
}));

vi.mock('../../../browser-engine/services/browser-lock.js', () => ({
  acquireLock: vi.fn(async () => vi.fn()),
  browserMutex: {},
  getCurrentOwner: vi.fn(() => null),
}));

describe('BrowserService', () => {
  let BrowserService: any;
  let browserService: any;
  let mockPage: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset the singleton instance
    const module = await import('../../../browser-engine/services/browser-service.js');
    BrowserService = module.BrowserService;
    BrowserService.resetInstance();
    
    // Create mock page
    mockPage = createMockPage();
    
    // Setup default mock behaviors
    mockBrowserLifecycle.isOpen.mockReturnValue(false);
    mockBrowserLifecycle.getCdpPort.mockReturnValue(0);
    mockBrowserLifecycle.getCurrentUrl.mockReturnValue(undefined);
    mockBrowserLifecycle.getPage.mockReturnValue(null);
    mockBrowserLifecycle.getCdpEndpoint.mockResolvedValue(null);
    mockBrowserLifecycle.getTitle.mockResolvedValue(undefined);
    mockBrowserLifecycle.screenshot.mockResolvedValue({
      screenshot: 'base64-screenshot',
      viewport: { width: 1920, height: 1080 },
    });
    
    mockDOMExtractor.getSimplifiedDOMV2.mockResolvedValue({
      snapshot_id: 'test-snapshot',
      version: '2.0',
      annotated_screenshot_base64: 'annotated-base64',
      elements_map: {},
      simplified_dom: {
        elements: [],
        viewport: { width: 1920, height: 1080 },
      },
    });
    
    
    mockPageActions.clickByMarker.mockResolvedValue({
      success: true,
      message: 'Clicked element',
    });
    
    mockPageActions.typeByMarker.mockResolvedValue({
      success: true,
      message: 'Typed text',
    });
    
    mockPageActions.focusByMarker.mockResolvedValue({
      success: true,
      message: 'Focused element',
    });
    
    mockPageActions.blurByMarker.mockResolvedValue({
      success: true,
      message: 'Blurred element',
    });
    
    mockPageActions.hoverByMarker.mockResolvedValue({
      success: true,
      message: 'Hovered element',
    });
    
    mockPageActions.setValueByMarker.mockResolvedValue({
      success: true,
      message: 'Set value',
    });
    
    mockPageActions.dispatchEventByMarker.mockResolvedValue({
      success: true,
      message: 'Dispatched event',
    });
    
    mockPageActions.getElementAt.mockResolvedValue({
      selector: '#test',
      tag: 'button',
      isVisible: true,
      isInteractable: true,
    });
    
    mockPageActions.executeScript.mockResolvedValue({ result: 'success' });
    
    // Get singleton instance
    browserService = BrowserService.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = BrowserService.getInstance();
      const instance2 = BrowserService.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should reset instance', () => {
      const instance1 = BrowserService.getInstance();
      BrowserService.resetInstance();
      const instance2 = BrowserService.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Browser Lifecycle', () => {
    it('should check if browser is open', () => {
      mockBrowserLifecycle.isOpen.mockReturnValue(true);
      expect(browserService.isOpen()).toBe(true);
      expect(mockBrowserLifecycle.isOpen).toHaveBeenCalledOnce();
    });

    it('should get CDP port', () => {
      mockBrowserLifecycle.getCdpPort.mockReturnValue(9222);
      expect(browserService.getCdpPort()).toBe(9222);
      expect(mockBrowserLifecycle.getCdpPort).toHaveBeenCalledOnce();
    });

    it('should get current URL', () => {
      mockBrowserLifecycle.getCurrentUrl.mockReturnValue('https://example.com');
      expect(browserService.getCurrentUrl()).toBe('https://example.com');
      expect(mockBrowserLifecycle.getCurrentUrl).toHaveBeenCalledOnce();
    });

    it('should open browser with default options', async () => {
      mockBrowserLifecycle.getPage.mockReturnValue(mockPage);
      await browserService.open();
      
      expect(mockBrowserLifecycle.open).toHaveBeenCalledWith({
        headless: false,
        viewport: { width: 1920, height: 1080 },
        cdpPort: undefined,
      });
      expect(mockPageActions.setPage).toHaveBeenCalledWith(mockPage);
      expect(mockDOMExtractor.setPage).toHaveBeenCalledWith(mockPage);
    });

    it('should open browser with custom options', async () => {
      mockBrowserLifecycle.getPage.mockReturnValue(mockPage);
      await browserService.open(true, { width: 1280, height: 720 }, 9222);
      
      expect(mockBrowserLifecycle.open).toHaveBeenCalledWith({
        headless: true,
        viewport: { width: 1280, height: 720 },
        cdpPort: 9222,
      });
    });

    it('should close browser', async () => {
      await browserService.close();
      
      expect(mockBrowserLifecycle.close).toHaveBeenCalledOnce();
      expect(mockPageActions.setPage).toHaveBeenCalledWith(null);
      expect(mockDOMExtractor.setPage).toHaveBeenCalledWith(null);
    });

    it('should navigate to URL', async () => {
      await browserService.navigate('https://example.com');
      
      expect(mockBrowserLifecycle.navigate).toHaveBeenCalledWith(
        'https://example.com',
        'networkidle'
      );
    });

    it('should navigate with custom wait strategy', async () => {
      await browserService.navigate('https://example.com', 'load');
      
      expect(mockBrowserLifecycle.navigate).toHaveBeenCalledWith(
        'https://example.com',
        'load'
      );
    });

    it('should take screenshot', async () => {
      const result = await browserService.screenshot();
      
      expect(mockBrowserLifecycle.screenshot).toHaveBeenCalledWith(false);
      expect(result).toEqual({
        screenshot: 'base64-screenshot',
        viewport: { width: 1920, height: 1080 },
      });
    });

    it('should take full page screenshot', async () => {
      await browserService.screenshot(true);
      
      expect(mockBrowserLifecycle.screenshot).toHaveBeenCalledWith(true);
    });

    it('should get CDP endpoint', async () => {
      mockBrowserLifecycle.getCdpEndpoint.mockResolvedValue('ws://localhost:9222');
      const result = await browserService.getCdpEndpoint();
      
      expect(result).toBe('ws://localhost:9222');
      expect(mockBrowserLifecycle.getCdpEndpoint).toHaveBeenCalledOnce();
    });

    it('should get page title', async () => {
      mockBrowserLifecycle.getTitle.mockResolvedValue('Test Page');
      const result = await browserService.getTitle();
      
      expect(result).toBe('Test Page');
      expect(mockBrowserLifecycle.getTitle).toHaveBeenCalledOnce();
    });

    it('should get page instance', () => {
      mockBrowserLifecycle.getPage.mockReturnValue(mockPage);
      const result = browserService.getPage();
      
      expect(result).toBe(mockPage);
      expect(mockBrowserLifecycle.getPage).toHaveBeenCalledOnce();
    });
  });

  describe('Page Actions - Coordinate-based', () => {
    it('should click at coordinates', async () => {
      await browserService.click(100, 200);
      
      expect(mockPageActions.click).toHaveBeenCalledWith(100, 200);
    });

    it('should scroll page', async () => {
      await browserService.scroll(0, 500);
      
      expect(mockPageActions.scroll).toHaveBeenCalledWith(0, 500);
    });

    it('should scroll with default values', async () => {
      await browserService.scroll();
      
      expect(mockPageActions.scroll).toHaveBeenCalledWith(0, 0);
    });
  });

  describe('Page Actions - Selector-based', () => {
    it('should click by selector', async () => {
      await browserService.clickBySelector('#button');
      
      expect(mockPageActions.clickBySelector).toHaveBeenCalledWith('#button', undefined);
    });

    it('should click by selector with options', async () => {
      const options = {
        button: 'right' as const,
        clickCount: 2,
        delay: 100,
        force: true,
      };
      await browserService.clickBySelector('#button', options);
      
      expect(mockPageActions.clickBySelector).toHaveBeenCalledWith('#button', options);
    });

    it('should type text', async () => {
      await browserService.type('#input', 'test text');
      
      expect(mockPageActions.type).toHaveBeenCalledWith('#input', 'test text', undefined);
    });

    it('should type with options', async () => {
      const options = { delay: 50, clear: true, force: false };
      await browserService.type('#input', 'test', options);
      
      expect(mockPageActions.type).toHaveBeenCalledWith('#input', 'test', options);
    });

    it('should focus element', async () => {
      await browserService.focus('#input');
      
      expect(mockPageActions.focus).toHaveBeenCalledWith('#input');
    });

    it('should blur element', async () => {
      await browserService.blur('#input');
      
      expect(mockPageActions.blur).toHaveBeenCalledWith('#input');
    });

    it('should hover element', async () => {
      await browserService.hover('#button');
      
      expect(mockPageActions.hover).toHaveBeenCalledWith('#button');
    });

    it('should set value', async () => {
      await browserService.setValue('#input', 'new value');
      
      expect(mockPageActions.setValue).toHaveBeenCalledWith('#input', 'new value');
    });

    it('should dispatch event', async () => {
      await browserService.dispatchEvent('#button', 'click');
      
      expect(mockPageActions.dispatchEvent).toHaveBeenCalledWith('#button', 'click');
    });
  });

  describe('Page Actions - Marker-based', () => {
    it('should click by marker', async () => {
      const result = await browserService.clickByMarker('snapshot-1', 42);
      
      expect(mockPageActions.clickByMarker).toHaveBeenCalledWith('snapshot-1', 42);
      expect(result).toEqual({
        success: true,
        message: 'Clicked element',
      });
    });

    it('should type by marker', async () => {
      const result = await browserService.typeByMarker('snapshot-1', 42, 'test text');
      
      expect(mockPageActions.typeByMarker).toHaveBeenCalledWith(
        'snapshot-1',
        42,
        'test text',
        undefined
      );
      expect(result).toEqual({
        success: true,
        message: 'Typed text',
      });
    });

    it('should type by marker with options', async () => {
      const options = { delay: 50, clear: true, force: false };
      await browserService.typeByMarker('snapshot-1', 42, 'test', options);
      
      expect(mockPageActions.typeByMarker).toHaveBeenCalledWith(
        'snapshot-1',
        42,
        'test',
        options
      );
    });

    it('should focus by marker', async () => {
      const result = await browserService.focusByMarker('snapshot-1', 42);
      
      expect(mockPageActions.focusByMarker).toHaveBeenCalledWith('snapshot-1', 42);
      expect(result).toEqual({
        success: true,
        message: 'Focused element',
      });
    });

    it('should blur by marker', async () => {
      const result = await browserService.blurByMarker('snapshot-1', 42);
      
      expect(mockPageActions.blurByMarker).toHaveBeenCalledWith('snapshot-1', 42);
      expect(result).toEqual({
        success: true,
        message: 'Blurred element',
      });
    });

    it('should hover by marker', async () => {
      const result = await browserService.hoverByMarker('snapshot-1', 42);
      
      expect(mockPageActions.hoverByMarker).toHaveBeenCalledWith('snapshot-1', 42);
      expect(result).toEqual({
        success: true,
        message: 'Hovered element',
      });
    });

    it('should set value by marker', async () => {
      const result = await browserService.setValueByMarker('snapshot-1', 42, 'new value');
      
      expect(mockPageActions.setValueByMarker).toHaveBeenCalledWith(
        'snapshot-1',
        42,
        'new value'
      );
      expect(result).toEqual({
        success: true,
        message: 'Set value',
      });
    });

    it('should dispatch event by marker', async () => {
      const result = await browserService.dispatchEventByMarker('snapshot-1', 42, 'click');
      
      expect(mockPageActions.dispatchEventByMarker).toHaveBeenCalledWith(
        'snapshot-1',
        42,
        'click'
      );
      expect(result).toEqual({
        success: true,
        message: 'Dispatched event',
      });
    });
  });

  describe('DOM Operations', () => {
    it('should get simplified DOM', async () => {
      const result = await browserService.getSimplifiedDOMV2();
      
      expect(mockDOMExtractor.getSimplifiedDOMV2).toHaveBeenCalledOnce();
      expect(result).toEqual({
        snapshot_id: 'test-snapshot',
        version: '2.0',
        annotated_screenshot_base64: 'annotated-base64',
        elements_map: {},
        simplified_dom: {
          elements: [],
          viewport: { width: 1920, height: 1080 },
        },
      });
    });

    it('should get element at coordinates', async () => {
      const result = await browserService.getElementAt(100, 200);
      
      expect(mockPageActions.getElementAt).toHaveBeenCalledWith(100, 200);
      expect(result).toEqual({
        selector: '#test',
        tag: 'button',
        isVisible: true,
        isInteractable: true,
      });
    });
  });


  describe('Script Execution', () => {
    it('should execute script', async () => {
      const result = await browserService.executeScript('return 42;');
      
      expect(mockPageActions.executeScript).toHaveBeenCalledWith('return 42;');
      expect(result).toEqual({ result: 'success' });
    });

    it('should execute script with default args', async () => {
      await browserService.executeScript('console.log("test")');
      
      expect(mockPageActions.executeScript).toHaveBeenCalledWith('console.log("test")');
    });
  });
});
