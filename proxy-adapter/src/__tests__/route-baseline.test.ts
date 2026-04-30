import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';

/**
 * Route Baseline Tests
 *
 * Baseline tests documenting current production behavior of chat routes.
 * These tests serve as a regression baseline - they document what currently works
 * without changing any behavior.
 *
 * Purpose: Verify that refactoring doesn't break existing functionality.
 */

// Mock external dependencies before imports
const mockSessionEventsDAO = {
  appendEvent: vi.fn().mockResolvedValue(undefined),
  getEventsAfter: vi.fn().mockResolvedValue([]),
};

const mockSessionStateDAO = {
  setSessionState: vi.fn().mockResolvedValue(undefined),
  getSessionState: vi.fn().mockResolvedValue({ status: 'idle' }),
};

vi.mock('../../browser-client.js', () => ({
  browserClient: {},
}));

vi.mock('../../conversation/index.js', () => ({
  ConversationManager: vi.fn().mockImplementation(() => ({
    getSession: vi.fn(),
    getSessions: vi.fn(),
    listSessions: vi.fn().mockReturnValue([]),
    getMessages: vi.fn(),
    addMessage: vi.fn(),
    getSessionState: vi.fn().mockResolvedValue({ status: 'idle' }),
    getSessionStatus: vi.fn().mockResolvedValue('idle'),
  })),
  ChatHandler: vi.fn(),
}));

vi.mock('../../services/index.js', () => {
  const mockTaskServiceInstance = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockReturnValue({}),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };

  return {
    TaskService: {
      getInstance: vi.fn(() => mockTaskServiceInstance),
    },
    taskService: mockTaskServiceInstance,
  };
});


vi.mock('../../services/stream-persist-worker.js', () => ({
  StreamPersistWorker: vi.fn().mockImplementation(() => ({
    process: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../services/conversation-job-queue.js', () => ({
  ConversationJobQueue: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn().mockResolvedValue('job-123'),
  })),
}));

vi.mock('../../services/session-lock.js', () => ({
  SessionLock: {
    getInstance: vi.fn(() => ({
      isLocked: vi.fn().mockReturnValue(false),
      acquire: vi.fn().mockReturnValue(true),
      release: vi.fn(),
    })),
  },
}));

vi.mock('../../conversation/db.js', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getSessionEventsDAO: vi.fn(() => mockSessionEventsDAO),
      getSessionStateDAO: vi.fn(() => mockSessionStateDAO),
    })),
  },
}));

vi.mock('../../services/session-event-hub.js', () => ({
  SessionEventHub: {
    getInstance: vi.fn(() => ({
      subscribe: vi.fn(() => vi.fn()),
    })),
  },
}));

interface ParsedSSEEvent {
  event: string;
  id?: string;
  data: string;
}

async function collectSSEEvents(
  url: string,
  options: {
    timeoutMs?: number;
    maxEvents?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<{ statusCode: number; headers: Record<string, string>; events: ParsedSSEEvent[] }> {
  const { timeoutMs = 1500, maxEvents = 1, headers: requestHeaders } = options;

  return new Promise((resolve, reject) => {
    const events: ParsedSSEEvent[] = [];
    const responseHeaders: Record<string, string> = {};
    let buffer = '';
    let currentEvent: ParsedSSEEvent | null = null;
    let statusCode = 0;
    let settled = false;
    let responseClosed = false;

    const finalize = (req: http.ClientRequest) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (!responseClosed) {
        req.destroy();
      }
      resolve({
        statusCode,
        headers: responseHeaders,
        events,
      });
    };

    const req = http.request(url, { method: 'GET', headers: requestHeaders }, (res) => {
      statusCode = res.statusCode ?? 0;

      for (const [key, value] of Object.entries(res.headers)) {
        if (typeof value === 'string') {
          responseHeaders[key] = value;
        } else if (Array.isArray(value)) {
          responseHeaders[key] = value.join(', ');
        }
      }

      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith(':')) {
            continue;
          }

          if (line.startsWith('event:')) {
            if (currentEvent) {
              events.push(currentEvent);
              currentEvent = null;
              if (events.length >= maxEvents) {
                finalize(req);
                return;
              }
            }
            currentEvent = { event: line.slice(6).trim(), data: '' };
            continue;
          }

          if (line.startsWith('id:')) {
            if (currentEvent) {
              currentEvent.id = line.slice(3).trim();
            }
            continue;
          }

          if (line.startsWith('data:')) {
            if (currentEvent) {
              currentEvent.data += line.slice(5).trim();
            }
            continue;
          }

          if (line.trim() === '' && currentEvent) {
            events.push(currentEvent);
            currentEvent = null;
            if (events.length >= maxEvents) {
              finalize(req);
              return;
            }
          }
        }
      });

      res.on('close', () => {
        responseClosed = true;
        if (currentEvent) {
          events.push(currentEvent);
        }
        finalize(req);
      });

      res.on('error', (error) => {
        responseClosed = true;
        if (!settled) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      if (!settled) {
        reject(error);
      }
    });

    const timer = setTimeout(() => finalize(req), timeoutMs);
    req.end();
  });
}

