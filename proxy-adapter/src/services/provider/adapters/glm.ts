import crypto from 'crypto';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export interface GLMProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

 export function createGLMProvider(config: GLMProviderConfig): unknown {
  const jwtToken = generateJWTToken(config.apiKey);

  const baseUrl: string = config.baseUrl || 'https://open.bigmodel.cn/api/paas/v4';

  const providerArgs = {
    name: 'glm',
    baseURL: baseUrl,
    apiKey: jwtToken,
  };

  return createOpenAICompatible(providerArgs);
}

 function generateJWTToken(apiKey: string): string {
  const parts = apiKey.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid GLM API key format. Expected format: id.secret');
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
