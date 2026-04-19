import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { ConversationManager } from '../conversation/manager.js';
import { ChatHandler } from '../conversation/chat-handler.js';
import { DebugWebSocketManager } from '../websocket-manager.js';
import type { DecisionClient } from '../clients/types.js';
import type { ResolvedConfig } from '../config/schema.js';
import apiChatRoutes from '../plugins/routes/api/chat/index.js';
import errorHandler from '../plugins/03-error-handler.plugin.js';
import swaggerPlugin from '../plugins/02-swagger.plugin.js';

const { mockConfig, mockGetConfig } = vi.hoisted(() => {
  const config: ResolvedConfig = {
    _resolved: {
      providers: {
        kimi: {
          apiKey: 'test-key',
          baseUrl: 'https://api.moonshot.cn/v1',
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
    },
    version: '1.0',
    providers: {
      kimi: {
        name: 'kimi',
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://api.moonshot.cn/v1',
        mcp: [],
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
  } as unknown as ResolvedConfig;

  const getConfig = vi.fn().mockReturnValue(config);
  return { mockConfig: config, mockGetConfig: getConfig };
});

vi.mock('../services/index.js', () => ({
  TaskService: {
    getInstance: vi.fn().mockReturnValue({
      getConfig: mockGetConfig,
      getRegistry: vi.fn().mockReturnValue(null),
    }),
  },
}));

describe('Chat Routes', () => {
  let app: ReturnType<typeof Fastify>;
  let manager: ConversationManager;
  let mockDecisionClient: DecisionClient;
  let wsManager: DebugWebSocketManager;
  let chatHandler: ChatHandler;

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

    app.register(swaggerPlugin);
    app.register(errorHandler);
    app.decorate('conversationManager', manager);
    app.decorate('chatHandler', chatHandler);

    app.register(apiChatRoutes, { prefix: '/api/chat' });
  });

  afterEach(async () => {
    await manager.close();
    await app.close();
  });

  describe('GET /api/chat/sessions', () => {
    beforeEach(async () => {
      manager.createSession({
        title: 'Session 1',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      // Add a small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 1));
      manager.createSession({
        title: 'Session 2',
        provider: 'nvidia',
        model: 'nv-vlm-1.0-vision',
      });
    });

    it('should list all sessions', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveLength(2);
      expect(body[0].title).toBe('Session 2');
      expect(body[1].title).toBe('Session 1');
    });

    it('should support limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveLength(1);
    });

    it('should support offset parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions?offset=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Session 1');
    });

    it('should support combined limit and offset', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions?offset=1&limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Session 1');
    });

    it('should return empty array when no sessions exist', async () => {
      // Delete all existing sessions
      const sessions = manager.listSessions();
      for (const session of sessions) {
        manager.deleteSession(session.id);
      }

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveLength(0);
    });

    it('should expose runtime recovery state on listed sessions', async () => {
      const session = manager.listSessions()[0];
      await manager.createSessionState({
        sessionId: session.id,
        status: 'blocked',
        jobId: 'job-list-123',
        agentState: {
          schema_version: 1,
          blockReason: 'api_error',
          waitingFor: 'api_retry',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      const runtimeSession = body.find((entry: { id: string }) => entry.id === session.id);
      expect(runtimeSession.status).toBe('blocked');
      expect(runtimeSession.jobId).toBe('job-list-123');
      expect(runtimeSession.agentState).toMatchObject({
        blockReason: 'api_error',
        waitingFor: 'api_retry',
      });
    });
  });

  describe('GET /api/chat/sessions/:id', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = manager.createSession({
        title: 'Get Session Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
      manager.addMessage(sessionId, {
        role: 'user',
        content: 'Hello',
      });
      manager.addMessage(sessionId, {
        role: 'assistant',
        content: 'Hi there!',
      });
    });

    it('should get session details', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.id).toBe(sessionId);
      expect(body.title).toBe('Get Session Test');
      expect(body.provider).toBe('kimi');
      expect(body.model).toBe('moonshot-v1-vision-preview');
      expect(body.message_count).toBe(2);
      expect(body.created_at).toBeDefined();
      expect(body.updated_at).toBeDefined();
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('not found');
    });

    it('should expose runtime recovery state on session details', async () => {
      await manager.createSessionState({
        sessionId,
        status: 'blocked',
        jobId: 'job-detail-123',
        agentState: {
          schema_version: 1,
          blockReason: 'api_error',
          waitingFor: 'api_retry',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('blocked');
      expect(body.jobId).toBe('job-detail-123');
      expect(body.agentState).toMatchObject({
        blockReason: 'api_error',
        waitingFor: 'api_retry',
      });
    });
  });

  describe('GET /api/chat/sessions/:id/messages', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = manager.createSession({
        title: 'Messages Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
      manager.addMessage(sessionId, { role: 'system', content: 'System prompt' });
      manager.addMessage(sessionId, { role: 'user', content: 'Hello' });
      manager.addMessage(sessionId, {
        role: 'assistant',
        content: 'Hi there!',
      });
      manager.addMessage(sessionId, {
        role: 'user',
        content: 'How are you?',
      });
    });

    it('should get all messages for session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${sessionId}/messages`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveLength(4);
      expect(body[0].role).toBe('system');
      expect(body[0].content).toBe('System prompt');
      expect(body[1].role).toBe('user');
      expect(body[1].content).toBe('Hello');
    });

    it('should support limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${sessionId}/messages?limit=2`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveLength(2);
    });

    it('should support offset parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${sessionId}/messages?offset=2`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveLength(2);
      expect(body[0].role).toBe('assistant');
    });

    it('should support combined limit and offset', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${sessionId}/messages?offset=1&limit=2`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveLength(2);
      expect(body[0].role).toBe('user');
      expect(body[0].content).toBe('Hello');
      expect(body[1].role).toBe('assistant');
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/non-existent-id/messages',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('not found');
    });

    it('should return empty array for session with no messages', async () => {
      const newSession = manager.createSession({
        title: 'Empty Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${newSession.id}/messages`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveLength(0);
    });
  });

  describe('DELETE /api/chat/sessions/:id', () => {
    it('should delete existing session and return success', async () => {
      const session = manager.createSession({
        title: 'Delete Test Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      manager.addMessage(session.id, { role: 'user', content: 'Test message' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Test response' });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/chat/sessions/${session.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);

      // Verify session is actually deleted
      expect(manager.getSession(session.id)).toBeNull();
      expect(manager.getMessages(session.id)).toHaveLength(0);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/chat/sessions/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('not found');
    });
  });

  describe('POST /api/chat/sessions', () => {
    it('should create session with valid provider and model', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          title: 'Test',
          provider: 'kimi',
          model: 'moonshot-v1-vision-preview',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.session).toBeDefined();
      expect(body.session.id).toBeDefined();
      expect(body.session.title).toBe('Test');
      expect(body.session.provider).toBe('kimi');
      expect(body.session.model).toBe('moonshot-v1-vision-preview');
    });

    it('should reject create session with missing provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          title: 'Test',
          model: 'moonshot-v1-vision-preview',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('is required');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();
    });

    it('should reject create session with missing model', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          title: 'Test',
          provider: 'kimi',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('is required');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();
    });

    it('should reject create session with empty provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          title: 'Test',
          provider: '',
          model: 'moonshot-v1-vision-preview',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('must not be empty');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();
    });

    it('should reject create session with empty model', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          title: 'Test',
          provider: 'kimi',
          model: '',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('must not be empty');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();
    });

    it('should not persist session on validation failure', async () => {
      const sessionsBefore = manager.listSessions();

      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          title: 'Test',
          model: 'moonshot-v1-vision-preview',
        },
      });

      expect(response.statusCode).toBe(400);

      const sessionsAfter = manager.listSessions();
      expect(sessionsAfter).toHaveLength(sessionsBefore.length);
    });

    it('should reject unknown provider with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          provider: 'unknown-provider',
          model: 'some-model',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('Provider unknown-provider not found');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();
    });

    it('should reject non-existent model for valid provider', async () => {
      // validateProviderModel checks model exists in provider's model list
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          provider: 'kimi',
          model: 'nonexistent-model',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('not found in provider');
    });

    it('should reject disabled provider with 400', async () => {
      const disabledConfig = {
        ...mockConfig,
        providers: {
          ...mockConfig.providers,
          kimi: { ...mockConfig.providers.kimi, enabled: false },
        },
      } as unknown as ResolvedConfig;
      mockGetConfig.mockReturnValueOnce(disabledConfig);

      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          provider: 'kimi',
          model: 'moonshot-v1-vision-preview',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('Provider kimi is disabled');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();
    });

    it('should return 500 when config is unavailable', async () => {
      mockGetConfig.mockReturnValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          provider: 'kimi',
          model: 'moonshot-v1-vision-preview',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe('Server configuration unavailable');
    });

    it('should not persist session on provider/model validation failure', async () => {
      const sessionsBefore = manager.listSessions();

      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          provider: 'ghost-provider',
          model: 'ghost-model',
        },
      });

      expect(response.statusCode).toBe(400);

      const sessionsAfter = manager.listSessions();
      expect(sessionsAfter).toHaveLength(sessionsBefore.length);
    });

    it('should reject create session with wrong field spelling', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          provider: 'kimi',
          modle: 'moonshot-v1-vision-preview',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('is required');
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();
    });

    it('should reject create session with null provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          provider: null,
          model: 'moonshot-v1-vision-preview',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBeDefined();
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();
    });

    it('should reject create session with null model', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          provider: 'kimi',
          model: null,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBeDefined();
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();
    });

    it('should reject create session with numeric provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          provider: 123,
          model: 'moonshot-v1-vision-preview',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBeDefined();
      expect(body.success).toBeUndefined();
      expect(body.code).toBeUndefined();
    });

    it('should ignore extra unknown fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        payload: {
          title: 'Test',
          provider: 'kimi',
          model: 'moonshot-v1-vision-preview',
          foo: 'bar',
          baz: 123,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.session).toBeDefined();
      expect(body.session.id).toBeDefined();
      expect(body.session.title).toBe('Test');
      expect(body.session.provider).toBe('kimi');
      expect(body.session.model).toBe('moonshot-v1-vision-preview');
    });
  });
});
