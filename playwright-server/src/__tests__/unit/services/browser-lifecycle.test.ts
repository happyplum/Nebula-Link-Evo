import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chromium } from 'playwright';
import { BrowserLifecycle } from '../../../services/browser-lifecycle.js';
import {
  createBrowserContextMock,
  createMockPage,
} from '../../../../../shared/test-utils/mocks/BrowserContext.mock.ts';

// Mock playwright
vi.mock('playwright', () => {
  return {
    chromium: {
      launch: vi.fn(),
    },
  };
});

describe('BrowserLifecycle', () => {
  let lifecycle: BrowserLifecycle;
  let mockBrowser: any;
  let mockContext: any;
  let mockPage: any;

  beforeEach(() => {
    lifecycle = new BrowserLifecycle();

    mockPage = createMockPage();
    (mockPage as any).viewportSize = vi.fn().mockReturnValue({ width: 1920, height: 1080 });
    mockContext = createBrowserContextMock({ pages: [mockPage] });

    mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
      close: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      off: vi.fn(),
    };

    vi.mocked(chromium.launch).mockResolvedValue(mockBrowser);

    // Mock fetch for getCdpEndpoint
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('open()', () => {
    it('should launch browser with default options', async () => {
      await lifecycle.open();

      expect(chromium.launch).toHaveBeenCalledWith({
        headless: false,
        args: expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox']),
      });
      expect(mockBrowser.newContext).toHaveBeenCalledWith({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(lifecycle.isOpen()).toBe(true);
    });

    it('should launch browser with custom options', async () => {
      await lifecycle.open({
        headless: true,
        viewport: { width: 1280, height: 720 },
        cdpPort: 9222,
      });

      expect(chromium.launch).toHaveBeenCalledWith({
        headless: true,
        args: expect.arrayContaining(['--remote-debugging-port=9222']),
      });
      expect(mockBrowser.newContext).toHaveBeenCalledWith({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      });
      expect(lifecycle.getCdpPort()).toBe(9222);
    });

    it('should handle browser already open', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await lifecycle.open({ headless: false });
      expect(chromium.launch).toHaveBeenCalledTimes(1);

      // Try to open again with different options
      await lifecycle.open({ headless: true });

      // Should not launch again
      expect(chromium.launch).toHaveBeenCalledTimes(1);
      // Should warn about options not taking effect
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Browser already open'),
        expect.any(Object)
      );

      consoleSpy.mockRestore();
    });

    it('should recreate context and page if missing but browser exists', async () => {
      await lifecycle.open();

      // Manually clear context and page to simulate them being closed
      (lifecycle as any).state.context = null;
      (lifecycle as any).state.page = null;

      await lifecycle.open();

      expect(chromium.launch).toHaveBeenCalledTimes(1); // Still 1
      expect(mockBrowser.newContext).toHaveBeenCalledTimes(2); // Called again
      expect(mockContext.newPage).toHaveBeenCalledTimes(2); // Called again
    });
  });

  describe('close()', () => {
    it('should close browser and reset state', async () => {
      await lifecycle.open();
      expect(lifecycle.isOpen()).toBe(true);

      await lifecycle.close();

      expect(mockBrowser.close).toHaveBeenCalled();
      expect(lifecycle.isOpen()).toBe(false);
      expect(lifecycle.getPage()).toBeNull();
      expect(lifecycle.getCdpPort()).toBe(0);
    });

    it('should do nothing if browser is not open', async () => {
      await lifecycle.close();
      expect(mockBrowser.close).not.toHaveBeenCalled();
    });
  });

  describe('navigate()', () => {
    it('should navigate to URL', async () => {
      await lifecycle.open();

      // Get the actual page instance that was created
      const page = lifecycle.getPage();

      await lifecycle.navigate('https://example.com');

      expect(page?.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
    });

    it('should navigate with custom waitUntil', async () => {
      await lifecycle.open();
      const page = lifecycle.getPage();

      await lifecycle.navigate('https://example.com', 'domcontentloaded');

      expect(page?.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    });

    it('should throw error if browser not open', async () => {
      await expect(lifecycle.navigate('https://example.com')).rejects.toThrow('Browser not opened');
    });

    it('should propagate navigation errors', async () => {
      await lifecycle.open();
      const page = lifecycle.getPage() as any;
      page.goto.mockRejectedValueOnce(new Error('Navigation failed'));

      await expect(lifecycle.navigate('https://example.com')).rejects.toThrow('Navigation failed');
    });
  });

  describe('screenshot()', () => {
    it('should take screenshot', async () => {
      await lifecycle.open();
      const page = lifecycle.getPage() as any;

      page.screenshot.mockResolvedValueOnce(Buffer.from('fake-image'));
      page.viewportSize = vi.fn().mockReturnValueOnce({ width: 800, height: 600 });

      const result = await lifecycle.screenshot();

      expect(page?.screenshot).toHaveBeenCalledWith({
        fullPage: false,
        type: 'png',
      });
      expect(result.screenshot).toBe(Buffer.from('fake-image').toString('base64'));
      expect(result.viewport).toEqual({ width: 800, height: 600 });
    });

    it('should take full page screenshot', async () => {
      await lifecycle.open();
      const page = lifecycle.getPage() as any;

      page.screenshot.mockResolvedValueOnce(Buffer.from('fake-image'));
      page.viewportSize = vi.fn().mockReturnValueOnce({ width: 1920, height: 1080 });

      await lifecycle.screenshot(true);

      expect(page?.screenshot).toHaveBeenCalledWith({
        fullPage: true,
        type: 'png',
      });
    });

    it('should throw error if browser not open', async () => {
      await expect(lifecycle.screenshot()).rejects.toThrow('Browser not opened');
    });

    it('should use default viewport if viewportSize returns null', async () => {
      await lifecycle.open();
      const page = lifecycle.getPage() as any;

      page.screenshot.mockResolvedValueOnce(Buffer.from('fake-image'));
      page.viewportSize = vi.fn().mockReturnValueOnce(null);

      const result = await lifecycle.screenshot();

      expect(result.viewport).toEqual({ width: 1920, height: 1080 });
    });
  });

  describe('State Getters', () => {
    it('should return current URL', async () => {
      await lifecycle.open();
      const page = lifecycle.getPage() as any;
      page.url.mockReturnValueOnce('https://test.com');

      expect(lifecycle.getCurrentUrl()).toBe('https://test.com');
    });

    it('should return undefined URL if not open', () => {
      expect(lifecycle.getCurrentUrl()).toBeUndefined();
    });

    it('should return title', async () => {
      await lifecycle.open();
      const page = lifecycle.getPage() as any;
      page.title.mockResolvedValueOnce('Test Title');

      expect(await lifecycle.getTitle()).toBe('Test Title');
    });

    it('should return undefined title if not open', async () => {
      expect(await lifecycle.getTitle()).toBeUndefined();
    });

    it('should return full state', async () => {
      await lifecycle.open({ headless: true, cdpPort: 9222 });

      const state = lifecycle.getState();
      expect(state.browser).toBeDefined();
      expect(state.context).toBeDefined();
      expect(state.page).toBeDefined();
      expect(state.cdpPort).toBe(9222);
      expect(state.lastHeadless).toBe(true);
      expect(state.lastViewport).toEqual({ width: 1920, height: 1080 });
      expect(state.lastCdpPort).toBe(9222);
    });
  });

  describe('getCdpEndpoint()', () => {
    it('should return null if browser not open', async () => {
      expect(await lifecycle.getCdpEndpoint()).toBeNull();
    });

    it('should return null if cdpPort is 0', async () => {
      await lifecycle.open({ cdpPort: 0 });
      expect(await lifecycle.getCdpEndpoint()).toBeNull();
    });

    it('should fetch and return WebSocket URL', async () => {
      await lifecycle.open({ cdpPort: 9222 });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        json: vi
          .fn()
          .mockResolvedValueOnce([
            { webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/123' },
          ]),
      } as any);

      const endpoint = await lifecycle.getCdpEndpoint();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:9222/json');
      expect(endpoint).toBe('ws://localhost:9222/devtools/browser/123');
    });

    it('should return null if fetch fails', async () => {
      await lifecycle.open({ cdpPort: 9222 });

      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      expect(await lifecycle.getCdpEndpoint()).toBeNull();
    });

    it('should return null if response has no targets', async () => {
      await lifecycle.open({ cdpPort: 9222 });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        json: vi.fn().mockResolvedValueOnce([]),
      } as any);

      expect(await lifecycle.getCdpEndpoint()).toBeNull();
    });
  });

  describe('disconnect handling', () => {
    it('should return false from isOpen() after browser disconnects', async () => {
      await lifecycle.open();
      expect(lifecycle.isOpen()).toBe(true);

      // Simulate browser disconnect by firing the registered callback
      const disconnectHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === 'disconnected'
      )?.[1];
      expect(disconnectHandler).toBeDefined();
      disconnectHandler();

      expect(lifecycle.isOpen()).toBe(false);
      expect(lifecycle.getPage()).toBeNull();
      expect(lifecycle.getState().browser).toBeNull();
    });

    it('should re-launch browser on open() after disconnect', async () => {
      await lifecycle.open();
      expect(chromium.launch).toHaveBeenCalledTimes(1);

      // Trigger disconnect
      const disconnectHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === 'disconnected'
      )?.[1];
      disconnectHandler();

      // Re-open should launch a new browser
      await lifecycle.open();
      expect(chromium.launch).toHaveBeenCalledTimes(2);
      expect(lifecycle.isOpen()).toBe(true);
    });

    it('should handle close() on already-disconnected browser without error', async () => {
      await lifecycle.open();

      // Simulate disconnect but keep stale reference
      vi.mocked(mockBrowser.isConnected).mockReturnValue(false);

      // close() should not throw
      await lifecycle.close();

      expect(lifecycle.isOpen()).toBe(false);
      expect(lifecycle.getPage()).toBeNull();
      expect(lifecycle.getCdpPort()).toBe(0);
    });

    it('should return false from isOpen() when isConnected() returns false', async () => {
      await lifecycle.open();
      expect(lifecycle.isOpen()).toBe(true);

      vi.mocked(mockBrowser.isConnected).mockReturnValue(false);

      expect(lifecycle.isOpen()).toBe(false);
    });

    it('should return false from isOpen() when page is closed but browser still connected', async () => {
      await lifecycle.open();
      expect(lifecycle.isOpen()).toBe(true);

      // Simulate user closing browser window (page closed, process alive due to CDP port)
      const page = lifecycle.getPage() as any;
      page.isClosed.mockReturnValue(true);

      expect(lifecycle.isOpen()).toBe(false);
    });

    it('should re-launch browser on open() after page is closed', async () => {
      await lifecycle.open();
      expect(chromium.launch).toHaveBeenCalledTimes(1);

      // Simulate user closing browser window: page closed but process alive
      const page = lifecycle.getPage() as any;
      page.isClosed.mockReturnValue(true);

      // open() should detect stale state, close old browser, and re-launch
      await lifecycle.open();
      expect(chromium.launch).toHaveBeenCalledTimes(2);
      expect(lifecycle.isOpen()).toBe(true);
    });

    it('should invoke onStateChange callback when page closes unexpectedly', async () => {
      const callback = vi.fn();
      lifecycle.setOnStateChange(callback);

      await lifecycle.open();

      // Find the page 'close' handler registered by lifecycle
      const page = lifecycle.getPage() as any;
      const closeHandler = page.on.mock.calls.find((call: any[]) => call[0] === 'close')?.[1];
      expect(closeHandler).toBeDefined();

      // Simulate page close event
      closeHandler();

      expect(callback).toHaveBeenCalledWith('page_closed');

      lifecycle.setOnStateChange(null);
    });

    it('should invoke onStateChange callback when browser disconnects', async () => {
      const callback = vi.fn();
      lifecycle.setOnStateChange(callback);

      await lifecycle.open();

      // Find the browser 'disconnected' handler
      const disconnectHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === 'disconnected'
      )?.[1];
      expect(disconnectHandler).toBeDefined();

      disconnectHandler();

      expect(callback).toHaveBeenCalledWith('browser_disconnected');

      lifecycle.setOnStateChange(null);
    });

    it('should remove page close listener on close()', async () => {
      await lifecycle.open();
      const page = lifecycle.getPage() as any;
      expect(page.off).not.toHaveBeenCalledWith('close', expect.any(Function));

      await lifecycle.close();

      expect(page.off).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should not invoke callback after onStateChange is set to null', async () => {
      const callback = vi.fn();
      lifecycle.setOnStateChange(callback);

      await lifecycle.open();

      lifecycle.setOnStateChange(null);

      const page = lifecycle.getPage() as any;
      const closeHandler = page.on.mock.calls.find((call: any[]) => call[0] === 'close')?.[1];
      closeHandler();

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
