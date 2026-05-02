import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import browserRoutes from '../browser.js';
import { BrowserService } from '../../../services/browser-service.js';
import { debugEventHub } from '../../../services/debug-event-hub.js';

vi.mock('../../../services/browser-service.js', () => ({
  BrowserService: {
    getInstance: vi.fn().mockReturnValue({
      open: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
      screenshot: vi
        .fn()
        .mockResolvedValue({ screenshot: 'base64', viewport: { width: 800, height: 600 } }),
      close: vi.fn().mockResolvedValue(undefined),
      switchTab: vi.fn().mockResolvedValue(undefined),
      getTabs: vi.fn().mockResolvedValue([]),
      isOpen: vi.fn().mockReturnValue(true),
      getCurrentUrl: vi.fn().mockReturnValue('https://example.com'),
      getTitle: vi.fn().mockResolvedValue('Example Domain'),
      getViewport: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
      getDebugStatus: vi.fn().mockResolvedValue({
        isOpen: true,
        url: 'https://example.com',
        title: 'Example Domain',
        status: 'ready',
        viewport: { width: 1920, height: 1080 },
        reason: 'navigate',
      }),
    }),
  },
}));

describe('Browser Routes', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;
  let mockBrowserService: ReturnType<typeof BrowserService.getInstance>;
  let publishSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(browserRoutes);
    mockBrowserService = BrowserService.getInstance();
    debugEventHub.resetForTests();
    publishSpy = vi.spyOn(debugEventHub, 'publish').mockImplementation(() => {});
    vi.clearAllMocks();

    vi.mocked(mockBrowserService.isOpen).mockReturnValue(true);
    vi.mocked(mockBrowserService.getCurrentUrl).mockReturnValue('https://example.com');
    vi.mocked(mockBrowserService.getTitle).mockResolvedValue('Example Domain');
    vi.mocked(mockBrowserService.getViewport).mockReturnValue({ width: 1920, height: 1080 });
    vi.mocked(mockBrowserService.getDebugStatus).mockResolvedValue({
      isOpen: true,
      url: 'https://example.com',
      title: 'Example Domain',
      status: 'ready',
      viewport: { width: 1920, height: 1080 },
      reason: 'navigate',
    });
  });

  it('should call open and publish debug status', async () => {
    vi.mocked(mockBrowserService.getDebugStatus).mockResolvedValueOnce({
      isOpen: true,
      url: 'https://example.com',
      title: 'Example Domain',
      status: 'ready',
      viewport: { width: 1920, height: 1080 },
      reason: 'open',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/open',
      payload: { headless: true, viewport: { width: 1024, height: 768 } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      success: true,
      message: 'Browser opened successfully',
    });
    expect(mockBrowserService.open).toHaveBeenCalledWith(true, { width: 1024, height: 768 }, undefined);
    expect(mockBrowserService.getDebugStatus).toHaveBeenCalledWith('open');
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'debug.status',
        status: expect.objectContaining({ reason: 'open' }),
      })
    );
  });

  it('should return 500 on open error', async () => {
    vi.mocked(mockBrowserService.open).mockRejectedValueOnce(new Error('Failed'));
    const response = await app.inject({ method: 'POST', url: '/open', payload: {} });
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.payload)).toEqual({ success: false, error: 'Failed' });
  });

  it('should call navigate, publish status, and return browser status', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/navigate',
      payload: { url: 'https://example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      isOpen: true,
      currentUrl: 'https://example.com',
      title: 'Example Domain',
    });
    expect(mockBrowserService.navigate).toHaveBeenCalledWith('https://example.com', 'networkidle');
    expect(mockBrowserService.getDebugStatus).toHaveBeenCalledWith('navigate');
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'debug.status',
        status: expect.objectContaining({ reason: 'navigate' }),
      })
    );
  });

  it('should return 500 on navigate error', async () => {
    vi.mocked(mockBrowserService.navigate).mockRejectedValueOnce(new Error('Failed'));
    const response = await app.inject({ method: 'POST', url: '/navigate', payload: { url: 'https://example.com' } });
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.payload)).toEqual({ success: false, error: 'Failed' });
  });

  it('should call screenshot and return result', async () => {
    const response = await app.inject({ method: 'POST', url: '/screenshot', payload: { fullPage: true } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      success: true,
      screenshot: 'base64',
      viewport: { width: 800, height: 600 },
    });
    expect(mockBrowserService.screenshot).toHaveBeenCalledWith(true);
  });

  it('should return 500 on screenshot error', async () => {
    vi.mocked(mockBrowserService.screenshot).mockRejectedValueOnce(new Error('Failed'));
    const response = await app.inject({ method: 'POST', url: '/screenshot', payload: {} });
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.payload)).toEqual({ success: false, error: 'Failed' });
  });

  it('should call close and publish debug status', async () => {
    vi.mocked(mockBrowserService.getDebugStatus).mockResolvedValueOnce({
      isOpen: false,
      url: null,
      title: null,
      status: 'unknown',
      viewport: null,
      reason: 'close',
    });

    const response = await app.inject({ method: 'POST', url: '/close' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ success: true, message: 'Browser closed successfully' });
    expect(mockBrowserService.close).toHaveBeenCalled();
    expect(mockBrowserService.getDebugStatus).toHaveBeenCalledWith('close');
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'debug.status',
        status: expect.objectContaining({ reason: 'close' }),
      })
    );
  });

  it('should return browser status', async () => {
    const response = await app.inject({ method: 'GET', url: '/status' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      isOpen: true,
      currentUrl: 'https://example.com',
      title: 'Example Domain',
      viewport: { width: 1920, height: 1080 },
    });
  });

  it('publishes debug status after switching tabs', async () => {
    vi.mocked(mockBrowserService.getDebugStatus).mockResolvedValueOnce({
      isOpen: true,
      url: 'https://example.com/next',
      title: 'Next Tab',
      status: 'ready',
      viewport: { width: 1920, height: 1080 },
      reason: 'switch_tab',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/tabs/switch',
      payload: { id: 'tab-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockBrowserService.switchTab).toHaveBeenCalledWith('tab-1');
    expect(mockBrowserService.getDebugStatus).toHaveBeenCalledWith('switch_tab');
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'debug.status',
        status: expect.objectContaining({ reason: 'switch_tab' }),
      })
    );
  });
});
