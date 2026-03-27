import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import actionRoutes from '../action.js';
import { BrowserService } from '../../../services/browser-service.js';

vi.mock('../../../services/browser-service.js', () => {
  return {
    BrowserService: {
      getInstance: vi.fn().mockReturnValue({
        click: vi.fn().mockResolvedValue(undefined),
        clickBySelector: vi.fn().mockResolvedValue(undefined),
        clickByMarker: vi.fn().mockResolvedValue({ success: true, strategy_used: 'test', attempts: 1, latency_ms: 10 }),
        type: vi.fn().mockResolvedValue(undefined),
        typeByMarker: vi.fn().mockResolvedValue({ success: true, strategy_used: 'test', attempts: 1, latency_ms: 10 }),
        scroll: vi.fn().mockResolvedValue(undefined),
        focus: vi.fn().mockResolvedValue(undefined),
        focusByMarker: vi.fn().mockResolvedValue({ success: true, strategy_used: 'test', attempts: 1, latency_ms: 10 }),
        blur: vi.fn().mockResolvedValue(undefined),
        blurByMarker: vi.fn().mockResolvedValue({ success: true, strategy_used: 'test', attempts: 1, latency_ms: 10 }),
        hover: vi.fn().mockResolvedValue(undefined),
        hoverByMarker: vi.fn().mockResolvedValue({ success: true, strategy_used: 'test', attempts: 1, latency_ms: 10 }),
        setValue: vi.fn().mockResolvedValue(undefined),
        setValueByMarker: vi.fn().mockResolvedValue({ success: true, strategy_used: 'test', attempts: 1, latency_ms: 10 }),
        dispatchEvent: vi.fn().mockResolvedValue(undefined),
        dispatchEventByMarker: vi.fn().mockResolvedValue({ success: true, strategy_used: 'test', attempts: 1, latency_ms: 10 }),
      })
    }
  };
});

