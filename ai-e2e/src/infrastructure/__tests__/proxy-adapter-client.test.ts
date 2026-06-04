import crypto from 'node:crypto';
import axios, { isAxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProxyAdapterClient } from '../proxy-adapter-client.js';
import { ServiceError } from '../../services/service-error.js';

vi.mock('axios');

const mockedAxios = vi.mocked(axios);

interface MockAxiosInstance {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
}

function createAxiosInstance(): MockAxiosInstance {
  return {
    get: vi.fn(),
    post: vi.fn(),
  };
}

function expectHeaders(options: unknown, projectId?: string, timeout?: number) {
  expect(options).toMatchObject({
    timeout,
    headers: {
      'x-request-id': 'req-123',
      ...(projectId ? { 'x-project-id': projectId } : {}),
    },
  });
}

describe('ProxyAdapterClient', () => {
  const originalProxyAdapterUrl = process.env.PROXY_ADAPTER_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROXY_ADAPTER_URL = 'http://proxy-adapter.local:3000';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('req-123');
    vi.mocked(isAxiosError).mockImplementation((error): error is any => {
      return (error as { isAxiosError?: boolean })?.isAxiosError === true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalProxyAdapterUrl === undefined) {
      delete process.env.PROXY_ADAPTER_URL;
    } else {
      process.env.PROXY_ADAPTER_URL = originalProxyAdapterUrl;
    }
  });

  it('creates axios client with resolved base URL', () => {
    const mockAxiosInstance = createAxiosInstance();
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    new ProxyAdapterClient({ projectId: 'proj-1' });

    expect(mockedAxios.create).toHaveBeenCalledWith({
      baseURL: 'http://proxy-adapter.local:3000',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('uses localhost default when env is missing', async () => {
    delete process.env.PROXY_ADAPTER_URL;
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, isOpen: true, url: 'https://example.com', title: 'Example' },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();
    await client.getPageInfo();

    expect(mockedAxios.create).toHaveBeenCalledWith({
      baseURL: 'http://localhost:3000',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('generateText calls AI endpoint and maps response shape', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.post.mockResolvedValue({
      data: {
        success: true,
        text: 'Generated text',
        tokenUsage: { promptTokens: 11, completionTokens: 7 },
        model: 'provider/model',
      },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient({ projectId: 'proj-1' });
    const result = await client.generateText('Hello', {
      temperature: 0.3,
      maxTokens: 128,
    });

    expect(result).toEqual({
      text: 'Generated text',
      tokenUsage: { promptTokens: 11, completionTokens: 7 },
    });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/api/ai/generate',
      { prompt: 'Hello', temperature: 0.3, maxTokens: 128 },
      expect.any(Object)
    );
    expectHeaders(mockAxiosInstance.post.mock.calls[0]?.[2], 'proj-1', 300000);
  });

  it('navigate calls debug endpoint and returns requested url', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.post.mockResolvedValue({
      data: { success: true, message: '已导航到 https://example.com' },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient({ projectId: 'proj-1' });
    const result = await client.navigate('https://example.com');

    expect(result).toEqual({ success: true, url: 'https://example.com' });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/debug/api/playwright/navigate',
      { url: 'https://example.com' },
      expect.any(Object)
    );
    expectHeaders(mockAxiosInstance.post.mock.calls[0]?.[2], 'proj-1', 10000);
  });

  it('getSnapshot maps dom payload to ai-e2e shape', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const elementsMap = { btn1: { tag: 'button', text: 'Login' } };
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        success: true,
        dom: {
          elements_map: elementsMap,
          annotated_screenshot_base64: 'snapshot-base64',
          snapshot_id: 'snap-1',
          simplified_dom: '<body />',
          version: '2.0',
        },
      },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient({ projectId: 'proj-1' });
    const result = await client.getSnapshot();

    expect(result).toEqual({
      elements: elementsMap,
      screenshot: 'snapshot-base64',
    });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/debug/api/dom', expect.any(Object));
    expectHeaders(mockAxiosInstance.get.mock.calls[0]?.[1], 'proj-1', 10000);
  });

  it('click sends coordinate payload', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.post.mockResolvedValue({ data: { success: true, message: 'clicked' } });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();
    const result = await client.click(10, 20);

    expect(result).toEqual({ success: true });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/debug/api/playwright/click',
      { x: 10, y: 20 },
      expect.any(Object)
    );
  });

  it('clickBySelector sends selector payload', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.post.mockResolvedValue({ data: { success: true, message: 'clicked' } });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();
    const result = await client.clickBySelector('#login');

    expect(result).toEqual({ success: true });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/debug/api/playwright/click-by-selector',
      { selector: '#login' },
      expect.any(Object)
    );
  });

  it('type sends selector and text payload', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.post.mockResolvedValue({ data: { success: true, message: 'typed' } });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();
    const result = await client.type('#email', 'hello');

    expect(result).toEqual({ success: true });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/debug/api/playwright/type',
      { selector: '#email', text: 'hello' },
      expect.any(Object)
    );
  });

  it('screenshot maps proxy-adapter response', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        success: true,
        screenshot: 'screen-base64',
        viewport: { width: 1280, height: 720 },
      },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();
    const result = await client.screenshot();

    expect(result).toEqual({ base64: 'screen-base64' });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/debug/api/playwright/screenshot',
      expect.any(Object)
    );
  });

  it('executeScript sends script args and returns result', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.post.mockResolvedValue({
      data: { success: true, result: { ok: true } },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();
    const result = await client.executeScript('return arguments[0]', ['value']);

    expect(result).toEqual({ result: { ok: true } });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/debug/api/playwright/execute-script',
      { script: 'return arguments[0]', args: ['value'] },
      expect.any(Object)
    );
  });

  it('getCookies maps cookie payload', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const cookies = [{ name: 'session', value: 'abc', domain: 'example.com' }];
    mockAxiosInstance.get.mockResolvedValue({ data: { success: true, cookies } });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();
    const result = await client.getCookies();

    expect(result).toEqual({ cookies });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/debug/api/playwright/cookies',
      expect.any(Object)
    );
  });

  it('getLocalStorage maps storage payload', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, data: { token: 'abc123' } },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();
    const result = await client.getLocalStorage();

    expect(result).toEqual({ data: { token: 'abc123' } });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/debug/api/playwright/local-storage',
      expect.any(Object)
    );
  });

  it('getPageInfo maps browser status payload', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        success: true,
        isOpen: true,
        url: 'https://example.com',
        title: 'Example',
      },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();
    const result = await client.getPageInfo();

    expect(result).toEqual({ url: 'https://example.com', title: 'Example' });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/debug/api/playwright/status',
      expect.any(Object)
    );
  });

  it('getDOM uses execute-script endpoint contract', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.post.mockResolvedValue({
      data: { success: true, result: '<html><body>ok</body></html>' },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();
    const result = await client.getDOM();

    expect(result).toEqual({ html: '<html><body>ok</body></html>' });
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/debug/api/playwright/execute-script',
      { script: 'document.documentElement.outerHTML' },
      expect.any(Object)
    );
  });

  it('healthCheck returns true only when playwright status is healthy', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        services: {
          playwright: { isOpen: true, url: 'https://example.com', title: 'Example', status: 'healthy' },
        },
      },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient({ projectId: 'proj-1' });
    await expect(client.healthCheck()).resolves.toBe(true);

    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/debug/api/health', expect.any(Object));
    expectHeaders(mockAxiosInstance.get.mock.calls[0]?.[1], 'proj-1', 10000);
  });

  it('openBrowser and closeBrowser hit the debug control endpoints', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.post
      .mockResolvedValueOnce({ data: { success: true, message: 'opened' } })
      .mockResolvedValueOnce({ data: { success: true, message: 'closed' } });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.openBrowser()).resolves.toEqual({ success: true });
    await expect(client.closeBrowser()).resolves.toEqual({ success: true });

    expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
      1,
      '/debug/api/playwright/open',
      undefined,
      expect.any(Object)
    );
    expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
      2,
      '/debug/api/playwright/close',
      undefined,
      expect.any(Object)
    );
  });

  it('throws ServiceError when debug routes return success false', async () => {
    const mockAxiosInstance = createAxiosInstance();
    mockAxiosInstance.post.mockResolvedValue({
      data: { success: false, error: 'selector not found' },
    });
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.clickBySelector('#missing')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'selector not found',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    } satisfies Partial<ServiceError>);
  });

  it('maps AI 503 responses to proxy-adapter unavailable errors', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('503') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 503, data: { error: 'unavailable' } };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.generateText('Hello')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'proxy-adapter unavailable',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    } satisfies Partial<ServiceError>);
  });

  it('maps AI 400 responses to validation errors', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('400') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 400, data: { error: 'invalid prompt' } };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.generateText('Hello')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'invalid prompt',
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    } satisfies Partial<ServiceError>);
  });

  it('maps AI 401 responses to unauthorized errors', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('401') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 401, data: { error: 'invalid API key' } };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.generateText('Hello')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'invalid API key',
      statusCode: 401,
      code: 'UNAUTHORIZED',
    } satisfies Partial<ServiceError>);
  });

  it('maps AI 403 responses to forbidden errors', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('403') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 403, data: { error: 'access denied' } };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.generateText('Hello')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'access denied',
      statusCode: 403,
      code: 'FORBIDDEN',
    } satisfies Partial<ServiceError>);
  });

  it('maps AI 404 responses to not-found errors', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('404') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 404, data: { error: 'model not found' } };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.generateText('Hello')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'model not found',
      statusCode: 404,
      code: 'NOT_FOUND',
    } satisfies Partial<ServiceError>);
  });

  it('maps AI 409 responses to conflict errors', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('409') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 409, data: { error: 'resource conflict' } };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.generateText('Hello')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'resource conflict',
      statusCode: 409,
      code: 'CONFLICT',
    } satisfies Partial<ServiceError>);
  });

  it('maps AI 500 responses to internal errors', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('500') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 500, data: { error: 'internal failure' } };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.generateText('Hello')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'internal failure',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    } satisfies Partial<ServiceError>);
  });

  it('uses fallback message when AI error response has no error field', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('400') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: {} };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 400, data: {} };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.generateText('Hello')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'proxy-adapter AI request failed',
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    } satisfies Partial<ServiceError>);
  });

  it('maps AI 502 responses to generation failed errors', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('502') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 502, data: { error: 'failed' } };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.generateText('Hello')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'AI generation failed',
      statusCode: 500,
    } satisfies Partial<ServiceError>);
  });

  it('maps network failures to unreachable errors', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('ECONNREFUSED') as Error & {
      isAxiosError: boolean;
      request: object;
    };
    error.isAxiosError = true;
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.clickBySelector('#login')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'proxy-adapter unreachable',
      statusCode: 500,
    } satisfies Partial<ServiceError>);
  });

  it('maps Playwright HTTP 400 to validation error', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('400') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 400, data: { error: 'bad selector' } };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.clickBySelector('#bad')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'bad selector',
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    } satisfies Partial<ServiceError>);
  });

  it('maps Playwright HTTP 404 to not-found error', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('404') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 404, data: { error: 'page not found' } };
    error.request = {};
    mockAxiosInstance.get.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.getCookies()).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'page not found',
      statusCode: 404,
      code: 'NOT_FOUND',
    } satisfies Partial<ServiceError>);
  });

  it('maps Playwright HTTP 500 to internal error', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('500') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 500, data: { error: 'browser crashed' } };
    error.request = {};
    mockAxiosInstance.post.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.click(10, 20)).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'browser crashed',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    } satisfies Partial<ServiceError>);
  });

  it('maps Playwright HTTP 503 to proxy-adapter unavailable', async () => {
    const mockAxiosInstance = createAxiosInstance();
    const error = new Error('503') as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { error: string } };
      request: object;
    };
    error.isAxiosError = true;
    error.response = { status: 503, data: { error: 'overloaded' } };
    error.request = {};
    mockAxiosInstance.get.mockRejectedValue(error);
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.screenshot()).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'proxy-adapter unavailable',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    } satisfies Partial<ServiceError>);
  });

  it('degrades gracefully when proxy-adapter URL is empty', async () => {
    process.env.PROXY_ADAPTER_URL = '';
    const mockAxiosInstance = createAxiosInstance();
    mockedAxios.create.mockReturnValue(mockAxiosInstance as never);

    const client = new ProxyAdapterClient();

    await expect(client.generateText('Hello')).rejects.toMatchObject({
      name: 'ServiceError',
      message: 'proxy-adapter not configured (PROXY_ADAPTER_URL is empty)',
      statusCode: 500,
    } satisfies Partial<ServiceError>);
    await expect(client.healthCheck()).resolves.toBe(false);
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    expect(mockAxiosInstance.get).not.toHaveBeenCalled();
  });
});
