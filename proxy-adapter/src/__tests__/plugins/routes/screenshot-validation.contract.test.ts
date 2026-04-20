import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { ConversationManager } from '../../../conversation/manager.js';
import { ChatHandler } from '../../../conversation/chat-handler.js';
import { DebugWebSocketManager } from '../../../websocket-manager.js';
import { SessionLock } from '../../../services/session-lock.js';
import type { ResolvedConfig } from '../../../config/schema.js';
import apiChatRoutes from '../../../plugins/routes/api/chat/index.js';
import errorHandler from '../../../plugins/03-error-handler.plugin.js';
import swaggerPlugin from '../../../plugins/02-swagger.plugin.js';
import { MAX_SCREENSHOT_SIZE_BYTES } from '@nebula-link-evo/shared';

const mockConfig: ResolvedConfig = {
  version: '1.0',
  providers: {
    kimi: {
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      npmPackage: '@ai-sdk/openai-compatible',
      models: {
        'moonshot-v1-vision-preview': {
          type: 'vision',
          capabilities: ['vision', 'decision'],
          temperature: 0.4,
          maxTokens: 2000,
        },
      },
    },
  },
  mcp: { enabled: false, servers: {} },
  defaults: {
    vision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
    decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
  },
};

describe('screenshot validation contract', () => {
  let app: ReturnType<typeof Fastify>;
  let manager: ConversationManager;
  let chatHandler: ChatHandler;
  let sessionLock: SessionLock;

  beforeEach(() => {
    app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
    manager = new ConversationManager(':memory:');
    manager.initialize();

    const wsManager = DebugWebSocketManager.getInstance();
    chatHandler = new ChatHandler(manager, mockConfig, wsManager);

    sessionLock = SessionLock.getInstance();
    sessionLock.clear();

    app.register(swaggerPlugin);
    app.register(errorHandler);
    app.decorate('conversationManager', manager);
    app.decorate('chatHandler', chatHandler);

    app.register(apiChatRoutes);
  });

  afterEach(async () => {
    await manager.close();
    sessionLock.clear();
    await app.close();
  });

  it('returns 400 when screenshot exceeds MAX_SCREENSHOT_SIZE_BYTES', async () => {
    const session = manager.createSession({
      title: 'Screenshot Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    // Generate a base64 string that decodes to > 10MB
    // Base64 overhead: each 4 chars = 3 bytes
    // Need > 10MB decoded, so length > 10*1024*1024 * 4/3 = 13981014 chars
    const oversizeBase64 = 'x'.repeat(Math.ceil((MAX_SCREENSHOT_SIZE_BYTES + 1) * (4 / 3)));

    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: {
        content: 'Analyze this screenshot',
        screenshot: oversizeBase64,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.error).toContain('Screenshot exceeds maximum size');
  });

  it('accepts message without screenshot', async () => {
    const session = manager.createSession({
      title: 'No Screenshot Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: {
        content: 'Hello without screenshot',
      },
    });

    expect(response.statusCode).toBe(202);
  });

  it('accepts valid-sized screenshot', async () => {
    const session = manager.createSession({
      title: 'Valid Screenshot Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    // 1KB base64 string — well under 10MB
    const smallBase64 = 'a'.repeat(1024);

    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: {
        content: 'Analyze this',
        screenshot: smallBase64,
      },
    });

    expect(response.statusCode).toBe(202);
  });
});
