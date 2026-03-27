import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import domRoutes from '../dom.js';
import { BrowserService } from '../../../services/browser-service.js';

vi.mock('../../../services/browser-service.js', () => {
  return {
    BrowserService: {
      getInstance: vi.fn().mockReturnValue({
        isOpen: vi.fn().mockReturnValue(true),
        getPage: vi.fn().mockReturnValue({}),
        getSimplifiedDOMV2: vi.fn().mockResolvedValue({
          snapshot_id: 'snap-1',
          version: '2.0',
          annotated_screenshot_base64: 'base64',
          elements_map: {},
          simplified_dom: { elements: [], viewport: { width: 800, height: 600 } }
        }),
        executeScript: vi.fn().mockResolvedValue('result'),
        getElementAt: vi.fn().mockResolvedValue({
          selector: '#test',
          tag: 'div',
          isVisible: true,
          isInteractable: true
        })
      })
    }
  };
});

describe('DOM Routes', () => {
  let app: any;
  let mockBrowserService: any;

  beforeEach(async () => {
    app = Fastify();
    await app.register(domRoutes);
    mockBrowserService = BrowserService.getInstance();
    vi.clearAllMocks();
  });

  describe('GET /simplified', () => {
    it('should return 503 if browser is not open', async () => {
      mockBrowserService.isOpen.mockReturnValueOnce(false);

      const response = await app.inject({
        method: 'GET',
        url: '/simplified'
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Browser is not open',
        code: 'BROWSER_NOT_OPEN'
      });
    });

    it('should return 503 if page is not available', async () => {
      mockBrowserService.isOpen.mockReturnValueOnce(true);
      mockBrowserService.getPage.mockReturnValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/simplified'
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'No page available',
        code: 'NO_PAGE_AVAILABLE'
      });
    });

    it('should return simplified DOM v2', async () => {
      mockBrowserService.isOpen.mockReturnValueOnce(true);
      mockBrowserService.getPage.mockReturnValueOnce({});

      const response = await app.inject({
        method: 'GET',
        url: '/simplified'
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        snapshot_id: 'snap-1',
        version: '2.0',
        annotated_screenshot_base64: 'base64',
        elements_map: {},
        simplified_dom: { elements: [], viewport: { width: 800, height: 600 } }
      });
    });

    it('should return 500 on error', async () => {
      mockBrowserService.isOpen.mockReturnValueOnce(true);
      mockBrowserService.getPage.mockReturnValueOnce({});
      mockBrowserService.getSimplifiedDOMV2.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'GET',
        url: '/simplified'
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed',
        code: 'INTERNAL_ERROR'
      });
    });
  });

  describe('POST /script', () => {
    it('should execute script and return result', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/script',
        payload: { script: 'return 1 + 1;' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true
      });
      expect(mockBrowserService.executeScript).toHaveBeenCalledWith('return 1 + 1;', []);
    });

    it('should reject dangerous scripts', async () => {
      const dangerousScripts = [
        'eval("alert(1)")',
        'new Function("alert(1)")',
        'document.cookie',
        'localStorage.setItem("key", "value")',
        'fetch("https://example.com")',
        'new XMLHttpRequest()',
        '$http.get()'
      ];

      for (const script of dangerousScripts) {
        const response = await app.inject({
          method: 'POST',
          url: '/script',
          payload: { script }
        });

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.payload)).toEqual({
          success: false,
          error: 'Potentially dangerous script detected'
        });
      }
    });

    it('should return 500 on execution error', async () => {
      mockBrowserService.executeScript.mockRejectedValueOnce(new Error('Execution failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/script',
        payload: { script: 'return 1 + 1;' }
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Execution failed'
      });
    });
  });

  describe('GET /element-at', () => {
    it('should return element info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/element-at',
        query: { x: '100', y: '200' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        element: {
          selector: '#test',
          tag: 'div',
          isVisible: true,
          isInteractable: true
        }
      });
      expect(mockBrowserService.getElementAt).toHaveBeenCalledWith(100, 200);
    });

    it('should return 404 if element not found', async () => {
      mockBrowserService.getElementAt.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/element-at',
        query: { x: '100', y: '200' }
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'No element found at specified coordinates'
      });
    });

    it('should return 500 on error', async () => {
      mockBrowserService.getElementAt.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'GET',
        url: '/element-at',
        query: { x: '100', y: '200' }
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed'
      });
    });
  });
});
