import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import http from 'node:http';
import apiChatRoutes from '../plugins/routes/api/chat/index.js';
import { ConversationManager } from '../conversation/manager.js';
import { DatabaseManager } from '../conversation/db.js';
import { SessionEventHub } from '../services/session-event-hub.js';

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
  } = {}
): Promise<ParsedSSEEvent[]> {
  const { timeoutMs = 1500, maxEvents = 1 } = options;

  return new Promise((resolve, reject) => {
    const events: ParsedSSEEvent[] = [];
    let buffer = '';
    let currentEvent: ParsedSSEEvent | null = null;
    let settled = false;

    const req = http.request(url, { method: 'GET' }, (res) => {
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
              if (events.length >= maxEvents && !settled) {
                settled = true;
                clearTimeout(timer);
                req.destroy();
                resolve(events);
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
            if (events.length >= maxEvents && !settled) {
              settled = true;
              clearTimeout(timer);
              req.destroy();
              resolve(events);
              return;
            }
          }
        }
      });

      res.on('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });

      res.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (currentEvent) {
            events.push(currentEvent);
          }
          resolve(events);
        }
      });
    });

    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        resolve(events);
      }
    }, timeoutMs);

    req.end();
  });
}

describe('SSE snapshot thinking reconstruction', () => {
  let app: ReturnType<typeof Fastify>;
  let server: http.Server;
  let db: DatabaseManager;
  let conversationManager: ConversationManager;
  let baseUrl: string;

  beforeEach(async () => {
    SessionEventHub.resetInstance();
    db = DatabaseManager.getInstance();
    db.initialize(':memory:');
    conversationManager = new ConversationManager(':memory:');

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

  it('includes reconstructed thinking for assistant messages in session.snapshot', async () => {
    const session = conversationManager.createSession({
      title: 'Thinking Snapshot',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const userMessage = conversationManager.addMessage(session.id, {
      role: 'user',
      content: 'Hello',
    });
    const assistantMessage = conversationManager.addMessage(session.id, {
      role: 'assistant',
      content: 'Hi there',
    });

    const dao = db.getSessionEventsDAO();
    // Simulate production: assistant.started uses temp ID, thinking events use same temp ID
    const tempMessageId = 'msg_1234567890_testid';
    dao.appendEventSync(session.id, 'assistant.started', {
      sessionId: session.id,
      messageId: tempMessageId,
    });
    dao.appendEventSync(session.id, 'assistant.thinking', {
      sessionId: session.id,
      messageId: tempMessageId,
      text: 'first chunk ',
    });
    dao.appendEventSync(session.id, 'assistant.thinking', {
      sessionId: session.id,
      messageId: tempMessageId,
      text: 'second chunk',
    });

    const events = await collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
      maxEvents: 1,
    });

    const snapshotEvent = events.find((event) => event.event === 'session.snapshot');
    expect(snapshotEvent).toBeDefined();

    const payload = JSON.parse(snapshotEvent!.data) as {
      messages: Array<{ id: string; role: string; content: string; thinking?: string }>;
    };
    const userSnapshotMessage = payload.messages.find((message) => message.id === userMessage.id);
    const assistantSnapshotMessage = payload.messages.find((message) => message.id === assistantMessage.id);

    expect(assistantSnapshotMessage?.thinking).toBe('first chunk second chunk');
    expect(userSnapshotMessage).toBeDefined();
    expect(userSnapshotMessage && 'thinking' in userSnapshotMessage).toBe(false);
  });

  it('maps thinking to correct message when multiple assistant messages exist', async () => {
    const session = conversationManager.createSession({
      title: 'Multi Thinking',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    conversationManager.addMessage(session.id, { role: 'user', content: 'Q1' });
    const msg1 = conversationManager.addMessage(session.id, { role: 'assistant', content: 'A1' });
    conversationManager.addMessage(session.id, { role: 'user', content: 'Q2' });
    const msg2 = conversationManager.addMessage(session.id, { role: 'assistant', content: 'A2' });

    const dao = db.getSessionEventsDAO();
    // First assistant.started → first thinking
    dao.appendEventSync(session.id, 'assistant.started', { messageId: 'msg_1' });
    dao.appendEventSync(session.id, 'assistant.thinking', { messageId: 'msg_1', text: 'think1 ' });
    dao.appendEventSync(session.id, 'assistant.thinking', { messageId: 'msg_1', text: 'more1' });
    // Second assistant.started → second thinking
    dao.appendEventSync(session.id, 'assistant.started', { messageId: 'msg_2' });
    dao.appendEventSync(session.id, 'assistant.thinking', { messageId: 'msg_2', text: 'think2' });

    const events = await collectSSEEvents(`${baseUrl}/api/chat/sessions/${session.id}/stream`, {
      maxEvents: 1,
    });

    const payload = JSON.parse(events[0].data) as {
      messages: Array<{ id: string; role: string; thinking?: string }>;
    };

    const snapMsg1 = payload.messages.find((m) => m.id === msg1.id);
    const snapMsg2 = payload.messages.find((m) => m.id === msg2.id);

    expect(snapMsg1?.thinking).toBe('think1 more1');
    expect(snapMsg2?.thinking).toBe('think2');
  });
});
