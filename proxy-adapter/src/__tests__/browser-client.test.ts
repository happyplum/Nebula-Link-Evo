import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { BrowserClient } from '../browser-client.js';

vi.mock('axios');

describe('BrowserClient', () => {
  let client: BrowserClient;

  beforeEach(() => {
    client = new BrowserClient();
    vi.clearAllMocks();
  });

  describe('openBrowser', () => {
    it('should call open endpoint', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.openBrowser();
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/browser/open'), {
        headless: false,
        cdpPort: 9222
      }, { timeout: 30000 });
    });
  });

  describe('closeBrowser', () => {
    it('should call close endpoint', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.closeBrowser();
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/browser/close'), {}, { timeout: 30000 });
    });
  });

  describe('navigate', () => {
    it('should call navigate endpoint', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.navigate('https://example.com');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/browser/navigate'), { url: 'https://example.com' }, { timeout: 30000 });
    });
  });

  describe('screenshot', () => {
    it('should call screenshot endpoint', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { screenshot: 'base64' } });
      const result = await client.screenshot();
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/browser/screenshot'), {
        fullPage: false,
        type: 'png'
      }, { timeout: 30000 });
      expect(result).toEqual({ screenshot: 'base64' });
    });
  });

  describe('getSimplifiedDOM', () => {
    it('should return DOM data', async () => {
      const mockData = { snapshot_id: '123', elements_map: {} };
      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockData });
      const result = await client.getSimplifiedDOM();
      expect(result).toEqual(mockData);
    });

    it('should handle missing snapshot_id', async () => {
      const mockData = { elements_map: {} };
      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockData });
      const result = await client.getSimplifiedDOM();
      expect(result).toEqual(mockData);
    });

    it('should handle axios error with response', async () => {
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = { status: 500, data: { error: 'Server error' } };
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.get).mockRejectedValueOnce(error);

      await expect(client.getSimplifiedDOM()).rejects.toThrow('Playwright Server error: 500');
    });

    it('should handle axios error with request only', async () => {
      const error = new Error('Network error') as any;
      error.isAxiosError = true;
      error.request = {};
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.get).mockRejectedValueOnce(error);

      await expect(client.getSimplifiedDOM()).rejects.toThrow('Playwright Server unreachable');
    });

    it('should handle non-axios error', async () => {
      const error = new Error('Unknown error');
      vi.mocked(axios.isAxiosError).mockReturnValue(false);
      vi.mocked(axios.get).mockRejectedValueOnce(error);

      await expect(client.getSimplifiedDOM()).rejects.toThrow('Unknown error');
    });
  });

  describe('actions', () => {
    it('should call click', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.click(100, 200);
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/click'), { x: 100, y: 200 }, { timeout: 30000 });
    });

    it('should call clickBySelector', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.clickBySelector('#test');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/click-by-selector'), { selector: '#test' }, { timeout: 30000 });
    });

    it('should call clickByMarker', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.clickByMarker('snap-1', 123);
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/click-by-marker'), { snapshot_id: 'snap-1', nebula_id: 123 }, { timeout: 30000 });
    });

    it('should call typeByMarker', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.typeByMarker('snap-1', 123, 'hello');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/execute-by-marker'), { snapshot_id: 'snap-1', nebula_id: 123, action: 'type', param: 'hello' }, { timeout: 30000 });
    });

    it('should call focusByMarker', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.focusByMarker('snap-1', 123);
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/execute-by-marker'), { snapshot_id: 'snap-1', nebula_id: 123, action: 'focus' }, { timeout: 30000 });
    });

    it('should call blurByMarker', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.blurByMarker('snap-1', 123);
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/execute-by-marker'), { snapshot_id: 'snap-1', nebula_id: 123, action: 'blur' }, { timeout: 30000 });
    });

    it('should call hoverByMarker', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.hoverByMarker('snap-1', 123);
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/execute-by-marker'), { snapshot_id: 'snap-1', nebula_id: 123, action: 'hover' }, { timeout: 30000 });
    });

    it('should call setValueByMarker', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.setValueByMarker('snap-1', 123, 'val');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/execute-by-marker'), { snapshot_id: 'snap-1', nebula_id: 123, action: 'value', param: 'val' }, { timeout: 30000 });
    });

    it('should call dispatchEventByMarker', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.dispatchEventByMarker('snap-1', 123, 'change');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/execute-by-marker'), { snapshot_id: 'snap-1', nebula_id: 123, action: 'dispatch', param: 'change' }, { timeout: 30000 });
    });

    it('should call type', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.type('#test', 'hello');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/type'), { selector: '#test', text: 'hello' }, { timeout: 30000 });
    });

    it('should call scroll', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.scroll(0, 500);
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/scroll'), { x: 0, y: 500 }, { timeout: 30000 });
    });

    it('should call focus', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.focus('#test');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/focus'), { selector: '#test' }, { timeout: 30000 });
    });

    it('should call blur', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.blur('#test');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/blur'), { selector: '#test' }, { timeout: 30000 });
    });

    it('should call hover', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.hover('#test');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/hover'), { selector: '#test' }, { timeout: 30000 });
    });

    it('should call setValue', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.setValue('#test', 'val');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/value'), { selector: '#test', value: 'val' }, { timeout: 30000 });
    });

    it('should call dispatchEvent', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { success: true } });
      await client.dispatchEvent('#test', 'change');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/dispatch'), { selector: '#test', eventType: 'change' }, { timeout: 30000 });
    });
  });

  describe('elementAction', () => {
    it('should route to correct action', async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { success: true } });

      await client.elementAction('#test', 'click');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/click-by-selector'), { selector: '#test' }, { timeout: 30000 });

      await client.elementAction('#test', 'type', 'hello');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/type'), { selector: '#test', text: 'hello' }, { timeout: 30000 });

      await client.elementAction('#test', 'value', 'val');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/value'), { selector: '#test', value: 'val' }, { timeout: 30000 });

      await client.elementAction('#test', 'focus');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/focus'), { selector: '#test' }, { timeout: 30000 });

      await client.elementAction('#test', 'blur');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/blur'), { selector: '#test' }, { timeout: 30000 });

      await client.elementAction('#test', 'hover');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/hover'), { selector: '#test' }, { timeout: 30000 });

      await client.elementAction('#test', 'dispatch', 'change');
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/action/dispatch'), { selector: '#test', eventType: 'change' }, { timeout: 30000 });
    });

    it('should throw on unknown action', async () => {
      await expect(client.elementAction('#test', 'unknown')).rejects.toThrow('Unknown action: unknown');
    });
  });

  describe('getStatus', () => {
    it('should return status', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { isOpen: true, currentUrl: 'https://example.com', title: 'Example' } });
      const result = await client.getStatus();
      expect(result).toEqual({ isOpen: true, url: 'https://example.com', title: 'Example' });
    });

    it('should handle error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Failed'));
      const result = await client.getStatus();
      expect(result).toEqual({ isOpen: false });
    });
  });

  describe('getElementAt', () => {
    it('should return element', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { success: true, element: { tag: 'div' } } });
      const result = await client.getElementAt(100, 200);
      expect(result).toEqual({ tag: 'div' });
    });

    it('should return null if not found', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { success: false } });
      const result = await client.getElementAt(100, 200);
      expect(result).toBeNull();
    });
  });

  describe('getPageState', () => {
    it('should return page state', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ 
        data: { 
          snapshot_id: 'snap-1', 
          elements_map: {
            '1': { tag: 'div', text: 'hello', bbox: { x: 0, y: 0, width: 10, height: 10 } }
          },
          annotated_screenshot_base64: 'base64'
        } 
      });
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { screenshot: 'base64' } });

      const result = await client.getPageState();
      expect(result).toEqual({
        url: 'snap-1',
        title: 'Snapshot snap-1',
        elements: [
          { tag: 'div', text: 'hello', bbox: { x: 0, y: 0, width: 10, height: 10 }, isVisible: true, isInteractable: true }
        ],
        viewport: { width: 1920, height: 1080 },
        screenshot: 'base64'
      });
    });

    it('should handle error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Failed'));
      const result = await client.getPageState();
      expect(result).toBeNull();
    });
  });
});
