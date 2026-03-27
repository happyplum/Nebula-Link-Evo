import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cdpRoutes from '../cdp.js';
import { BrowserService } from '../../../services/browser-service.js';

vi.mock('../../../services/browser-service.js', () => {
  return {
    BrowserService: {
      getInstance: vi.fn().mockReturnValue({
        isOpen: vi.fn().mockReturnValue(true),
        getCdpEndpoint: vi.fn().mockResolvedValue('ws://localhost:9222/devtools/browser/123'),
        getCdpPort: vi.fn().mockReturnValue(9222)
      })
    }
  };
});

describe('CDP Routes', () => {
  let app: any;
  let mockBrowserService: any;

  beforeEach(async () => {
    app = Fastify();
    await app.register(websocket);
    await app.register(cdpRoutes);
    mockBrowserService = BrowserService.getInstance();
    vi.clearAllMocks();
  });

  describe('GET /cdp-status', () => {
    it('should return CDP status when browser is open', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cdp-status'
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        browserOpen: true,
        cdpPort: 9222,
        cdpEndpoint: 'ws://localhost:9222/devtools/browser/123',
        ready: true
      });
    });

    it('should return CDP status when browser is closed', async () => {
      mockBrowserService.isOpen.mockReturnValueOnce(false);
      mockBrowserService.getCdpPort.mockReturnValueOnce(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/cdp-status'
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        browserOpen: false,
        cdpEndpoint: 'Not available',
        ready: false
      });
    });
  });
});
