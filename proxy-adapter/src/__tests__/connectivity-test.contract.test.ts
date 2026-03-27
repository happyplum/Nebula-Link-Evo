import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { testConnectivity, ConnectivityTestRequest, ConnectivityTestResponse } from '../services/connectivity-test.js';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    isAxiosError: vi.fn((error: unknown): error is any & { isAxiosError?: boolean } => {
      return error !== null && typeof error === 'object' && 'isAxiosError' in error && (error as any).isAxiosError === true;
    }),
  },
}));

describe('connectivity-test contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('request/response contract', () => {
    it('should have correct request structure', () => {
      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'test-key',
        modelId: 'glm-4',
      };

      expect(request.provider).toBe('glm');
      expect(request.baseUrl).toBeDefined();
      expect(request.apiKey).toBeDefined();
      expect(request.modelId).toBe('glm-4');
    });

    it('should have correct response structure for success', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { content: 'hi' } }] },
      });
      vi.mocked(axios.isAxiosError).mockReturnValue(false);

      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'test-id.test-secret',
        modelId: 'glm-4',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(true);
      expect(response.message).toBe('Successfully connected to provider');
      expect(typeof response.latencyMs).toBe('number');
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
      expect(response.providerErrorCode).toBeUndefined();
    });

    it('should have correct response structure for failure', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('Unauthorized') as any;
      error.isAxiosError = true;
      error.response = { status: 401 };
      error.code = 'ECONNREFUSED';
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'invalid-key',
        modelId: 'glm-4',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(typeof response.message).toBe('string');
      expect(typeof response.latencyMs).toBe('number');
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
      expect(response.providerErrorCode).toBeDefined();
    });

    it('should handle missing API key', async () => {
      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        modelId: 'glm-4',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.message).toBe('API key is required');
      expect(response.providerErrorCode).toBe('AUTH_ERROR');
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle missing base URL', async () => {
      const request: ConnectivityTestRequest = {
        provider: 'glm',
        apiKey: 'test-key',
        modelId: 'glm-4',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.message).toBe('Base URL is required');
      expect(response.providerErrorCode).toBe('NETWORK_ERROR');
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle unsupported provider', async () => {
      const request: ConnectivityTestRequest = {
        provider: 'unknown-provider',
        baseUrl: 'https://example.com',
        apiKey: 'test-key',
        modelId: 'model-1',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.message).toContain('Unsupported provider');
      expect(response.providerErrorCode).toBe('UNKNOWN_ERROR');
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('timeout behavior', () => {
    it('should timeout after 10000ms', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      mockAxiosPost.mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(
              () => {
                const error = new Error('timeout of 10000ms exceeded') as any;
                error.isAxiosError = true;
                error.code = 'ECONNABORTED';
                reject(error);
              },
              100
            )
          )
      );
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'kimi',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'test-key',
        modelId: 'moonshot-v1-vision-preview',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.providerErrorCode).toBe('TIMEOUT');
      expect(response.message).toContain('timeout');
    });
  });

  describe('auth error mapping', () => {
    it('should map 401 to AUTH_ERROR', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('Unauthorized') as any;
      error.isAxiosError = true;
      error.response = { status: 401 };
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'invalid-id.invalid-secret',
        modelId: 'glm-4',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.providerErrorCode).toBe('AUTH_ERROR');
    });

    it('should map 403 to AUTH_ERROR', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('auth forbidden') as any;
      error.isAxiosError = true;
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'forbidden-id.forbidden-secret',
        modelId: 'glm-4',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.providerErrorCode).toBe('AUTH_ERROR');
    });
  });

  describe('network error mapping', () => {
    it('should map ECONNREFUSED to NETWORK_ERROR', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('connect ECONNREFUSED') as any;
      error.isAxiosError = true;
      error.code = 'ECONNREFUSED';
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'kimi',
        baseUrl: 'https://invalid-host',
        apiKey: 'test-key',
        modelId: 'moonshot-v1-vision-preview',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.providerErrorCode).toBe('NETWORK_ERROR');
    });

    it('should map ENOTFOUND to NETWORK_ERROR', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('network error') as any;
      error.isAxiosError = true;
      error.code = 'ENOTFOUND';
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'kimi',
        baseUrl: 'https://unknown-host',
        apiKey: 'test-key',
        modelId: 'moonshot-v1-vision-preview',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.providerErrorCode).toBe('NETWORK_ERROR');
    });

    it('should map ETIMEDOUT to TIMEOUT', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('timeout') as any;
      error.isAxiosError = true;
      error.code = 'ETIMEDOUT';
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'kimi',
        baseUrl: 'https://slow-host',
        apiKey: 'test-key',
        modelId: 'moonshot-v1-vision-preview',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.providerErrorCode).toBe('TIMEOUT');
    });
  });

  describe('model not found error mapping', () => {
    it('should map 404 to MODEL_NOT_FOUND', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('model not found') as any;
      error.isAxiosError = true;
      error.response = { status: 404 };
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'test-id.test-secret',
        modelId: 'non-existent-model',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.providerErrorCode).toBe('MODEL_NOT_FOUND');
    });
  });

  describe('GLM provider', () => {
    it('should successfully connect to GLM', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { content: 'hi' } }] },
      });

      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'test-id.test-secret',
        modelId: 'glm-4',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(true);
      expect(response.message).toBe('Successfully connected to provider');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        {
          model: 'glm-4',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Bearer /),
            'Content-Type': 'application/json',
          }),
          timeout: 10000,
        })
      );
    });

    it('should generate correct JWT token for GLM', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { content: 'hi' } }] },
      });

      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: '12345678.abcdef123456',
        modelId: 'glm-4',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(true);

      const authHeader = (mockAxiosPost.mock.calls[0][2] as { headers: { Authorization: string } }).headers.Authorization;
      expect(authHeader).toMatch(/^Bearer [a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/);
    });
  });

  describe('Kimi provider', () => {
    it('should successfully connect to Kimi', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { content: 'hi' } }] },
      });

      const request: ConnectivityTestRequest = {
        provider: 'kimi',
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: 'test-api-key',
        modelId: 'moonshot-v1-vision-preview',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(true);
      expect(response.message).toBe('Successfully connected to provider');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://api.moonshot.cn/v1/chat/completions',
        {
          model: 'moonshot-v1-vision-preview',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
          timeout: 10000,
        })
      );
    });
  });

  describe('credential security', () => {
    it('should handle credentials without logging them', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('Unauthorized') as any;
      error.isAxiosError = true;
      error.response = { status: 401 };
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'super-secret-api-key-12345',
        modelId: 'glm-4',
      };

      const response = await testConnectivity(request);

      expect(response.ok).toBe(false);
      expect(response.providerErrorCode).toBe('AUTH_ERROR');
    });
  });

  describe('normalized error codes', () => {
    it('should use AUTH_ERROR for auth failures', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('Unauthorized') as any;
      error.isAxiosError = true;
      error.response = { status: 401 };
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'invalid-key',
        modelId: 'glm-4',
      };

      const response = await testConnectivity(request);

      expect(response.providerErrorCode).toBe('AUTH_ERROR');
    });

    it('should use NETWORK_ERROR for network failures', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('Connection refused') as any;
      error.isAxiosError = true;
      error.code = 'ECONNREFUSED';
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'kimi',
        baseUrl: 'https://invalid-host',
        apiKey: 'test-key',
        modelId: 'moonshot-v1-vision-preview',
      };

      const response = await testConnectivity(request);

      expect(response.providerErrorCode).toBe('NETWORK_ERROR');
    });

    it('should use MODEL_NOT_FOUND for missing models', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('model not found') as any;
      error.isAxiosError = true;
      error.response = { status: 404 };
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'glm',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'test-id.test-secret',
        modelId: 'non-existent',
      };

      const response = await testConnectivity(request);

      expect(response.providerErrorCode).toBe('MODEL_NOT_FOUND');
    });

    it('should use TIMEOUT for timeouts', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      const error = new Error('timeout exceeded') as any;
      error.isAxiosError = true;
      error.code = 'ECONNABORTED';
      mockAxiosPost.mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const request: ConnectivityTestRequest = {
        provider: 'kimi',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'test-key',
        modelId: 'moonshot-v1-vision-preview',
      };

      const response = await testConnectivity(request);

      expect(response.providerErrorCode).toBe('TIMEOUT');
    });

    it('should use UNKNOWN_ERROR for other errors', async () => {
      const mockAxiosPost = axios.post as ReturnType<typeof vi.fn>;
      mockAxiosPost.mockRejectedValue(new Error('Some unexpected error'));
      vi.mocked(axios.isAxiosError).mockReturnValue(false);

      const request: ConnectivityTestRequest = {
        provider: 'kimi',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'test-key',
        modelId: 'moonshot-v1-vision-preview',
      };

      const response = await testConnectivity(request);

      expect(response.providerErrorCode).toBe('UNKNOWN_ERROR');
    });
  });
});
