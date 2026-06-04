import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { PlaywrightClient } from '../playwright-client.js';

vi.mock('axios');

const mockBaseUrl = 'http://localhost:3001';

function createMockInstance() {
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { baseURL: mockBaseUrl },
  };
  return instance;
}

describe('PlaywrightClient', () => {
  let client: PlaywrightClient;
  let mockInstance: ReturnType<typeof createMockInstance>;

  beforeEach(() => {
    mockInstance = createMockInstance();
    vi.mocked(axios.create).mockReturnValue(mockInstance);
    client = new PlaywrightClient(mockBaseUrl);
  });

  describe('getSimplifiedDOM', () => {
    it('returns correct DOMSnapshotResponse shape', async () => {
      const mockResponse = {
        snapshot_id: 'abc-123',
        version: '2.0',
        annotated_screenshot_base64: 'base64data',
        elements_map: {},
        simplified_dom: { tag: 'html', children: [] },
      };
      mockInstance.get.mockResolvedValue({ data: mockResponse });

      const result = await client.getSimplifiedDOM();

      expect(mockInstance.get).toHaveBeenCalledWith('/dom/simplified');
      expect(result).toEqual(mockResponse);
      expect(result.snapshot_id).toBe('abc-123');
      expect(result.version).toBe('2.0');
    });
  });

  describe('getScreenshot', () => {
    it('sends fullPage=true in request body', async () => {
      const mockResponse = {
        screenshot: 'png-base64',
        viewport: { width: 1920, height: 1080 },
      };
      mockInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await client.getScreenshot(true);

      expect(mockInstance.post).toHaveBeenCalledWith('/browser/screenshot', {
        fullPage: true,
      });
      expect(result).toEqual(mockResponse);
    });

    it('sends fullPage=undefined when not specified', async () => {
      const mockResponse = {
        screenshot: 'png-base64',
        viewport: { width: 800, height: 600 },
      };
      mockInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await client.getScreenshot();

      expect(mockInstance.post).toHaveBeenCalledWith('/browser/screenshot', {
        fullPage: undefined,
      });
      expect(result.viewport.width).toBe(800);
    });
  });

  describe('getBrowserStatus', () => {
    it('returns isOpen boolean', async () => {
      mockInstance.get.mockResolvedValue({
        data: { isOpen: true, url: 'https://example.com' },
      });

      const result = await client.getBrowserStatus();

      expect(mockInstance.get).toHaveBeenCalledWith('/browser/status');
      expect(result.isOpen).toBe(true);
      expect(result.url).toBe('https://example.com');
    });

    it('returns isOpen=false without url', async () => {
      mockInstance.get.mockResolvedValue({
        data: { isOpen: false },
      });

      const result = await client.getBrowserStatus();

      expect(result.isOpen).toBe(false);
      expect(result.url).toBeUndefined();
    });
  });

  describe('network error handling', () => {
    it('throws descriptive error on ECONNREFUSED', async () => {
      const connectionError = new Error('connect ECONNREFUSED') as Error & {
        code: string;
      };
      connectionError.code = 'ECONNREFUSED';
      mockInstance.get.mockRejectedValue(connectionError);

      // axios.isAxiosError needs to return false here — our wrapError checks code
      // But axios.isAxiosError won't match a plain Error, so the error passes through
      // Actually let's simulate a proper axios error
      const axiosError = Object.create(new Error('connect ECONNREFUSED'));
      axiosError.code = 'ECONNREFUSED';
      axiosError.isAxiosError = true;
      axiosError.response = undefined;
      axiosError.request = {};
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      mockInstance.get.mockRejectedValue(axiosError);

      await expect(client.getBrowserStatus()).rejects.toThrow(
        `playwright-server not reachable at ${mockBaseUrl}`
      );
    });

    it('throws descriptive error with HTTP status on server error', async () => {
      const axiosError = Object.create(new Error('Server Error'));
      axiosError.isAxiosError = true;
      axiosError.response = { status: 500, statusText: 'Internal Server Error' };
      axiosError.request = undefined;
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      mockInstance.get.mockRejectedValue(axiosError);

      await expect(client.getBrowserStatus()).rejects.toThrow(
        'playwright-server returned 500: Internal Server Error'
      );
    });

    it('passes through non-axios errors', async () => {
      const plainError = new Error('something unexpected');
      vi.mocked(axios.isAxiosError).mockReturnValue(false);
      mockInstance.get.mockRejectedValue(plainError);

      await expect(client.getBrowserStatus()).rejects.toThrow('something unexpected');
    });
  });

  describe('getScreenshot error handling', () => {
    it('throws when response has success: false', async () => {
      mockInstance.post.mockResolvedValue({
        data: { success: false, message: 'Browser not ready' },
      });

      await expect(client.getScreenshot(false)).rejects.toThrow('Browser not ready');
    });

    it('throws default message when success:false has no message', async () => {
      mockInstance.post.mockResolvedValue({
        data: { success: false },
      });

      await expect(client.getScreenshot(false)).rejects.toThrow('Screenshot request failed');
    });
  });

  describe('getBrowserStatus response field', () => {
    it('returns currentUrl field from response', async () => {
      mockInstance.get.mockResolvedValue({
        data: { isOpen: true, currentUrl: 'https://example.com/page', title: 'Test' },
      });

      const result = await client.getBrowserStatus();

      expect(result.isOpen).toBe(true);
      expect(result.currentUrl).toBe('https://example.com/page');
      expect(result.title).toBe('Test');
    });
  });

  describe('4xx error classification', () => {
    it('does NOT classify 4xx errors as "not reachable"', async () => {
      const axiosError = Object.create(new Error('Bad Request'));
      axiosError.isAxiosError = true;
      axiosError.response = { status: 400, statusText: 'Bad Request' };
      axiosError.request = undefined;
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      mockInstance.post.mockRejectedValue(axiosError);

      await expect(client.getScreenshot(false)).rejects.toThrow(
        'playwright-server returned 400: Bad Request'
      );
    });

    it('does NOT classify 404 errors as "not reachable"', async () => {
      const axiosError = Object.create(new Error('Not Found'));
      axiosError.isAxiosError = true;
      axiosError.response = { status: 404, statusText: 'Not Found' };
      axiosError.request = undefined;
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      mockInstance.get.mockRejectedValue(axiosError);

      await expect(client.getBrowserStatus()).rejects.toThrow(
        'playwright-server returned 404: Not Found'
      );
    });
  });
});
