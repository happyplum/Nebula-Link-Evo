import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { ConversationManager } from '../conversation/manager.js';
import { ChatHandler } from '../conversation/chat-handler.js';
import { DebugWebSocketManager } from '../websocket-manager.js';
import { SessionLock } from '../services/session-lock.js';
import { DatabaseManager } from '../conversation/db.js';
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
  let wsManager: DebugWebSocketManager;
  let chatHandler: ChatHandler;
  let sessionLock: SessionLock;

  beforeEach(() => {
    app = Fastify();
    manager = new ConversationManager(':memory:');
    manager.initialize();

    wsManager = DebugWebSocketManager.getInstance();

    mockDecisionClient = {
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
      decide: vi.fn(),
      decideStream: vi.fn(),
    } as unknown as DecisionClient;

    chatHandler = new ChatHandler(manager, mockConfig, wsManager);
    (chatHandler as any).resolveDecisionModel = () => mockDecisionClient;

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

  describe('Concurrent message rejected', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = manager.createSession({
        title: 'Concurrency Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
    });

    it('should return 409 Conflict for concurrent message', async () => {
      // First request - should succeed
      const response1 = app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: 'First message',
        },
      });

      // Immediately send second request without waiting
      const response2 = app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: 'Second message',
        },
      });

      const [result1, result2] = await Promise.all([response1, response2]);

      // One should succeed, one should fail with 409
      const statusCodes = [result1.statusCode, result2.statusCode].sort();
      expect(statusCodes).toContain(202);
      expect(statusCodes).toContain(409);
    });

    it('should return 409 with error message when locked', async () => {
      // Manually acquire lock
      sessionLock.acquire(sessionId, 'test-run-id');

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: 'Test message',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('currently being processed');
    });

    it('should allow new message after lock released', async () => {
      // Acquire and release lock
      sessionLock.acquire(sessionId, 'test-run-id');
      sessionLock.release(sessionId, 'test-run-id');

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/messages`,
        payload: {
          content: 'New message after release',
        },
      });

      expect(response.statusCode).toBe(202);
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

    it('should release lock on error', async () => {
      // Try to send message to non-existent session
      await app.inject({
        method: 'POST',
        url: '/sessions/non-existent-session/messages',
        payload: {
          content: 'Hello',
        },
      });

      // Lock should not be held
      expect(sessionLock.isLocked('non-existent-session')).toBe(false);
    });
  });
});