describe('Action Routes', () => {
  let app: any;
  let mockBrowserService: any;

  beforeEach(async () => {
    app = Fastify();
    await app.register(actionRoutes);
    mockBrowserService = BrowserService.getInstance();
    vi.clearAllMocks();
  });

  describe('POST /click', () => {
    it('should call click and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/click',
        payload: { x: 100, y: 200 }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Clicked at (100, 200)'
      });
      expect(mockBrowserService.click).toHaveBeenCalledWith(100, 200);
    });

    it('should retry on failure and return success', async () => {
      mockBrowserService.click
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/click',
        payload: { x: 100, y: 200 }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Clicked at (100, 200)'
      });
      expect(mockBrowserService.click).toHaveBeenCalledTimes(2);
    });

    it('should return 500 after max retries', async () => {
      mockBrowserService.click.mockRejectedValue(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/click',
        payload: { x: 100, y: 200 }
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed'
      });
      expect(mockBrowserService.click).toHaveBeenCalledTimes(3);
    });
  });

  describe('POST /click-by-selector', () => {
    it('should call clickBySelector and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/click-by-selector',
        payload: { selector: '#test' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Clicked element: #test'
      });
      expect(mockBrowserService.clickBySelector).toHaveBeenCalledWith('#test', undefined);
    });

    it('should fallback to force click on failure', async () => {
      mockBrowserService.clickBySelector
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/click-by-selector',
        payload: { selector: '#test', options: { delay: 100 } }
      });

      expect(response.statusCode).toBe(200);
      expect(mockBrowserService.clickBySelector).toHaveBeenCalledTimes(2);
      expect(mockBrowserService.clickBySelector).toHaveBeenNthCalledWith(1, '#test', { delay: 100, button: 'left', clickCount: 1 });
      expect(mockBrowserService.clickBySelector).toHaveBeenNthCalledWith(2, '#test', { delay: 100, button: 'left', clickCount: 1, force: true });
    });

    it('should return 500 if force click also fails', async () => {
      mockBrowserService.clickBySelector.mockRejectedValue(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/click-by-selector',
        payload: { selector: '#test' }
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed'
      });
    });
  });

  describe('POST /click-by-marker', () => {
    it('should call clickByMarker and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/click-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123 }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        strategy_used: 'test',
        attempts: 1,
        latency_ms: 10
      });
      expect(mockBrowserService.clickByMarker).toHaveBeenCalledWith('snap-1', 123);
    });

    it('should return 200 with success=false if marker click fails', async () => {
      mockBrowserService.clickByMarker.mockResolvedValueOnce({
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: 5,
        error: { code: 'error', message: 'Failed' }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/click-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123 }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: 5,
        error: { code: 'error', message: 'Failed' }
      });
    });

    it('should return 500 on unexpected error', async () => {
      mockBrowserService.clickByMarker.mockRejectedValueOnce(new Error('Unexpected'));

      const response = await app.inject({
        method: 'POST',
        url: '/click-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123 }
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Unexpected'
      });
    });
  });

  describe('POST /type', () => {
    it('should call type and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/type',
        payload: { selector: '#test', text: 'hello' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Typed "hello" into #test'
      });
      expect(mockBrowserService.type).toHaveBeenCalledWith('#test', 'hello', undefined);
    });

    it('should retry with force option on failure', async () => {
      mockBrowserService.type
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/type',
        payload: { selector: '#test', text: 'hello' }
      });

      expect(response.statusCode).toBe(200);
      expect(mockBrowserService.type).toHaveBeenCalledTimes(2);
      expect(mockBrowserService.type).toHaveBeenNthCalledWith(1, '#test', 'hello', undefined);
      expect(mockBrowserService.type).toHaveBeenNthCalledWith(2, '#test', 'hello', { force: true });
    });

    it('should return 500 after max retries', async () => {
      mockBrowserService.type.mockRejectedValue(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/type',
        payload: { selector: '#test', text: 'hello' }
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed'
      });
      expect(mockBrowserService.type).toHaveBeenCalledTimes(3);
    });
  });

  describe('POST /scroll', () => {
    it('should call scroll and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/scroll',
        payload: { x: 0, y: 500 }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Scrolled by (0, 500)'
      });
      expect(mockBrowserService.scroll).toHaveBeenCalledWith(0, 500);
    });

    it('should return 500 on error', async () => {
      mockBrowserService.scroll.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/scroll',
        payload: { x: 0, y: 500 }
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Failed'
      });
    });
  });

  describe('POST /focus', () => {
    it('should call focus and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/focus',
        payload: { selector: '#test' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Focused element: #test'
      });
      expect(mockBrowserService.focus).toHaveBeenCalledWith('#test');
    });

    it('should return 500 on error', async () => {
      mockBrowserService.focus.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/focus',
        payload: { selector: '#test' }
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /blur', () => {
    it('should call blur and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/blur',
        payload: { selector: '#test' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Blurred element: #test'
      });
      expect(mockBrowserService.blur).toHaveBeenCalledWith('#test');
    });

    it('should return 500 on error', async () => {
      mockBrowserService.blur.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/blur',
        payload: { selector: '#test' }
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /hover', () => {
    it('should call hover and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hover',
        payload: { selector: '#test' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Hovered element: #test'
      });
      expect(mockBrowserService.hover).toHaveBeenCalledWith('#test');
    });

    it('should return 500 on error', async () => {
      mockBrowserService.hover.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/hover',
        payload: { selector: '#test' }
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /value', () => {
    it('should call setValue and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/value',
        payload: { selector: '#test', value: 'val' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Set value of #test'
      });
      expect(mockBrowserService.setValue).toHaveBeenCalledWith('#test', 'val');
    });

    it('should return 500 on error', async () => {
      mockBrowserService.setValue.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/value',
        payload: { selector: '#test', value: 'val' }
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /dispatch', () => {
    it('should call dispatchEvent and return success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/dispatch',
        payload: { selector: '#test', eventType: 'change' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        message: 'Dispatched change on #test'
      });
      expect(mockBrowserService.dispatchEvent).toHaveBeenCalledWith('#test', 'change');
    });

    it('should return 500 on error', async () => {
      mockBrowserService.dispatchEvent.mockRejectedValueOnce(new Error('Failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/dispatch',
        payload: { selector: '#test', eventType: 'change' }
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /execute-by-marker', () => {
    it('should call clickByMarker for click action', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'click' }
      });

      expect(response.statusCode).toBe(200);
      expect(mockBrowserService.clickByMarker).toHaveBeenCalledWith('snap-1', 123);
    });

    it('should call typeByMarker for type action', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'type', param: 'hello' }
      });

      expect(response.statusCode).toBe(200);
      expect(mockBrowserService.typeByMarker).toHaveBeenCalledWith('snap-1', 123, 'hello', undefined);
    });

    it('should call typeByMarker with object param', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'type', param: { text: 'hello', options: { delay: 10 } } }
      });

      expect(response.statusCode).toBe(200);
      expect(mockBrowserService.typeByMarker).toHaveBeenCalledWith('snap-1', 123, 'hello', { delay: 10 });
    });

    it('should call focusByMarker for focus action', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'focus' }
      });

      expect(response.statusCode).toBe(200);
      expect(mockBrowserService.focusByMarker).toHaveBeenCalledWith('snap-1', 123);
    });

    it('should call blurByMarker for blur action', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'blur' }
      });

      expect(response.statusCode).toBe(200);
      expect(mockBrowserService.blurByMarker).toHaveBeenCalledWith('snap-1', 123);
    });

    it('should call hoverByMarker for hover action', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'hover' }
      });

      expect(response.statusCode).toBe(200);
      expect(mockBrowserService.hoverByMarker).toHaveBeenCalledWith('snap-1', 123);
    });

    it('should call setValueByMarker for value action', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'value', param: 'val' }
      });

      expect(response.statusCode).toBe(200);
      expect(mockBrowserService.setValueByMarker).toHaveBeenCalledWith('snap-1', 123, 'val');
    });

    it('should call dispatchEventByMarker for dispatch action', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'dispatch', param: 'change' }
      });

      expect(response.statusCode).toBe(200);
      expect(mockBrowserService.dispatchEventByMarker).toHaveBeenCalledWith('snap-1', 123, 'change');
    });

    it('should return 400 for unknown action', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'unknown' }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 200 with success=false if action fails', async () => {
      mockBrowserService.clickByMarker.mockResolvedValueOnce({
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: 5,
        error: { code: 'error', message: 'Failed' }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'click' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: 5,
        error: { code: 'error', message: 'Failed' }
      });
    });

    it('should return 500 on unexpected error', async () => {
      mockBrowserService.clickByMarker.mockRejectedValueOnce(new Error('Unexpected'));

      const response = await app.inject({
        method: 'POST',
        url: '/execute-by-marker',
        payload: { snapshot_id: 'snap-1', nebula_id: 123, action: 'click' }
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        error: 'Unexpected'
      });
    });
  });
});
