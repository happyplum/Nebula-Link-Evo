import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, { isAxiosError } from 'axios';
import {
  PlaywrightClient,
  PlaywrightClientError,
  type PlaywrightClientConfig,
} from '../playwright-client.js';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);
vi.mocked(isAxiosError).mockImplementation((error): error is any => {
  return (error as any)?.isAxiosError === true;
});

describe('PlaywrightClient', () => {
  let config: PlaywrightClientConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    PlaywrightClient.resetInstance();
    config = {
      baseUrl: 'http://localhost:3001',
      timeout: 30000,
    };
  });

  afterEach(() => {
    PlaywrightClient.resetInstance();
  });

  describe('Singleton pattern', () => {
    it('should throw when getInstance is called before initialize', () => {
      expect(() => PlaywrightClient.getInstance()).toThrow(
        'PlaywrightClient not initialized'
      );
    });

    it('should create instance on initialize', () => {
      const instance = PlaywrightClient.initialize(config);
      expect(instance).toBeInstanceOf(PlaywrightClient);
    });

    it('should return same instance on subsequent getInstance calls', () => {
      PlaywrightClient.initialize(config);
      const instance1 = PlaywrightClient.getInstance();
      const instance2 = PlaywrightClient.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should reset instance', () => {
      PlaywrightClient.initialize(config);
      PlaywrightClient.resetInstance();
      expect(() => PlaywrightClient.getInstance()).toThrow(
        'PlaywrightClient not initialized'
      );
    });
  });

  describe('navigate', () => {
    it('should navigate to URL successfully', async () => {
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({
          data: { currentUrl: 'https://example.com' },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.navigate('https://example.com');

      expect(result).toEqual({ success: true, url: 'https://example.com' });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/browser/navigate', {
        url: 'https://example.com',
      });
    });

    it('should return URL from response if currentUrl is missing', async () => {
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({ data: {} }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.navigate('https://example.com');

      expect(result).toEqual({ success: true, url: 'https://example.com' });
    });
  });

  describe('getSnapshot', () => {
    it('should get DOM snapshot successfully', async () => {
      const mockElements = {
        'element-1': { tag: 'div', text: 'Hello' },
        'element-2': { tag: 'button', text: 'Click me' },
      };
      const mockAxiosInstance = {
        get: vi.fn().mockResolvedValue({
          data: {
            elements_map: mockElements,
            annotated_screenshot_base64: 'base64image',
          },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.getSnapshot();

      expect(result).toEqual({
        elements: mockElements,
        screenshot: 'base64image',
      });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/dom/simplified');
    });

    it('should handle missing elements_map and screenshot', async () => {
      const mockAxiosInstance = {
        get: vi.fn().mockResolvedValue({ data: {} }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.getSnapshot();

      expect(result).toEqual({
        elements: {},
        screenshot: undefined,
      });
    });
  });

  describe('click', () => {
    it('should click element successfully', async () => {
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({
          data: { success: true, message: 'Clicked' },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.click('#button');

      expect(result).toEqual({ success: true });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/action/click-by-selector',
        { selector: '#button' }
      );
    });
  });

  describe('type', () => {
    it('should type text successfully', async () => {
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({
          data: { success: true, message: 'Typed' },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.type('#input', 'Hello, World!');

      expect(result).toEqual({ success: true });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/action/type', {
        selector: '#input',
        text: 'Hello, World!',
      });
    });
  });

  describe('screenshot', () => {
    it('should capture screenshot successfully', async () => {
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({
          data: { success: true, screenshot: 'base64screenshot' },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.screenshot();

      expect(result).toEqual({ base64: 'base64screenshot' });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/browser/screenshot', {
        fullPage: false,
        type: 'png',
      });
    });

    it('should handle missing screenshot in response', async () => {
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({ data: {} }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.screenshot();

      expect(result).toEqual({ base64: '' });
    });
  });

  describe('executeScript', () => {
    it('should execute script successfully', async () => {
      const mockResult = 42;
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({
          data: { success: true, result: mockResult },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.executeScript('return 42');

      expect(result).toEqual({ result: mockResult });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/dom/script', {
        script: 'return 42',
        args: [],
      });
    });
  });

  describe('getDOM', () => {
    it('should get HTML successfully', async () => {
      const mockHTML = '<html><body>Test</body></html>';
      const mockAxiosInstance = {
        post: vi.fn()
          .mockResolvedValueOnce({
            data: { success: true, result: mockHTML },
          })
          .mockResolvedValueOnce({
            data: { success: true, result: mockHTML },
          }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.getDOM();

      expect(result).toEqual({ html: mockHTML });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/dom/script', {
        script: 'document.documentElement.outerHTML',
        args: [],
      });
    });
  });

  describe('get_cookies', () => {
    it('should get cookies successfully', async () => {
      const mockCookies = [
        { name: 'session', value: 'abc123', domain: 'example.com' },
        { name: 'theme', value: 'dark', domain: 'example.com' },
      ];
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({
          data: { success: true, result: mockCookies },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.get_cookies();

      expect(result).toEqual({ cookies: mockCookies });
    });

    it('should handle empty cookies', async () => {
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({
          data: { success: true, result: [] },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.get_cookies();

      expect(result).toEqual({ cookies: [] });
    });
  });

  describe('get_localStorage', () => {
    it('should get localStorage successfully', async () => {
      const mockData = { key1: 'value1', key2: 'value2' };
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({
          data: { success: true, result: mockData },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.get_localStorage();

      expect(result).toEqual({ data: mockData });
    });

    it('should handle empty localStorage', async () => {
      const mockAxiosInstance = {
        post: vi.fn().mockResolvedValue({
          data: { success: true, result: {} },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.get_localStorage();

      expect(result).toEqual({ data: {} });
    });
  });

  describe('getPageInfo', () => {
    it('should get page info successfully', async () => {
      const mockAxiosInstance = {
        get: vi.fn().mockResolvedValue({
          data: {
            isOpen: true,
            currentUrl: 'https://example.com',
            title: 'Example Page',
          },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.getPageInfo();

      expect(result).toEqual({
        url: 'https://example.com',
        title: 'Example Page',
      });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/browser/status');
    });

    it('should handle missing url and title', async () => {
      const mockAxiosInstance = {
        get: vi.fn().mockResolvedValue({ data: {} }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.getPageInfo();

      expect(result).toEqual({ url: '', title: '' });
    });
  });

  describe('healthCheck', () => {
    it('should return true when health check succeeds', async () => {
      const mockAxiosInstance = {
        get: vi.fn().mockResolvedValue({
          data: { status: 'healthy', browserOpen: true },
        }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/health');
    });

    it('should return false when health check fails', async () => {
      const mockAxiosInstance = {
        get: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should throw PlaywrightClientError on HTTP error', async () => {
      const mockError = new Error('HTTP 404') as any;
      mockError.isAxiosError = true;
      mockError.response = {
        status: 404,
        data: { error: 'Not found' },
      };
      mockError.config = {};
      mockError.request = {};
      const mockAxiosInstance = {
        post: vi.fn().mockRejectedValue(mockError),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      await expect(client.click('#missing')).rejects.toThrow(
        PlaywrightClientError
      );

      try {
        await client.click('#missing');
      } catch (error) {
        expect(error).toBeInstanceOf(PlaywrightClientError);
        const pwcError = error as PlaywrightClientError;
        expect(pwcError.statusCode).toBe(404);
        expect(pwcError.isNetworkError).toBe(false);
      }
    });

    it('should throw PlaywrightClientError on network error', async () => {
      const mockError = new Error('ECONNREFUSED') as any;
      mockError.isAxiosError = true;
      mockError.request = {};
      mockError.config = {};
      mockError.message = 'ECONNREFUSED';
      const mockAxiosInstance = {
        post: vi.fn().mockRejectedValue(mockError),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      await expect(client.click('#button')).rejects.toThrow(
        PlaywrightClientError
      );

      try {
        await client.click('#button');
      } catch (error) {
        expect(error).toBeInstanceOf(PlaywrightClientError);
        const pwcError = error as PlaywrightClientError;
        expect(pwcError.statusCode).toBeUndefined();
        expect(pwcError.isNetworkError).toBe(true);
      }

    });

it('should throw PlaywrightClientError on unknown error', async () => {
      const mockAxiosInstance = {
        post: vi.fn().mockRejectedValue(new Error('Unknown error')),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
      PlaywrightClient.initialize(config);

      const client = PlaywrightClient.getInstance();
      await expect(client.click('#button')).rejects.toThrow(
        PlaywrightClientError
      );
    });
  });
});
