import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import browserRoutes from '../browser.js';
import { BrowserService } from '../../../services/browser-service.js';

vi.mock('../../../services/browser-service.js', () => {
  return {
    BrowserService: {
      getInstance: vi.fn().mockReturnValue({
        open: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockResolvedValue(undefined),
        screenshot: vi
          .fn()
          .mockResolvedValue({ screenshot: 'base64', viewport: { width: 800, height: 600 } }),
        close: vi.fn().mockResolvedValue(undefined),
        isOpen: vi.fn().mockReturnValue(true),
        getCurrentUrl: vi.fn().mockReturnValue('https://example.com'),
        getTitle: vi.fn().mockResolvedValue('Example Domain'),
        getViewport: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
      }),
    },
  };
});

describe('Browser Routes', () => {
  let app: any;
  let mockBrowserService: any;

  beforeEach(async () => {
    app = Fastify();
    await app.register(browserRoutes);
    mockBrowserService = BrowserService.getInstance();
    vi.clearAllMocks();
    // Re-apply mock implementations after clearAllMocks
    mockBrowserService.isOpen.mockReturnValue(true);
    mockBrowserService.getCurrentUrl.mockReturnValue('https://example.com');
    mockBrowserService.getTitle.mockResolvedValue('Example Domain');
    mockBrowserService.getViewport.mockReturnValue({ width: 1920, height: 1080 });
  });

  describe('POST /open', () => {
    it('should call open and return success', async () => {
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
      expect(mockBrowserService.open).toHaveBeenCalledWith(
        true,
        { width: 1024, height: 768 },
        undefined
      );
    });

    it('should return 500 on error', async () => {
      mockBrowserService.open.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/open',
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed',
      });
    });
  });

  describe('POST /navigate', () => {
    it('should call navigate and return status', async () => {
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
      expect(mockBrowserService.navigate).toHaveBeenCalledWith(
        'https://example.com',
        'networkidle'
      );
    });

    it('should return 500 on error', async () => {
      mockBrowserService.navigate.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/navigate',
        payload: { url: 'https://example.com' },
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed',
      });
    });
  });

  describe('POST /screenshot', () => {
    it('should call screenshot and return result', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/screenshot',
        payload: { fullPage: true },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        screenshot: 'base64',
        viewport: { width: 800, height: 600 },
      });
      expect(mockBrowserService.screenshot).toHaveBeenCalledWith(true);
    });

    it('should return 500 on error', async () => {
      mockBrowserService.screenshot.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/screenshot',
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed',
      });
    });
  });

  describe('POST /close', () => {
    it('should call close and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/close',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Browser closed successfully',
      });
      expect(mockBrowserService.close).toHaveBeenCalled();
    });

    it('should return 500 on error', async () => {
      mockBrowserService.close.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/close',
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed',
      });
    });
  });

  describe('GET /status', () => {
    it('should return browser status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/status',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        isOpen: true,
        currentUrl: 'https://example.com',
        title: 'Example Domain',
        viewport: { width: 1920, height: 1080 },
      });
    });
  });
});
