/**
 * T9 Contract: Legacy execution branches and redundant fallback paths removed.
 *
 * Verifies:
 * 1. POST /api/chat/message has been removed (returns 404)
 * 2. POST /api/chat/sessions/:sessionId/messages is the ONLY route triggering AI execution
 * 3. No other registered route handler invokes chatHandler.executeAIResponse or handleChatSend
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import apiChatRoutes from '../../../plugins/routes/api/chat/index.js';
import swaggerPlugin from '../../../plugins/02-swagger.plugin.js';
import errorHandler from '../../../plugins/03-error-handler.plugin.js';
import { ConversationManager } from '../../../conversation/manager.js';
import { ChatHandler } from '../../../conversation/chat-handler.js';
import type { DecisionClient } from '../../../clients/types.js';
import type { ResolvedConfig } from '../../../config/schema.js';

const { mockConfig, mockGetConfig } = vi.hoisted(() => {
  const config: ResolvedConfig = {
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
      mode: 'separation',
      vision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
      decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
    },
    settings: {
      timeout: 30000,
      maxRetries: 3,
      temperature: 0.4,
      maxTokens: 2000,
      maxSteps: 10,
    },
  };

  const getConfig = vi.fn().mockReturnValue(config);
  return { mockConfig: config, mockGetConfig: getConfig };
});

vi.mock('../../../services/index.js', () => ({
  AppService: {
    getInstance: vi.fn().mockReturnValue({
      getConfig: mockGetConfig,
    }),
  },
}));

describe('T9: Legacy execution path removal contract', () => {
  let app: ReturnType<typeof Fastify>;
  let manager: ConversationManager;
  let chatHandler: ChatHandler;
  let handleChatSendSpy: ReturnType<typeof vi.spyOn>;
  let executeAIResponseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    app = Fastify();
    manager = new ConversationManager(':memory:');
    manager.initialize();

    const mockDecisionClient = {
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
      decide: vi.fn(),
      decideStream: vi.fn(),
    } as unknown as DecisionClient;

    chatHandler = new ChatHandler(manager, mockConfig);
    (chatHandler as unknown as Record<string, unknown>).resolveDecisionModel = () => mockDecisionClient;

    handleChatSendSpy = vi.spyOn(chatHandler, 'handleChatSend').mockResolvedValue(undefined);
    executeAIResponseSpy = vi.spyOn(
      chatHandler as unknown as { executeAIResponse: (...args: unknown[]) => Promise<void> },
      'executeAIResponse'
    ).mockResolvedValue(undefined);

    await app.register(swaggerPlugin);
    await app.register(errorHandler);
    app.decorate('conversationManager', manager);
    app.decorate('chatHandler', chatHandler);
    await app.register(apiChatRoutes, { prefix: '/api/chat' });
  });

  afterEach(async () => {
    handleChatSendSpy.mockRestore();
    executeAIResponseSpy.mockRestore();
    await manager.close();
    await app.close();
  });

  describe('Legacy endpoint has been removed', () => {
    it('POST /api/chat/message returns 404', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/message',
        payload: { sessionId: 'any', message: 'Hello' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('never invokes handleChatSend or executeAIResponse', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/chat/message',
        payload: { sessionId: 'any', message: 'test' },
      });

      expect(handleChatSendSpy).not.toHaveBeenCalled();
      expect(executeAIResponseSpy).not.toHaveBeenCalled();
    });

    it('never creates messages even with valid session', async () => {
      const session = manager.createSession({
        title: 'Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await app.inject({
        method: 'POST',
        url: '/api/chat/message',
        payload: { sessionId: session.id, message: 'Hello' },
      });

      expect(manager.getMessages(session.id)).toHaveLength(0);
    });
  });

  describe('Canonical endpoint is the sole execution trigger', () => {
    it('POST /api/chat/sessions/:id/messages invokes handleChatSend', async () => {
      const session = manager.createSession({
        title: 'Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        payload: { content: 'Hello' },
      });

      expect(response.statusCode).toBe(202);
      expect(handleChatSendSpy).toHaveBeenCalledOnce();
    });

    it('control endpoints do NOT trigger AI execution', async () => {
      const session = manager.createSession({
        title: 'Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      // GET session status
      await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}`,
      });

      // GET messages list
      await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/messages`,
      });

      // DELETE session
      await app.inject({
        method: 'DELETE',
        url: `/api/chat/sessions/${session.id}`,
      });

      expect(handleChatSendSpy).not.toHaveBeenCalled();
      expect(executeAIResponseSpy).not.toHaveBeenCalled();
    });

    it('non-chat routes under /api/chat/ do not trigger AI execution', async () => {
      // Probe all common GET endpoints
      const paths = [
        '/api/chat/sessions',
        '/api/chat/stream',
      ];

      for (const path of paths) {
        await app.inject({ method: 'GET', url: path });
      }

      expect(handleChatSendSpy).not.toHaveBeenCalled();
      expect(executeAIResponseSpy).not.toHaveBeenCalled();
    });
  });

  describe('No hidden execution paths in route registration', () => {
    it('messages.ts no longer exists', async () => {
      const fs = await import('node:fs/promises');
      await expect(
        fs.access(new URL('../../../plugins/routes/api/chat/messages.ts', import.meta.url))
      ).rejects.toThrow();
    });
  });
});
