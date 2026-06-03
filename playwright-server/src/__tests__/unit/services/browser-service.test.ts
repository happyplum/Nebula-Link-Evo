import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock must be defined before importing the module under test
vi.mock('../../../services/browser-lifecycle.js', () => ({
  BrowserLifecycle: vi.fn().mockImplementation(function () {
    return {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
      getPage: vi.fn().mockReturnValue({}),
      getCdpPort: vi.fn().mockReturnValue(9222),
      getCurrentUrl: vi.fn().mockReturnValue('https://example.com'),
      getViewport: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
      getCdpEndpoint: vi.fn().mockResolvedValue('ws://localhost:9222'),
      getTitle: vi.fn().mockResolvedValue('Test Page'),
      getTabs: vi.fn().mockResolvedValue([]),
      switchTab: vi.fn().mockResolvedValue({}),
      setOnStateChange: vi.fn(),
      isOpen: vi.fn().mockReturnValue(true),
      screenshot: vi.fn().mockResolvedValue({
        screenshot: 'base64image',
        viewport: { width: 1920, height: 1080 },
      }),
    };
  }),
}));

vi.mock('../../../services/page-actions.js', () => ({
  PageActions: vi.fn().mockImplementation(function () {
    return {
      click: vi.fn().mockResolvedValue(undefined),
      clickBySelector: vi.fn().mockResolvedValue(undefined),
      clickByMarker: vi.fn().mockResolvedValue({ success: true }),
      type: vi.fn().mockResolvedValue(undefined),
      typeByMarker: vi.fn().mockResolvedValue({ success: true }),
      scroll: vi.fn().mockResolvedValue(undefined),
      focus: vi.fn().mockResolvedValue(undefined),
      blur: vi.fn().mockResolvedValue(undefined),
      hover: vi.fn().mockResolvedValue(undefined),
      setValue: vi.fn().mockResolvedValue(undefined),
      dispatchEvent: vi.fn().mockResolvedValue(undefined),
      focusByMarker: vi.fn().mockResolvedValue({ success: true }),
      blurByMarker: vi.fn().mockResolvedValue({ success: true }),
      hoverByMarker: vi.fn().mockResolvedValue({ success: true }),
      setValueByMarker: vi.fn().mockResolvedValue({ success: true }),
      dispatchEventByMarker: vi.fn().mockResolvedValue({ success: true }),
      setPage: vi.fn(),
      executeScript: vi.fn().mockResolvedValue(undefined),
      getElementAt: vi.fn().mockResolvedValue({
        selector: '#test',
        tag: 'button',
        isVisible: true,
        isInteractable: true,
      }),
    };
  }),
}));

vi.mock('../../../services/dom-extractor.js', () => ({
  DOMExtractor: vi.fn().mockImplementation(function () {
    return {
      getSimplifiedDOMV2: vi.fn().mockResolvedValue({
        snapshot_id: 'test-snapshot',
        interactive_elements: [],
      }),
      setPage: vi.fn(),

    };
  }),
}));

// Import after mocks are defined
import { BrowserService } from '../../../services/browser-service.js';

