import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import streamRoutes from '../stream.js';
import { BrowserService } from '../../../services/browser-service.js';
import { screencastManager } from '../../../screencast.js';

vi.mock('../../../services/browser-service.js', () => {
  return {
    BrowserService: {
      getInstance: vi.fn().mockReturnValue({
        getPage: vi.fn().mockReturnValue({}),
      }),
    },
  };
});

vi.mock('../../../screencast.js', () => {
  return {
    screencastManager: {
      isActive: vi.fn().mockReturnValue(false),
      start: vi.fn().mockResolvedValue(undefined),
      setDebugEnabled: vi.fn(),
      addListener: vi.fn().mockImplementation((res) => {
        res.end();
      }),
      removeListener: vi.fn(),
    },
  };
});

describe('Stream Routes', () => {
  let app: any;
  let mockBrowserService: any;

  beforeEach(async () => {
    app = Fastify();
    await app.register(streamRoutes);
    mockBrowserService = BrowserService.getInstance();
    vi.clearAllMocks();
  });

  describe('GET /stream', () => {
    it('should return 500 if browser not opened', async () => {
      mockBrowserService.getPage.mockReturnValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/stream',
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Browser not opened',
      });
    });

    it('should start screencast if not active', async () => {
      mockBrowserService.getPage.mockReturnValueOnce({});
      vi.mocked(screencastManager.isActive).mockReturnValueOnce(false);

      const response = await app.inject({
        method: 'GET',
        url: '/stream',
      });

      expect(response.statusCode).toBe(200);
      expect(screencastManager.start).toHaveBeenCalled();
      expect(screencastManager.addListener).toHaveBeenCalled();
    });

    it('should not start screencast if already active', async () => {
      mockBrowserService.getPage.mockReturnValueOnce({});
      vi.mocked(screencastManager.isActive).mockReturnValueOnce(true);

      const response = await app.inject({
        method: 'GET',
        url: '/stream',
      });

      expect(response.statusCode).toBe(200);
      expect(screencastManager.start).not.toHaveBeenCalled();
      expect(screencastManager.addListener).toHaveBeenCalled();
    });

    it('should return 500 if start fails', async () => {
      mockBrowserService.getPage.mockReturnValueOnce({});
      vi.mocked(screencastManager.isActive).mockReturnValueOnce(false);
      vi.mocked(screencastManager.start).mockRejectedValueOnce(new Error('Failed to start'));

      const response = await app.inject({
        method: 'GET',
        url: '/stream',
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed to start',
      });
    });
  });
});
