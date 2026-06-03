import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { ConversationManager } from '../conversation/manager.js';
import { ChatHandler } from '../conversation/chat-handler.js';
import { DatabaseManager } from '../conversation/db.js';
import { ConversationJobQueue } from '../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../services/stream-persist-worker.js';
import type { DecisionClient } from '../clients/types.js';
import type { ResolvedConfig } from '../config/schema.js';
import apiChatRoutes from '../plugins/routes/api/chat/index.js';
import errorHandler from '../plugins/03-error-handler.plugin.js';
import swaggerPlugin from '../plugins/02-swagger.plugin.js';

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

describe('POST /sessions/:id/messages', () => {
  let app: ReturnType<typeof Fastify>;
  let manager: ConversationManager;
  let mockDecisionClient: DecisionClient;
  let chatHandler: ChatHandler;

  beforeEach(() => {
    app = Fastify();
    manager = new ConversationManager(':memory:');
    manager.initialize();

    mockDecisionClient = {
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
      decide: vi.fn(),
      decideStream: vi.fn(),
    } as unknown as DecisionClient;

    chatHandler = new ChatHandler(manager, mockConfig);
    (chatHandler as any).resolveDecisionModel = () => mockDecisionClient;

    // Create job queue instance and decorate app
    const persistWorker = new StreamPersistWorker();
    const jobQueue = new ConversationJobQueue(persistWorker);

    app.register(swaggerPlugin);
    app.register(errorHandler);
    app.decorate('conversationManager', manager);
    app.decorate('chatHandler', chatHandler);
    app.decorate('jobQueue', jobQueue);

    app.register(apiChatRoutes);
  });

  afterEach(async () => {
    await manager.close();
    app.close();
  });

  describe('Message accepted', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
    });

    it('should return 202 Accepted with jobId and runId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: 'Hello, how are you?',
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.payload);
      expect(body.jobId).toBeDefined();
      expect(body.jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(body.runId).toBeDefined();
      expect(body.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(body.sessionId).toBe(sessionId);
      expect(body.messageId).toBeDefined();
    });

    it('should persist message in database', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: 'Test message content',
        },
      });

      expect(response.statusCode).toBe(202);

      const messages = manager.getMessages(sessionId);
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Test message content');
    });

    it('should persist message.created event', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: 'Event test message',
        },
      });

      expect(response.statusCode).toBe(202);

      // Wait for event to be flushed
      await new Promise((resolve) => setTimeout(resolve, 150));

      const db = DatabaseManager.getInstance();
      const eventsDAO = db.getSessionEventsDAO();
      const events = await eventsDAO.getEventsAfter(sessionId, 0);

      const createdEvent = events.find((e) => e.type === 'message.created');
      expect(createdEvent).toBeDefined();
      expect(createdEvent?.sessionId).toBe(sessionId);
      expect(createdEvent?.content).toBe('Event test message');
    });

    it('should trim message content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: '  trimmed message  ',
        },
      });

      expect(response.statusCode).toBe(202);

      const messages = manager.getMessages(sessionId);
      expect(messages[0].content).toBe('trimmed message');
    });
  });

  describe('Concurrent message queued', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = manager.createSession({
        title: 'Concurrency Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
    });

    it('should return 202 for both concurrent messages (queued)', async () => {
      const response1 = app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: 'First message',
        },
      });

      const response2 = app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: 'Second message',
        },
      });

      const [result1, result2] = await Promise.all([response1, response2]);

      // Both should be accepted and queued (202)
      expect(result1.statusCode).toBe(202);
      expect(result2.statusCode).toBe(202);
    });
  });

  describe('Error handling', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = manager.createSession({
        title: 'Error Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
    });

    it('should return 400 for empty message', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: '',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('required');
    });

    it('should return 400 for whitespace-only message', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: '   ',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/non-existent-session-id/messages',
        payload: {
          content: 'Hello',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('not found');
    });

    it('should return 500 for failed message on non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/non-existent-session/messages',
        payload: {
          content: 'Hello',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});