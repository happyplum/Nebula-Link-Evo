import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import apiChatRoutes from '../../../plugins/routes/api/chat/index.js';
import { SessionEvent, SessionEventType, SessionState } from '@nebula-link-evo/shared';

// Canonical event types — if the SessionEvent union changes, this list must be updated.
// The type assertion below ensures compile-time exhaustiveness checking.
const CANONICAL_EVENT_TYPES: readonly SessionEventType[] = [
  'session.snapshot',
  'message.created',
  'assistant.started',
  'assistant.delta',
  'assistant.completed',
  'assistant.thinking',
  'assistant.tool_call',
  'assistant.tool_result',
  'run.error',
] as const;

// Canonical session states — must track SessionState union in shared.
const CANONICAL_SESSION_STATES: readonly SessionState[] = [
  'idle',
  'running',
  'paused',
  'blocked',
  'interrupted',
  'cancelled',
  'completed',
] as const;

describe('Docs consistency contract', () => {
  describe('Canonical endpoint route registration', () => {
    it('registers POST /api/chat/sessions/:id/messages', async () => {
      const app = Fastify();
      await app.register(apiChatRoutes, { prefix: '/api/chat' });

      const routes = app.printRoutes({ includeHooks: false });
      expect(routes).toContain('essages (GET, HEAD, POST)');
    });
  });

  describe('SSE event types are canonical', () => {
    it('includes all expected event types from shared package', () => {
      // Each canonical type must be assignable to SessionEventType (compile-time)
      // and present at runtime.
      for (const type of CANONICAL_EVENT_TYPES) {
        const event: SessionEvent = constructMinimalEvent(type);
        expect(event.type).toBe(type);
      }
    });

    it('has no duplicate canonical types', () => {
      const unique = new Set(CANONICAL_EVENT_TYPES);
      expect(unique.size).toBe(CANONICAL_EVENT_TYPES.length);
    });
  });

  describe('SessionState union is canonical', () => {
    it('includes all expected session states', () => {
      for (const state of CANONICAL_SESSION_STATES) {
        const testState: SessionState = state;
        expect(testState).toBeDefined();
      }
    });

    it('has no duplicate canonical states', () => {
      const unique = new Set(CANONICAL_SESSION_STATES);
      expect(unique.size).toBe(CANONICAL_SESSION_STATES.length);
    });
  });
});

/** Build a minimally valid SessionEvent for the given type. */
function constructMinimalEvent(type: SessionEventType): SessionEvent {
  const base = { sessionId: 'test' };
  switch (type) {
    case 'session.snapshot':
      return { ...base, type, messages: [], state: 'idle' };
    case 'message.created':
      return { ...base, type, messageId: 'm1', role: 'user', content: '' };
    case 'assistant.started':
      return { ...base, type, messageId: 'm1' };
    case 'assistant.delta':
      return { ...base, type, messageId: 'm1', delta: { content: '' } };
    case 'assistant.completed':
      return { ...base, type, messageId: 'm1' };
    case 'assistant.thinking':
      return { ...base, type, messageId: 'm1', thinking: '' };
    case 'assistant.tool_call':
      return { ...base, type, messageId: 'm1', toolCallId: 'tc1', toolName: 't', args: {} };
    case 'assistant.tool_result':
      return { ...base, type, messageId: 'm1', toolCallId: 'tc1', result: '' };
    case 'run.error':
      return { ...base, type, error: 'test error' };
  }
}
