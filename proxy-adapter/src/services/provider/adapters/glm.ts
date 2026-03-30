import crypto from 'crypto';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ProviderConfig } from '../types.js';
import { ProviderError, PROVIDER_ERRORS } from '../errors.js';

export interface GLMProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/** Callable that produces a LanguageModelV3 for a given model ID. */
type ProviderFn = (modelId: string) => LanguageModelV3;

/**
 * Creates a GLM provider adapter with JWT token authentication.
 *
 * @param config - Provider configuration containing apiKey (format: id.secret)
 * @returns A function that creates LanguageModelV3 instances for given model IDs
 * @throws {ProviderError} If apiKey is missing or has invalid format
 */
export function createGLMAdapter(config: ProviderConfig): ProviderFn {
  if (!config.apiKey) {
    throw new ProviderError(
      PROVIDER_ERRORS.CONFIG_INVALID,
      'glm',
      'GLM provider requires an apiKey',
    );
  }

  const jwtToken = generateJWTToken(config.apiKey);
  const baseUrl: string = config.baseUrl || 'https://open.bigmodel.cn/api/paas/v4';

  const provider = createOpenAICompatible({
    name: 'glm',
    baseURL: baseUrl,
    apiKey: jwtToken,
  });

  // Return a function that creates language models (matching ProviderFn type)
  return (modelId: string) => provider.languageModel(modelId);
}

 function generateJWTToken(apiKey: string): string {
  const parts = apiKey.split('.');
  if (parts.length !== 2) {
    throw new ProviderError(
      PROVIDER_ERRORS.CONFIG_INVALID,
      'glm',
      'Invalid GLM API key format. Expected format: id.secret',
    );
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