describe('BrowserService', () => {
  beforeEach(() => {
    // Reset the singleton instance before each test
    (BrowserService as any).instance = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const service1 = BrowserService.getInstance();
      const service2 = BrowserService.getInstance();
      expect(service1).toBe(service2);
    });

    it('should reset instance', () => {
      const service1 = BrowserService.getInstance();
      BrowserService.resetInstance();
      const service2 = BrowserService.getInstance();
      expect(service1).not.toBe(service2);
    });
  });

  describe('Lifecycle Management', () => {
    it('should open browser with default options', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      expect(service['lifecycle'].open).toHaveBeenCalledWith({
        headless: false,
        viewport: { width: 1920, height: 1080 },
      });
    });

    it('should open browser with custom options', async () => {
      const service = BrowserService.getInstance();
      await service.open(true, { width: 1280, height: 720 }, 9223);
      expect(service['lifecycle'].open).toHaveBeenCalledWith({
        headless: true,
        viewport: { width: 1280, height: 720 },
        cdpPort: 9223,
      });
    });

    it('should close browser', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.close();
      expect(service['lifecycle'].close).toHaveBeenCalled();
    });

    it('should check if browser is open', () => {
      const service = BrowserService.getInstance();
      expect(service.isOpen()).toBe(true);
    });

    it('should get CDP port', () => {
      const service = BrowserService.getInstance();
      expect(service.getCdpPort()).toBe(9222);
    });

    it('should get current URL', () => {
      const service = BrowserService.getInstance();
      expect(service.getCurrentUrl()).toBe('https://example.com');
    });

    it('should build debug status from lifecycle state', async () => {
      const service = BrowserService.getInstance();

      await expect(service.getDebugStatus('navigate')).resolves.toEqual({
        isOpen: true,
        url: 'https://example.com',
        title: 'Test Page',
        status: 'ready',
        viewport: { width: 1920, height: 1080 },
        reason: 'navigate',
      });
    });

    it('should build closed debug status without requesting the title', async () => {
      const service = BrowserService.getInstance();
      service['lifecycle'].isOpen.mockReturnValue(false);
      service['lifecycle'].getCurrentUrl.mockReturnValue(undefined);
      service['lifecycle'].getViewport.mockReturnValue(null);

      await expect(service.getDebugStatus('close')).resolves.toEqual({
        isOpen: false,
        url: null,
        title: null,
        status: 'unknown',
        viewport: undefined,
        reason: 'close',
      });
      expect(service['lifecycle'].getTitle).not.toHaveBeenCalled();
    });

    it('should get CDP endpoint', async () => {
      const service = BrowserService.getInstance();
      const endpoint = await service.getCdpEndpoint();
      expect(service['lifecycle'].getCdpEndpoint).toHaveBeenCalled();
      expect(endpoint).toBe('ws://localhost:9222');
    });

    it('should get page title', async () => {
      const service = BrowserService.getInstance();
      const title = await service.getTitle();
      expect(service['lifecycle'].getTitle).toHaveBeenCalled();
      expect(title).toBe('Test Page');
    });

    it('should get page instance', () => {
      const service = BrowserService.getInstance();
      const page = service.getPage();
      expect(service['lifecycle'].getPage).toHaveBeenCalled();
      expect(page).toBeDefined();
    });
  });

  describe('Navigation', () => {
    it('should navigate to URL with default waitUntil', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.navigate('https://example.com');
      expect(service['lifecycle'].navigate).toHaveBeenCalledWith(
        'https://example.com',
        'networkidle'
      );
    });

    it('should navigate to URL with custom waitUntil', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.navigate('https://example.com', 'load');
      expect(service['lifecycle'].navigate).toHaveBeenCalledWith(
        'https://example.com',
        'load'
      );
    });
  });

  describe('Screenshot', () => {
    it('should take screenshot with default options', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      const result = await service.screenshot();
      expect(service['lifecycle'].screenshot).toHaveBeenCalledWith(false);
      expect(result).toHaveProperty('screenshot');
      expect(result).toHaveProperty('viewport');
    });

    it('should take full page screenshot', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.screenshot(true);
      expect(service['lifecycle'].screenshot).toHaveBeenCalledWith(true);
    });
  });

  describe('Click Actions', () => {
    it('should click by coordinates', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.click(500, 300);
      expect(service['pageActions'].click).toHaveBeenCalledWith(500, 300);
    });

    it('should click by selector', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.clickBySelector('#button');
      expect(service['pageActions'].clickBySelector).toHaveBeenCalledWith('#button', undefined);
    });

    it('should click by selector with options', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.clickBySelector('#button', { button: 'right', clickCount: 2 });
      expect(service['pageActions'].clickBySelector).toHaveBeenCalledWith('#button', {
        button: 'right',
        clickCount: 2,
      });
    });

    it('should click by marker', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      const result = await service.clickByMarker('snapshot-1', 123);
      expect(service['pageActions'].clickByMarker).toHaveBeenCalledWith('snapshot-1', 123);
      expect(result).toHaveProperty('success');
    });
  });

  describe('Type Actions', () => {
    it('should type text by selector', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.type('#input', 'test text');
      expect(service['pageActions'].type).toHaveBeenCalledWith('#input', 'test text', undefined);
    });

    it('should type text by selector with options', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.type('#input', 'test text', { delay: 50, clear: true });
      expect(service['pageActions'].type).toHaveBeenCalledWith('#input', 'test text', {
        delay: 50,
        clear: true,
      });
    });

    it('should type by marker', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      const result = await service.typeByMarker('snapshot-1', 123, 'test text');
      expect(service['pageActions'].typeByMarker).toHaveBeenCalledWith('snapshot-1', 123, 'test text', undefined);
      expect(result).toHaveProperty('success');
    });
  });

  describe('Scroll Actions', () => {
    it('should scroll by coordinates', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.scroll(0, 100);
      expect(service['pageActions'].scroll).toHaveBeenCalledWith(0, 100);
    });

    it('should scroll with default values', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.scroll();
      expect(service['pageActions'].scroll).toHaveBeenCalledWith(0, 0);
    });
  });

  describe('Element State Actions', () => {
    it('should focus element', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.focus('#input');
      expect(service['pageActions'].focus).toHaveBeenCalledWith('#input');
    });

    it('should blur element', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.blur('#input');
      expect(service['pageActions'].blur).toHaveBeenCalledWith('#input');
    });

    it('should hover element', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.hover('#button');
      expect(service['pageActions'].hover).toHaveBeenCalledWith('#button');
    });

    it('should set element value', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.setValue('#input', 'value');
      expect(service['pageActions'].setValue).toHaveBeenCalledWith('#input', 'value');
    });

    it('should dispatch event', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.dispatchEvent('#input', 'click');
      expect(service['pageActions'].dispatchEvent).toHaveBeenCalledWith('#input', 'click');
    });
  });

  describe('Marker Actions', () => {
    it('should focus by marker', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      const result = await service.focusByMarker('snapshot-1', 123);
      expect(service['pageActions'].focusByMarker).toHaveBeenCalledWith('snapshot-1', 123);
      expect(result).toHaveProperty('success');
    });

    it('should blur by marker', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      const result = await service.blurByMarker('snapshot-1', 123);
      expect(service['pageActions'].blurByMarker).toHaveBeenCalledWith('snapshot-1', 123);
      expect(result).toHaveProperty('success');
    });

    it('should hover by marker', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      const result = await service.hoverByMarker('snapshot-1', 123);
      expect(service['pageActions'].hoverByMarker).toHaveBeenCalledWith('snapshot-1', 123);
      expect(result).toHaveProperty('success');
    });

    it('should set value by marker', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      const result = await service.setValueByMarker('snapshot-1', 123, 'value');
      expect(service['pageActions'].setValueByMarker).toHaveBeenCalledWith('snapshot-1', 123, 'value');
      expect(result).toHaveProperty('success');
    });

    it('should dispatch event by marker', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      const result = await service.dispatchEventByMarker('snapshot-1', 123, 'click');
      expect(service['pageActions'].dispatchEventByMarker).toHaveBeenCalledWith('snapshot-1', 123, 'click');
      expect(result).toHaveProperty('success');
    });
  });

  describe('DOM Extraction', () => {
    it('should get simplified DOM V2', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      const dom = await service.getSimplifiedDOMV2();
      expect(dom).toHaveProperty('snapshot_id');
      expect(service['domExtractor'].getSimplifiedDOMV2).toHaveBeenCalled();
    });


  });

  describe('Script Execution', () => {
    it('should execute script', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      await service.executeScript('document.title');
      expect(service['pageActions'].executeScript).toHaveBeenCalledWith('document.title');
    });
  });

  describe('Element Queries', () => {
    it('should get element at coordinates', async () => {
      const service = BrowserService.getInstance();
      await service.open();
      const element = await service.getElementAt(500, 300);
      expect(service['pageActions'].getElementAt).toHaveBeenCalledWith(500, 300);
      expect(element).toHaveProperty('selector');
      expect(element).toHaveProperty('tag');
      expect(element).toHaveProperty('isVisible');
      expect(element).toHaveProperty('isInteractable');
    });
  });
});
