import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import http from 'node:http';
import { DatabaseManager } from '../conversation/db.js';
import { ConversationManager } from '../conversation/manager.js';
import { SessionEventHub } from '../services/session-event-hub.js';
import apiChatRoutes from '../plugins/routes/api/chat/index.js';
import type { SessionEvent } from '../../../shared/types/sse-events.js';

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
): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  events: ParsedSSEEvent[];
  rawBody: string;
}> {
  const { timeoutMs = 1500, maxEvents = 1, headers: requestHeaders } = options;

  return new Promise((resolve, reject) => {
    const events: ParsedSSEEvent[] = [];
    const responseHeaders: Record<string, string> = {};
    const rawChunks: string[] = [];
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
        rawBody: rawChunks.join(''),
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
        const text = chunk.toString();
        rawChunks.push(text);
        buffer += text;

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

      res.on('end', () => {
        responseClosed = true;
        if (currentEvent) {
          events.push(currentEvent);
          currentEvent = null;
        }
        finalize(req);
      });

      res.on('close', () => {
        responseClosed = true;
        if (currentEvent) {
          events.push(currentEvent);
          currentEvent = null;
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

    const timer = setTimeout(() => {
      finalize(req);
    }, timeoutMs);

    req.end();
  });
}

describe('SSE Stream Endpoint', () => {
  let app: ReturnType<typeof Fastify>;
  let server: http.Server;
  let db: DatabaseManager;
  let conversationManager: ConversationManager;
  let eventHub: SessionEventHub;
  let baseUrl: string;

  beforeEach(async () => {
    SessionEventHub.resetInstance();
    db = DatabaseManager.getInstance();
    db.initialize(':memory:');
    conversationManager = new ConversationManager(':memory:');
    eventHub = SessionEventHub.getInstance();

    app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    app.decorate('conversationManager', conversationManager);
    await app.register(apiChatRoutes, { prefix: '/api/chat' });
    await app.ready();

    await new Promise<void>((resolve) => {
      server = app.server;
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await app.close();
    await conversationManager.close();
    await db.close();
    SessionEventHub.resetInstance();
  });

  describe('GET /api/chat/sessions/:id/stream', () => {
    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/non-existent-session/stream',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        success: false,
        error: 'Session not found',
      });
    });

    it('should send session.snapshot event for new connection', async () => {
      const session = conversationManager.createSession({
        title: 'Test Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      conversationManager.addMessage(session.id, { role: 'user', content: 'Hello' });
      conversationManager.addMessage(session.id, { role: 'assistant', content: 'Hi!' });

      const response = await collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
        maxEvents: 1,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['x-accel-buffering']).toBe('no');

      const snapshotEvent = response.events.find((event) => event.event === 'session.snapshot');
      expect(snapshotEvent).toBeDefined();
      expect(snapshotEvent?.id).toBe('0');
      expect(snapshotEvent?.data).toContain(`"sessionId":"${session.id}"`);
      expect(snapshotEvent?.data).toContain('"messages":[');

      const snapshotPayload = JSON.parse(snapshotEvent!.data);
      expect(snapshotPayload.seq).toBe(0);
    });

    it('should include messages in snapshot', async () => {
      const session = conversationManager.createSession({
        title: 'Messages Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      conversationManager.addMessage(session.id, { role: 'user', content: 'User message' });
      conversationManager.addMessage(session.id, { role: 'assistant', content: 'Assistant reply' });

      const response = await collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
        maxEvents: 1,
      });

      const snapshotEvent = response.events.find((event) => event.event === 'session.snapshot');
      expect(snapshotEvent).toBeDefined();

      const payload = JSON.parse(snapshotEvent!.data);
      expect(payload.messages).toHaveLength(2);
      expect(payload.messages[0].role).toBe('user');
      expect(payload.messages[0].content).toBe('User message');
      expect(payload.messages[1].role).toBe('assistant');
      expect(payload.messages[1].content).toBe('Assistant reply');
    });

    it('should bootstrap running sessions with snapshot state only', async () => {
      const session = conversationManager.createSession({
        title: 'Fresh Replay Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      conversationManager.addMessage(session.id, { role: 'user', content: 'Open the page' });
      conversationManager.addMessage(session.id, { role: 'assistant', content: 'Working on it' });
      await conversationManager.createSessionState({
        sessionId: session.id,
        status: 'running',
      });

      const response = await collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
        maxEvents: 1,
        timeoutMs: 2000,
      });

      expect(response.statusCode).toBe(200);
      expect(response.events[0]?.event).toBe('session.snapshot');

      const snapshotPayload = JSON.parse(response.events[0]!.data);
      expect(snapshotPayload.state).toBe('running');
      expect(snapshotPayload.messages).toHaveLength(2);
    });

    it('should not lose live events published during fresh-stream bootstrap', async () => {
      const session = conversationManager.createSession({
        title: 'Fresh Bootstrap Race Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      conversationManager.addMessage(session.id, { role: 'user', content: 'Keep streaming' });
      await conversationManager.createSessionState({
        sessionId: session.id,
        status: 'running',
      });

      const liveBootstrapEvent: SessionEvent = {
        type: 'assistant.delta',
        seq: 1,
        sessionId: session.id,
        messageId: 'msg-assistant-1',
        text: 'still streaming',
      };

      const originalGetMessages = conversationManager.getMessages.bind(conversationManager);
      vi.spyOn(conversationManager, 'getMessages').mockImplementation((targetSessionId: string) => {
        const messages = originalGetMessages(targetSessionId);
        eventHub.publish(session.id, liveBootstrapEvent);
        return messages;
      });

      const response = await collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
        maxEvents: 2,
        timeoutMs: 2000,
      });

      expect(response.statusCode).toBe(200);
      expect(response.events.map((event) => event.event)).toEqual([
        'session.snapshot',
        'assistant.delta',
      ]);

      const liveEvent = response.events[1];
      expect(JSON.parse(liveEvent!.data).text).toBe('still streaming');
    });
  });

  describe('SessionEventHub Integration', () => {
    it('should allow subscribing to session events', () => {
      const callback = () => {};
      const unsubscribe = eventHub.subscribe('test-session', callback);

      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('should publish events to subscribers', () => {
      let receivedEvent: SessionEvent | null = null;
      const sessionId = 'test-session';

      eventHub.subscribe(sessionId, (event) => {
        receivedEvent = event;
      });

      const testEvent: SessionEvent = {
        type: 'assistant.delta',
        sessionId,
        messageId: 'msg-1',
        text: 'Hello world',
      };

      eventHub.publish(sessionId, testEvent);

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent).toEqual(testEvent);
    });

    it('should not receive events after unsubscribe', () => {
      let callCount = 0;
      const sessionId = 'test-session';

      const unsubscribe = eventHub.subscribe(sessionId, () => {
        callCount++;
      });

      unsubscribe();

      const testEvent: SessionEvent = {
        type: 'assistant.delta',
        sessionId,
        messageId: 'msg-1',
        text: 'Test',
      };

      eventHub.publish(sessionId, testEvent);

      expect(callCount).toBe(0);
    });
  });

  describe('SessionEventsDAO', () => {
    it('should append events and flush them', async () => {
      const session = conversationManager.createSession({
        title: 'DAO Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const sessionEventsDAO = db.getSessionEventsDAO();

      await sessionEventsDAO.appendEvent(session.id, 'message.created', {
        messageId: 'msg-1',
        content: 'Hello',
      });
      await sessionEventsDAO.flush();

      const events = await sessionEventsDAO.getEventsAfter(session.id, 0, 10);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('message.created');
    });

    it('should get events after a sequence number', async () => {
      const session = conversationManager.createSession({
        title: 'Replay DAO Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const sessionEventsDAO = db.getSessionEventsDAO();

      await sessionEventsDAO.appendEvent(session.id, 'message.created', { messageId: 'msg-1' });
      await sessionEventsDAO.appendEvent(session.id, 'assistant.delta', {
        messageId: 'msg-2',
        text: 'Reply',
      });
      await sessionEventsDAO.flush();

      const allEvents = await sessionEventsDAO.getEventsAfter(session.id, 0, 10);
      expect(allEvents.length).toBe(2);

      const eventsAfter1 = await sessionEventsDAO.getEventsAfter(session.id, 1, 10);
      expect(eventsAfter1.length).toBe(1);
      expect(eventsAfter1[0].type).toBe('assistant.delta');
    });
  });
});
