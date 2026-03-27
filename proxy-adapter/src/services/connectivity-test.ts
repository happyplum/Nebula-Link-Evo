import axios, { AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import type { GLMDecisionConfig } from '../clients/decision/glm.js';
import type { KimiDecisionConfig } from '../clients/decision/kimi.js';
import { loadConfig } from '../config/index.js';
import type { Provider } from '../config/schema.js';

export interface ConnectivityTestRequest {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
}

export interface ConnectivityTestResponse {
  ok: boolean;
  message: string;
  latencyMs: number;
  providerErrorCode?: string;
}

export type NormalizedErrorCode =
  | 'AUTH_ERROR'
  | 'NETWORK_ERROR'
  | 'MODEL_NOT_FOUND'
  | 'TIMEOUT'
  | 'UNKNOWN_ERROR';

const CONNECTIVITY_TIMEOUT_MS = 10000;

/**
 * Test connectivity to an AI provider without persisting credentials.
 * Uses a minimal API call (e.g., chat completion with max_tokens=1) to verify auth and network reachability.
 */
export async function testConnectivity(
  request: ConnectivityTestRequest
): Promise<ConnectivityTestResponse> {
  const startTime = Date.now();

  try {
    // Load config to get defaults for optional fields
    const loadResult = loadConfig();
    const config = loadResult.config;

    // Use request values or fall back to config defaults for provider and modelId
    // Note: apiKey and baseUrl must be in request or have config defaults
    let provider: string;
    let modelId: string;
    let providerConfig: Provider | undefined;
    let baseUrl: string | undefined;
    let apiKey: string | undefined;

    if (request.provider) {
      provider = request.provider;
    } else if (config) {
      provider = config.defaults.decision.provider;
      providerConfig = config.providers[provider];
    } else {
      return {
        ok: false,
        message: 'Provider is required',
        latencyMs: Date.now() - startTime,
        providerErrorCode: 'UNKNOWN_ERROR',
      };
    }

    if (request.modelId) {
      modelId = request.modelId;
    } else if (config) {
      modelId = config.defaults.decision.model;
    } else {
      return {
        ok: false,
        message: 'Model ID is required',
        latencyMs: Date.now() - startTime,
        providerErrorCode: 'UNKNOWN_ERROR',
      };
    }

    // Get baseUrl and apiKey from request or provider config
    if (request.baseUrl) {
      baseUrl = request.baseUrl;
    } else if (providerConfig) {
      baseUrl = providerConfig.baseUrl;
    } else {
      return {
        ok: false,
        message: 'Base URL is required',
        latencyMs: Date.now() - startTime,
        providerErrorCode: 'NETWORK_ERROR',
      };
    }

    if (request.apiKey) {
      apiKey = request.apiKey;
    } else if (providerConfig) {
      apiKey = providerConfig.apiKey;
    } else {
      return {
        ok: false,
        message: 'API key is required',
        latencyMs: Date.now() - startTime,
        providerErrorCode: 'AUTH_ERROR',
      };
    }

    let response: unknown;

    switch (provider) {
      case 'glm':
        response = await testGLMConnectivity(baseUrl, apiKey, modelId);
        break;
      case 'kimi':
        response = await testKimiConnectivity(baseUrl, apiKey, modelId);
        break;
      default:
        return {
          ok: false,
          message: `Unsupported provider: ${provider}`,
          latencyMs: Date.now() - startTime,
          providerErrorCode: 'UNKNOWN_ERROR',
        };
    }

    return {
      ok: true,
      message: 'Successfully connected to provider',
      latencyMs: Date.now() - startTime,
    };
  } catch (error) {
    const normalizedError = normalizeError(error);
    return {
      ok: false,
      message: normalizedError.message,
      latencyMs: Date.now() - startTime,
      providerErrorCode: normalizedError.code,
    };
  }
}

async function testGLMConnectivity(
  baseUrl: string,
  apiKey: string,
  modelId: string
): Promise<unknown> {
  const token = generateGLMToken(apiKey);

  const options: AxiosRequestConfig = {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: CONNECTIVITY_TIMEOUT_MS,
  };

  const endpoint = `${baseUrl}/chat/completions`;
  const body = {
    model: modelId,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  };

  const response = await axios.post(endpoint, body, options);
  return response.data;
}

async function testKimiConnectivity(
  baseUrl: string,
  apiKey: string,
  modelId: string
): Promise<unknown> {
  const options: AxiosRequestConfig = {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: CONNECTIVITY_TIMEOUT_MS,
  };

  const endpoint = `${baseUrl}/chat/completions`;
  const body = {
    model: modelId,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  };

  const response = await axios.post(endpoint, body, options);
  return response.data;
}

function generateGLMToken(apiKey: string): string {
  const parts = apiKey.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid GLM API key format');
  }

  const [id, secret] = parts;
  const header = { alg: 'HS256', sign_type: 'SIGN' };
  const payload = {
    api_key: id,
    exp: Math.floor(Date.now() / 1000) + 3600,
    timestamp: Math.floor(Date.now() / 1000),
  };

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');

  return `${base64Header}.${base64Payload}.${signature}`;
}

function normalizeError(error: unknown): { code: NormalizedErrorCode; message: string } {
  // Manual check for axios-like error structure
  if (error !== null && typeof error === 'object') {
    const err = error as any;

    // Check error codes first (highest priority for network and timeout errors)
    if (typeof err.code === 'string') {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || (err.message && err.message.toLowerCase().includes('timeout'))) {
        return {
          code: 'TIMEOUT',
          message: err.message || 'Request timeout',
        };
      }

      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ENETUNREACH') {
        return {
          code: 'NETWORK_ERROR',
          message: err.message || 'Network unreachable',
        };
      }
    }

    // Check status codes second (for auth and model errors from server)
    if (err.response && typeof err.response.status === 'number') {
      const status = err.response.status;

      if (status === 401 || status === 403) {
        return {
          code: 'AUTH_ERROR',
          message: 'Authentication failed: Invalid or missing API key',
        };
      }

      if (status === 404) {
        return {
          code: 'MODEL_NOT_FOUND',
          message: 'Model not found or does not exist',
        };
      }

      // If we have a status code but don't match specific ones, return NETWORK_ERROR
      return {
        code: 'NETWORK_ERROR',
        message: err.message || 'HTTP error',
      };
    }

    // Check error messages for keywords (lowest priority, only if no code/status matched)
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('unauthorized') || message.includes('auth') || message.includes('api key') || message.includes('forbidden')) {
        return {
          code: 'AUTH_ERROR',
          message: error.message,
        };
      }

      if (message.includes('timeout')) {
        return {
          code: 'TIMEOUT',
          message: error.message,
        };
      }

      if (message.includes('model not found')) {
        return {
          code: 'MODEL_NOT_FOUND',
          message: error.message,
        };
      }

      if (message.includes('network') || message.includes('connect') || message.includes('econn') || message.includes('enet')) {
        return {
          code: 'NETWORK_ERROR',
          message: error.message,
        };
      }
    }
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : 'Unknown error',
  };
}