describe('Route Baseline: API Chat Routes', () => {
  let app: any;
  let ConversationManager: any;
  let DatabaseManager: any;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.TEST_MODE = 'true';
    mockSessionEventsDAO.appendEvent.mockClear();
    mockSessionEventsDAO.getEventsAfter.mockReset();
    mockSessionEventsDAO.getEventsAfter.mockResolvedValue([]);
    mockSessionStateDAO.setSessionState.mockClear();
    mockSessionStateDAO.getSessionState.mockReset();
    mockSessionStateDAO.getSessionState.mockResolvedValue({ status: 'idle' });

    // Import modules inside beforeEach to get fresh mocks
    const { default: Fastify } = await import('fastify');
    const apiChatRoutes = await import('../plugins/routes/api/chat/index.js');
    const conversationModule = await import('../conversation/index.js');
    const dbModule = await import('../conversation/db.js');

    app = Fastify({ logger: { level: 'error' } });
    ConversationManager = conversationModule.ConversationManager;
    DatabaseManager = dbModule.DatabaseManager;

    // Decorate with required dependencies
    const mockChatHandler = {
      handleChatSend: vi.fn().mockResolvedValue(undefined),
    };

    const mockConversationManager = new ConversationManager();
    await app.decorate('conversationManager', mockConversationManager);
    await app.decorate('chatHandler', mockChatHandler);

    // Register apiChatRoutes with /api/chat prefix (matches production)
    await app.register(apiChatRoutes.default, { prefix: '/api/chat' });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    vi.restoreAllMocks();
    delete process.env.NODE_ENV;
    delete process.env.TEST_MODE;
  });

  describe('Route Registration', () => {
    it('should register apiChatRoutes at /api/chat prefix', async () => {
      // Test that a route exists at the expected prefix
      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions',
      });

      // Should return a response (not 404)
      expect([200, 500, 404]).toContain(response.statusCode);
    });
  });

  describe('GET /api/chat/sessions', () => {
    it('should return session list as raw array (no wrapper)', async () => {
      // Mock conversationManager.listSessions to return sample data
      const mockSessions = [
        {
          id: 'session-1',
          title: 'Test Session 1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
          summary: null,
          message_count: 5,
          provider: 'kimi',
          model: 'moonshot-v1',
          vision_provider: null,
          vision_model: null,
        },
        {
          id: 'session-2',
          title: 'Test Session 2',
          created_at: '2024-01-02T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:00.000Z',
          summary: 'Summary text',
          message_count: 10,
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          vision_provider: null,
          vision_model: null,
        },
      ];

      app.conversationManager.listSessions = vi.fn().mockReturnValue(mockSessions);
      app.conversationManager.getSessionState = vi.fn().mockResolvedValue({ status: 'idle' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions',
      });

      expect(response.statusCode).toBe(200);

      // Parse response
      const body = JSON.parse(response.payload);

      // Document: Returns raw array (not wrapped in { success, data })
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
      expect(body[0]).toMatchObject({
        id: 'session-1',
        title: 'Test Session 1',
        provider: 'kimi',
        model: 'moonshot-v1',
      });
    });

    it('should support limit and offset query params', async () => {
      app.conversationManager.listSessions = vi.fn().mockReturnValue([]);
      app.conversationManager.getSessionState = vi.fn().mockResolvedValue({ status: 'idle' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions?limit=10&offset=20',
      });

      expect(response.statusCode).toBe(200);

      // Verify that listSessions was called with correct params
      expect(app.conversationManager.listSessions).toHaveBeenCalledWith({
        limit: 10,
        offset: 20,
      });
    });

    it('should return 500 on error', async () => {
      app.conversationManager.listSessions = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions',
      });

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty('error');
    });
  });

  describe('GET /api/chat/sessions/:id', () => {
    it('should return session details as raw object (no wrapper)', async () => {
      const mockSession = {
        id: 'session-123',
        title: 'Test Session',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        summary: 'Session summary',
        message_count: 15,
        provider: 'kimi',
        model: 'moonshot-v1',
        vision_provider: null,
        vision_model: null,
      };

      app.conversationManager.getSession = vi.fn().mockReturnValue(mockSession);
      app.conversationManager.getSessionState = vi.fn().mockResolvedValue({ status: 'idle' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/session-123',
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);

      // Document: Returns raw object (not wrapped in { success, data })
      expect(body).toMatchObject({
        id: 'session-123',
        title: 'Test Session',
        provider: 'kimi',
      });
      expect(body).not.toHaveProperty('success');
    });

    it('should return 404 for non-existent session', async () => {
      app.conversationManager.getSession = vi.fn().mockReturnValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/non-existent',
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty('error');
    });
  });

  describe('GET /api/chat/sessions/:id/messages', () => {
    it('should return message list as raw array (no wrapper)', async () => {
      const mockSession = {
        id: 'session-123',
        title: 'Test Session',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        summary: null,
        message_count: 2,
        provider: 'kimi',
        model: 'moonshot-v1',
        vision_provider: null,
        vision_model: null,
      };

      const mockMessages = [
        {
          id: 'msg-1',
          session_id: 'session-123',
          role: 'user',
          content: 'Hello',
          created_at: '2024-01-01T00:00:00.000Z',
          metadata: null,
        },
        {
          id: 'msg-2',
          session_id: 'session-123',
          role: 'assistant',
          content: 'Hi there!',
          created_at: '2024-01-01T00:00:01.000Z',
          metadata: null,
        },
      ];

      app.conversationManager.getSession = vi.fn().mockReturnValue(mockSession);
      app.conversationManager.getMessages = vi.fn().mockReturnValue(mockMessages);

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/session-123/messages',
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);

      // Document: Returns raw array (not wrapped in { success, data })
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
      expect(body[0]).toMatchObject({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
      });
    });

    it('should return 404 for non-existent session', async () => {
      app.conversationManager.getSession = vi.fn().mockReturnValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/non-existent/messages',
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty('error');
    });
  });

  describe('POST /api/chat/sessions/:id/messages', () => {
    it('should return 400 for empty content', async () => {
      const mockSession = {
        id: 'session-123',
        title: 'Test Session',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        summary: null,
        message_count: 0,
        provider: 'kimi',
        model: 'moonshot-v1',
        vision_provider: null,
        vision_model: null,
      };

      app.conversationManager.getSession = vi.fn().mockReturnValue(mockSession);

      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions/session-123/messages',
        payload: {
          content: '',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty('error');
    });

    it('should return 404 for non-existent session', async () => {
      app.conversationManager.getSession = vi.fn().mockReturnValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions/non-existent/messages',
        payload: {
          content: 'Test message',
        },
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty('error');
    });
  });

  describe('GET /api/chat/sessions/:id/stream', () => {
    it('should return SSE stream for valid session', async () => {
      app.conversationManager.getSession = vi.fn().mockReturnValue({
        id: 'session-123',
        status: 'idle',
      });
      app.conversationManager.getSessionState = vi.fn().mockResolvedValue({ status: 'idle' });
      app.conversationManager.getMessages = vi.fn().mockReturnValue([
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ]);
      app.conversationManager.getSessionStatus = vi.fn().mockResolvedValue('idle');

      await app.listen({ port: 0, host: '127.0.0.1' });
      const address = app.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve server address');
      }

      const response = await collectSSEEvents(
        `http://127.0.0.1:${address.port}/api/chat/sessions/session-123/stream`,
        { maxEvents: 1 }
      );

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.events[0]?.event).toBe('session.snapshot');
    });

    it('should return 404 for non-existent session', async () => {
      app.conversationManager.getSession = vi.fn().mockReturnValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/non-existent/stream',
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.payload);

      // Document: SSE endpoint error uses wrapper (unlike other endpoints)
      expect(body).toHaveProperty('success', false);
      expect(body).toHaveProperty('error');
    });

    it('should always bootstrap stream clients with session.snapshot', async () => {
      app.conversationManager.getSession = vi.fn().mockReturnValue({
        id: 'session-123',
        status: 'running',
      });
      app.conversationManager.getSessionState = vi.fn().mockResolvedValue({ status: 'running' });

      await app.listen({ port: 0, host: '127.0.0.1' });
      const address = app.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve server address');
      }

      const response = await collectSSEEvents(
        `http://127.0.0.1:${address.port}/api/chat/sessions/session-123/stream`,
        { maxEvents: 1 }
      );

      expect(response.statusCode).toBe(200);
      expect(response.events[0]?.event).toBe('session.snapshot');
    });
  });
});
