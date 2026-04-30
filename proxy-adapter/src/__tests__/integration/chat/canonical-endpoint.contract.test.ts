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

describe('Canonical endpoint contract', () => {
  let app: ReturnType<typeof Fastify>;
  let manager: ConversationManager;
  let chatHandler: ChatHandler;

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
    (chatHandler as any).resolveDecisionModel = () => mockDecisionClient;

    await app.register(swaggerPlugin);
    await app.register(errorHandler);
    app.decorate('conversationManager', manager);
    app.decorate('chatHandler', chatHandler);
    await app.register(apiChatRoutes, { prefix: '/api/chat' });
  });

  afterEach(async () => {
    await manager.close();
    await app.close();
  });

  describe('POST /api/chat/sessions/:sessionId/messages', () => {
    it('returns 202 with jobId, runId, sessionId, messageId', async () => {
      const session = manager.createSession({
        title: 'Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        payload: { content: 'Hello, world' },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.payload);
      expect(body.jobId).toBeDefined();
      expect(body.runId).toBeDefined();
      expect(body.sessionId).toBe(session.id);
      expect(body.messageId).toBeDefined();

      // Verify UUID format
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(body.jobId).toMatch(uuidPattern);
      expect(body.runId).toMatch(uuidPattern);
      expect(body.messageId).toMatch(uuidPattern);
    });

    it('creates a message in the session', async () => {
      const session = manager.createSession({
        title: 'Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        payload: { content: 'Canonical message' },
      });

      const messages = manager.getMessages(session.id);
      expect(messages.length).toBeGreaterThanOrEqual(1);
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe('Canonical message');
    });

    it('returns 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions/non-existent-session/messages',
        payload: { content: 'Hello' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('not found');
    });

    it('returns 400 for empty content', async () => {
      const session = manager.createSession({
        title: 'Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        payload: { content: '' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
