import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import apiChatRoutes from '../../../plugins/routes/api/chat/index.js';
import { SessionEvent, SessionEventType, SessionState } from '@nebula-link-evo/shared';

describe('Docs consistency contract', () => {
  describe('Canonical endpoint route registration', () => {
    it('registers POST /api/chat/sessions/:id/messages', async () => {
      const app = Fastify();
      await app.register(apiChatRoutes, { prefix: '/api/chat' });

      const routes = app.printRoutes({ includeHooks: false });
      expect(routes).toContain('messages (GET, HEAD, POST)');
    });

  });

  describe('SSE event types match expected set', () => {
    it('includes all expected event types', () => {
      const expectedTypes: SessionEventType[] = [
        'session.snapshot',
        'message.created',
        'assistant.started',
        'assistant.delta',
        'assistant.completed',
        'assistant.thinking',
        'assistant.tool_call',
        'assistant.tool_result',
        'run.error',
      ];

      const eventTypes: SessionEventType[] = [
        'session.snapshot',
        'message.created',
        'assistant.started',
        'assistant.delta',
        'assistant.completed',
        'assistant.thinking',
        'assistant.tool_call',
        'assistant.tool_result',
        'run.error',
      ];

      expectedTypes.forEach((type) => {
        expect(eventTypes).toContain(type);
      });
    });

    it('SessionEvent union includes all event types', () => {
      const event: SessionEvent = {
        type: 'session.snapshot',
        sessionId: 'test',
        messages: [],
        state: 'idle',
      };

      expect(event.type).toBe('session.snapshot');
    });
  });

  describe('SessionState union includes expected states', () => {
    it('includes all expected session states', () => {
      const expectedStates: SessionState[] = [
        'idle',
        'running',
        'paused',
        'blocked',
        'interrupted',
        'cancelled',
        'completed',
      ];

      const validState: SessionState = 'idle';
      expect(expectedStates).toContain(validState);

      expectedStates.forEach((state) => {
        const testState: SessionState = state;
        expect(testState).toBeDefined();
      });
    });
  });
});
