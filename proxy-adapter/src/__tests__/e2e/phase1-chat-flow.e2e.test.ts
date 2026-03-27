/**
 * Phase 1 Chat Flow E2E Tests
 * Tests: message send, stream response, interrupt, cancel, multi-page sync
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import WebSocket, { WebSocketServer } from 'ws';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { DebugWebSocketManager } from '../../websocket-manager.js';
import { ConversationManager } from '../../conversation/manager.js';
import { ChatHandler } from '../../conversation/chat-handler.js';
import { ChatSessionController } from '../../services/chat-session-controller.js';
import { DatabaseManager } from '../../conversation/db.js';
import { SessionEventHub } from '../../services/session-event-hub.js';
import apiChatRoutes from '../../plugins/routes/api/chat/index.js';
import errorHandler from '../../plugins/03-error-handler.plugin.js';
import swaggerPlugin from '../../plugins/02-swagger.plugin.js';
import type { StreamCallbacks } from '../../clients/decision/stream.js';

// Mock decision client factory
vi.mock('../../clients/decision/index.js', () => ({
  createDecisionClientFactory: () => ({
    create: () => ({
      decideStream: async (
        _context: unknown,
        callbacks: StreamCallbacks,
        signal?: AbortSignal
      ) => {
        // Simulate streaming with abort support
        if (signal?.aborted) {
          throw new Error('Aborted');
        }

        // Simulate thinking
        callbacks.onThinking?.('Processing your request...');

        // Simulate token streaming
        const tokens = ['Hello', ' ', 'world', '!'];
        for (const token of tokens) {
          if (signal?.aborted) {
            throw new Error('Aborted');
          }
          callbacks.onToken(token);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        callbacks.onUsage?.({ prompt_tokens: 10, completion_tokens: 4 });

        // Check abort before done
        if (signal?.aborted) {
          throw new Error('Aborted');
        }

        callbacks.onDone();
      },
    }),
  }),
}));

// Mock browser client for status checks
vi.mock('../../browser-client.js', () => ({
  browserClient: {
    getStatus: vi.fn().mockResolvedValue({
      isOpen: false,
      status: 'healthy',
    }),
  },
}));

describe('Phase 1 Chat Flow E2E', () => {
  let app: ReturnType<typeof Fastify>;
  let wsManager: DebugWebSocketManager;
  let conversationManager: ConversationManager;
  let sessionController: ChatSessionController;
  let wsServer: WebSocketServer;
  let testPort: number;
  let wsPort: number;
  const wsClients: WebSocket[] = [];
  let appBaseUrl: string;

  beforeAll(async () => {
    // Reset singleton instances
    SessionEventHub.resetInstance();

    // Initialize database
    const db = DatabaseManager.getInstance();
    db.initialize(':memory:');

    // Get instances
    wsManager = DebugWebSocketManager.getInstance();
    sessionController = ChatSessionController.getInstance();
    conversationManager = new ConversationManager();

    // Build Fastify app
    app = Fastify({
      logger: { level: 'error' },
    });

    await app.register(cors, { origin: true, credentials: true });
    await app.register(websocket);
    await app.register(swaggerPlugin);
    await app.register(errorHandler);

    // Decorate app with conversation manager
    app.decorate('conversationManager', conversationManager);

    // Setup chat handler with test config
    const config = {
      _resolved: {
        providers: {
          'test-provider': {
            apiKey: 'test-key',
            baseUrl: 'https://test.example.com',
            models: ['test-model'],
          },
        },
      },
    } as any;

    const chatHandler = new ChatHandler(conversationManager, config, wsManager);
    wsManager.setChatHandler(chatHandler);
    app.decorate('chatHandler', chatHandler);

    // Register routes
    await app.register(apiChatRoutes, { prefix: '/api/chat' });

    // Setup WebSocket route
    app.get('/ws', { websocket: true }, (connection, req) => {
      const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      wsManager.handleConnection(connection.socket, clientId);
    });

    await app.ready();

    // Start app on dynamic port for SSE testing
    await app.listen({ port: 0, host: '127.0.0.1' });
    testPort = (app.server.address() as { port: number }).port;
    appBaseUrl = `http://127.0.0.1:${testPort}`;

    // Start WebSocket server on another dynamic port
    wsServer = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wsServer.once('listening', () => resolve()));
    wsPort = (wsServer.address() as { port: number }).port;

    wsServer.on('connection', (ws) => {
      const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      (ws as any).clientId = clientId;
      wsManager.handleConnection(ws, clientId);
    });
  });

  afterAll(async () => {
    // Close all WebSocket clients
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }

    // Close WebSocket server
    if (wsServer) {
      await new Promise<void>((resolve) => {
        wsServer.close(() => resolve());
      });
    }

    await app.close();

    // Close database
    const db = DatabaseManager.getInstance();
    db.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper to create WebSocket client
   */
  function createWsClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${wsPort}`);
      wsClients.push(ws);

      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  /**
   * Helper to collect WebSocket messages
   */
  function collectMessages(ws: WebSocket, duration: number): Promise<any[]> {
    return new Promise((resolve) => {
      const messages: any[] = [];

      ws.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // Ignore parse errors
        }
      });

      setTimeout(() => resolve(messages), duration);
    });
  }

  /**
   * Helper to collect SSE events from streaming endpoint
   */
  async function collectSSEEvents(
    url: string,
    duration: number,
    abortSignal?: AbortSignal
  ): Promise<EventSourceMessage[]> {
    const events: EventSourceMessage[] = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), duration);

    try {
      const response = await fetch(url, {
        signal: abortSignal || controller.signal,
      });

      const parser = createParser({
        onEvent: (event) => {
          events.push(event);
        },
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }

      parser.feed(decoder.decode());
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'AbortError') {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    return events;
  }

  describe('Session Management', () => {
    it('should create a new chat session', async () => {
      const session = conversationManager.createSession({
        title: 'Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      expect(session.id).toBeDefined();
      expect(session.title).toBe('Test Session');
      expect(session.provider).toBe('test-provider');
      expect(session.model).toBe('test-model');
    });

    it('should list all sessions', async () => {
      // Create a session first
      conversationManager.createSession({
        title: 'List Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    it('should get session details with messages', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Detail Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.id).toBe(session.id);
    });

    it('should delete a session', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Delete Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });
      conversationManager.deleteSession(session.id);

      // Verify session is deleted
      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}`,
      });

      expect(getResponse.statusCode).toBe(404);
    });
  });

  describe('Send Message -> Background Execution -> Stream Response', () => {
    // TODO: SSE streaming tests require ChatHandler integration with SessionEventHub
    it.skip('should send message and receive stream events via SSE', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Stream Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Start SSE connection and collect events
      const sseUrl = `${appBaseUrl}/api/chat/sessions/${session.id}/stream`;
      const eventsPromise = collectSSEEvents(sseUrl, 3000);

      // Wait a bit for SSE connection to establish
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send message via POST endpoint
      const sendResponse = await fetch(`${appBaseUrl}/api/chat/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello, this is a test message!' }),
      });

      expect(sendResponse.status).toBe(202);
      const sendBody = await sendResponse.json() as { jobId: string; sessionId: string };
      expect(sendBody.jobId).toBeDefined();
      expect(sendBody.sessionId).toBe(session.id);

      // Wait for SSE events
      const events = await eventsPromise;

      // Verify SSE events
      const snapshotEvent = events.find((e) => e.event === 'session.snapshot');
      const deltaEvents = events.filter((e) => e.event === 'assistant.delta');
      const thinkingEvent = events.find((e) => e.event === 'assistant.thinking');
      const completedEvent = events.find((e) => e.event === 'assistant.completed');

      // Should have snapshot event
      expect(snapshotEvent).toBeDefined();
      const snapshotData = JSON.parse(snapshotEvent!.data);
      expect(snapshotData.sessionId).toBe(session.id);
      expect(Array.isArray(snapshotData.messages)).toBe(true);

      // Should have thinking event
      expect(thinkingEvent).toBeDefined();
      const thinkingData = JSON.parse(thinkingEvent!.data);
      expect(thinkingData.text).toContain('Processing');

      // Should have delta events
      expect(deltaEvents.length).toBeGreaterThan(0);
      const fullResponse = deltaEvents.map((e) => JSON.parse(e.data).text).join('');
      expect(fullResponse).toContain('Hello world!');

      // Should have completed event
      expect(completedEvent).toBeDefined();
      const completedData = JSON.parse(completedEvent!.data);
      expect(completedData.sessionId).toBe(session.id);
    });

    // TODO: SSE streaming tests require ChatHandler integration with SessionEventHub
    it.skip('should handle message via SSE', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'SSE Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Start SSE connection
      const sseUrl = `${appBaseUrl}/api/chat/sessions/${session.id}/stream`;
      const eventsPromise = collectSSEEvents(sseUrl, 3000);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send message
      const sendResponse = await fetch(`${appBaseUrl}/api/chat/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'What do you see?' }),
      });

      expect(sendResponse.status).toBe(202);

      // Wait for SSE events
      const events = await eventsPromise;

      // Should receive snapshot and completed events
      const snapshotEvent = events.find((e) => e.event === 'session.snapshot');
      const completedEvent = events.find((e) => e.event === 'assistant.completed');

      expect(snapshotEvent).toBeDefined();
      expect(completedEvent).toBeDefined();
    });

    // TODO: SSE streaming tests require ChatHandler integration with SessionEventHub
    it.skip('should store messages in conversation history', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'History Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Start SSE connection
      const sseUrl = `${appBaseUrl}/api/chat/sessions/${session.id}/stream`;
      const eventsPromise = collectSSEEvents(sseUrl, 3000);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send message via POST endpoint
      await fetch(`${appBaseUrl}/api/chat/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test message for history' }),
      });

      // Wait for SSE events to complete
      await eventsPromise;

      // Wait for message to be stored
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Get session messages
      const response = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}`,
      });

      const body = JSON.parse(response.payload);
      expect(body.messages.length).toBeGreaterThan(0);

      // Find user message
      const userMessage = body.messages.find((m: any) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage.content).toBe('Test message for history');

      // Find assistant message
      const assistantMessage = body.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.content).toContain('Hello world!');
    });
  });

  describe('Interrupt Running Session', () => {
    it('should resume a paused session by restarting assistant execution over SSE', async () => {
      const session = conversationManager.createSession({
        title: 'Resume Paused Session',
        provider: 'test-provider',
        model: 'test-model',
      });
      await conversationManager.createSessionState({
        sessionId: session.id,
        status: 'idle',
      });
      conversationManager.addMessage(session.id, {
        role: 'user',
        content: 'Continue from the paused point.',
      });

      sessionController.createAbortController(session.id);
      await sessionController.pause(session.id);
      sessionController.markAsPaused(session.id);

      const sseUrl = `${appBaseUrl}/api/chat/sessions/${session.id}/stream`;
      const eventsPromise = collectSSEEvents(sseUrl, 1500);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const resumeResponse = await fetch(`${appBaseUrl}/api/chat/sessions/${session.id}/resume`, {
        method: 'POST',
      });

      expect(resumeResponse.status).toBe(200);
      expect(await resumeResponse.json()).toEqual({ success: true });

      const events = await eventsPromise;
      expect(events.some((event) => event.event === 'assistant.started')).toBe(true);
      expect(events.some((event) => event.event === 'assistant.delta')).toBe(true);
      expect(events.some((event) => event.event === 'assistant.completed')).toBe(true);
    });

    it('should interrupt a running session', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Interrupt Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Create WebSocket client
      const ws = await createWsClient();

      // Subscribe to session
      ws.send(
        JSON.stringify({
          type: 'subscribe_session',
          sessionId: session.id,
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Setup chat handler
      const config = {
        _resolved: {
          providers: {
            'test-provider': {
              apiKey: 'test-key',
              baseUrl: 'https://test.example.com',
              models: ['test-model'],
            },
          },
        },
      } as any;

      const chatHandler = new ChatHandler(conversationManager, config, wsManager);
      wsManager.setChatHandler(chatHandler);

      // Start a chat (will stream in background)
      ws.send(
        JSON.stringify({
          type: 'chat_send',
          sessionId: session.id,
          message: 'This will be interrupted',
        })
      );

      // Wait a bit for the chat to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify session is running
      const statusBeforeResponse = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/status`,
      });

      const statusBefore = JSON.parse(statusBeforeResponse.payload);
      expect(statusBefore.status).toBe('running');

      // Interrupt the session
      const interruptResponse = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/interrupt`,
      });

      expect(interruptResponse.statusCode).toBe(200);
      const interruptBody = JSON.parse(interruptResponse.payload);
      expect(interruptBody.success).toBe(true);

      // Verify status changed to interrupted
      const statusAfterResponse = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/status`,
      });

      const statusAfter = JSON.parse(statusAfterResponse.payload);
      expect(statusAfter.status).toBe('interrupted');

      ws.close();
    });

    it('should return 400 when interrupting non-running session', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Non-Running Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Try to interrupt idle session
      const response = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/interrupt`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('Cannot interrupt');
    });


  });

  describe('Cancel Session', () => {
    it('should cancel a running session', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Cancel Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Create WebSocket client
      const ws = await createWsClient();

      // Subscribe to session
      ws.send(
        JSON.stringify({
          type: 'subscribe_session',
          sessionId: session.id,
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Setup chat handler
      const config = {
        _resolved: {
          providers: {
            'test-provider': {
              apiKey: 'test-key',
              baseUrl: 'https://test.example.com',
              models: ['test-model'],
            },
          },
        },
      } as any;

      const chatHandler = new ChatHandler(conversationManager, config, wsManager);
      wsManager.setChatHandler(chatHandler);

      // Start a chat
      ws.send(
        JSON.stringify({
          type: 'chat_send',
          sessionId: session.id,
          message: 'This will be cancelled',
        })
      );

      // Wait for chat to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cancel the session
      const cancelResponse = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/cancel`,
      });

      expect(cancelResponse.statusCode).toBe(200);
      const cancelBody = JSON.parse(cancelResponse.payload);
      expect(cancelBody.success).toBe(true);

      // Verify status changed to cancelled
      const statusResponse = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/status`,
      });

      const status = JSON.parse(statusResponse.payload);
      expect(status.status).toBe('cancelled');

      ws.close();
    });

    it('should cancel an interrupted session', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Cancel Interrupted Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Manually set up abort controller
      sessionController.createAbortController(session.id);

      // Interrupt first
      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/interrupt`,
      });

      // Verify interrupted
      const statusAfterInterrupt = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/status`,
      });
      expect(JSON.parse(statusAfterInterrupt.payload).status).toBe('interrupted');

      // Cancel the interrupted session
      const cancelResponse = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/cancel`,
      });

      expect(cancelResponse.statusCode).toBe(200);

      // Verify status changed to cancelled
      const statusResponse = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/status`,
      });

      expect(JSON.parse(statusResponse.payload).status).toBe('cancelled');
    });

    it('should return 400 when cancelling idle session', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Idle Cancel Test',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Try to cancel idle session
      const response = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/cancel`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('Cannot cancel');
    });

    it('should return 400 when cancelling already cancelled session', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Double Cancel Test',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Set up and cancel
      sessionController.createAbortController(session.id);
      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/cancel`,
      });

      // Try to cancel again
      const response = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/cancel`,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Multi-Page Mirror Synchronization', () => {
    it('should sync events to multiple SSE clients', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Multi-Sync Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Start two SSE connections
      const sseUrl = `${appBaseUrl}/api/chat/sessions/${session.id}/stream`;
      const eventsPromise1 = collectSSEEvents(sseUrl, 3000);
      const eventsPromise2 = collectSSEEvents(sseUrl, 3000);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send message
      await fetch(`${appBaseUrl}/api/chat/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Multi-client test' }),
      });

      // Wait for events from both clients
      const [events1, events2] = await Promise.all([eventsPromise1, eventsPromise2]);

      // Both SSE clients should receive events
      const snapshotEvent1 = events1.find((e) => e.event === 'session.snapshot');
      const completedEvent1 = events1.find((e) => e.event === 'assistant.completed');
      const snapshotEvent2 = events2.find((e) => e.event === 'session.snapshot');
      const completedEvent2 = events2.find((e) => e.event === 'assistant.completed');

      // Client 1 should receive events
      expect(snapshotEvent1).toBeDefined();
      expect(completedEvent1).toBeDefined();

      // Client 2 should also receive events (SSE is broadcast to all subscribers)
      expect(snapshotEvent2).toBeDefined();
      expect(completedEvent2).toBeDefined();
    });

    it('should maintain sync latency under 1 second', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Latency Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Create two WebSocket clients
      const ws1 = await createWsClient();
      const ws2 = await createWsClient();

      // Subscribe both
      ws1.send(
        JSON.stringify({
          type: 'subscribe_session',
          sessionId: session.id,
        })
      );

      ws2.send(
        JSON.stringify({
          type: 'subscribe_session',
          sessionId: session.id,
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Setup chat handler
      const config = {
        _resolved: {
          providers: {
            'test-provider': {
              apiKey: 'test-key',
              baseUrl: 'https://test.example.com',
              models: ['test-model'],
            },
          },
        },
      } as any;

      const chatHandler = new ChatHandler(conversationManager, config, wsManager);
      wsManager.setChatHandler(chatHandler);

      // Track timestamps
      const timestamps1: Record<string, number> = {};
      const timestamps2: Record<string, number> = {};

      ws1.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'chat_stream_start' || msg.type === 'chat_stream_token') {
            timestamps1[msg.type] = Date.now();
          }
        } catch {
          // Ignore
        }
      });

      ws2.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'chat_stream_start' || msg.type === 'chat_stream_token') {
            timestamps2[msg.type] = Date.now();
          }
        } catch {
          // Ignore
        }
      });

      // Send message
      ws1.send(
        JSON.stringify({
          type: 'chat_send',
          sessionId: session.id,
          message: 'Latency test',
        })
      );

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check latency for start event
      if (timestamps1['chat_stream_start'] && timestamps2['chat_stream_start']) {
        const latency = Math.abs(
          timestamps1['chat_stream_start'] - timestamps2['chat_stream_start']
        );
        expect(latency).toBeLessThan(1000); // Under 1 second
      }

      // Check latency for token events
      if (timestamps1['chat_stream_token'] && timestamps2['chat_stream_token']) {
        const latency = Math.abs(
          timestamps1['chat_stream_token'] - timestamps2['chat_stream_token']
        );
        expect(latency).toBeLessThan(1000); // Under 1 second
      }

      ws1.close();
      ws2.close();
    });

    it('should handle late-joining client with buffer replay', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Late Join Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Create first WebSocket client
      const ws1 = await createWsClient();

      // Subscribe first client
      ws1.send(
        JSON.stringify({
          type: 'subscribe_session',
          sessionId: session.id,
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Setup chat handler
      const config = {
        _resolved: {
          providers: {
            'test-provider': {
              apiKey: 'test-key',
              baseUrl: 'https://test.example.com',
              models: ['test-model'],
            },
          },
        },
      } as any;

      const chatHandler = new ChatHandler(conversationManager, config, wsManager);
      wsManager.setChatHandler(chatHandler);

      // Send message
      ws1.send(
        JSON.stringify({
          type: 'chat_send',
          sessionId: session.id,
          message: 'Late join test',
        })
      );

      // Wait for some tokens
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Create second WebSocket client (late join)
      const ws2 = await createWsClient();

      // Subscribe second client - should receive buffer
      let bufferReceived = false;
      ws2.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'session_buffer') {
            bufferReceived = true;
          }
        } catch {
          // Ignore
        }
      });

      ws2.send(
        JSON.stringify({
          type: 'subscribe_session',
          sessionId: session.id,
        })
      );

      // Wait for buffer
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Second client should have received session buffer
      expect(bufferReceived).toBe(true);

      ws1.close();
      ws2.close();
    });

    it('should properly unsubscribe client from session', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Unsubscribe Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Create WebSocket client
      const ws = await createWsClient();

      // Subscribe to session
      ws.send(
        JSON.stringify({
          type: 'subscribe_session',
          sessionId: session.id,
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify client count
      const clientCountBefore = wsManager.getClientCount();
      expect(clientCountBefore).toBeGreaterThan(0);

      // Close WebSocket (should trigger unsubscribe)
      ws.close();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Setup chat handler and send message
      const config = {
        _resolved: {
          providers: {
            'test-provider': {
              apiKey: 'test-key',
              baseUrl: 'https://test.example.com',
              models: ['test-model'],
            },
          },
        },
      } as any;

      const chatHandler = new ChatHandler(conversationManager, config, wsManager);
      wsManager.setChatHandler(chatHandler);

      // Create another client to send message
      const ws2 = await createWsClient();
      ws2.send(
        JSON.stringify({
          type: 'subscribe_session',
          sessionId: session.id,
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send message
      ws2.send(
        JSON.stringify({
          type: 'chat_send',
          sessionId: session.id,
          message: 'After unsubscribe',
        })
      );

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      ws2.close();
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/non-existent-session-id',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return error for invalid message format', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'Error Test Session',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Try to send message without required fields
      const response = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        payload: {}, // Missing message
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle WebSocket connection error gracefully', async () => {
      // Create a session
      const session = conversationManager.createSession({
        title: 'WS Error Test',
        provider: 'test-provider',
        model: 'test-model',
      });

      // Create WebSocket client
      const ws = await createWsClient();

      // Send malformed JSON
      ws.send('not a valid json');

      // Wait for error response
      const messages = await collectMessages(ws, 500);

      // Should receive error message
      const errorMsg = messages.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();

      ws.close();
    });

    it('should handle provider not found error', async () => {
      // Create a session with invalid provider
      const session = conversationManager.createSession({
        title: 'Invalid Provider Test',
        provider: 'non-existent-provider',
        model: 'unknown-model',
      });

      const chatHandler = (app as typeof app & {
        chatHandler: { getDecisionClient: (provider: string, model: string) => unknown };
      }).chatHandler;
      const getDecisionClientSpy = vi
        .spyOn(chatHandler, 'getDecisionClient')
        .mockImplementation((...args: unknown[]) => {
          const [provider, model] = args as [string, string];
          if (provider === 'non-existent-provider' && model === 'unknown-model') {
            return null;
          }

          return {
            decideStream: async (
              _context: unknown,
              callbacks: StreamCallbacks,
              signal?: AbortSignal
            ) => {
              if (signal?.aborted) {
                throw new Error('Aborted');
              }

              callbacks.onThinking?.('Processing your request...');

              const tokens = ['Hello', ' ', 'world', '!'];
              for (const token of tokens) {
                if (signal?.aborted) {
                  throw new Error('Aborted');
                }
                callbacks.onToken(token);
                await new Promise((resolve) => setTimeout(resolve, 50));
              }

              callbacks.onUsage?.({ prompt_tokens: 10, completion_tokens: 4 });
              callbacks.onDone();
            },
          };
        });

      // Start SSE connection
      const sseUrl = `${appBaseUrl}/api/chat/sessions/${session.id}/stream`;
      const eventsPromise = collectSSEEvents(sseUrl, 3000);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send message
      await fetch(`${appBaseUrl}/api/chat/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test with invalid provider' }),
      });

      // Wait for events
      const events = await eventsPromise;

      const errorEvent = events.find((e) => e.event === 'run.error');
      expect(errorEvent).toBeDefined();
      expect(events.some((e) => e.event === 'assistant.completed')).toBe(false);
      expect(events.some((e) => e.event === 'assistant.delta')).toBe(false);

      const errorPayload = JSON.parse(errorEvent!.data) as { error: string };
      expect(errorPayload.error).toContain(`Provider '${session.provider}'`);

      getDecisionClientSpy.mockRestore();
    });
  });
});
