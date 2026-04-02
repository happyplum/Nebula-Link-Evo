import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage, ChatSession } from '@/features/chat/types/index.js';

import { useChatStore } from './chat.store.js';

const makeSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: 'sess-1',
  title: 'Test Session',
  ...overrides,
});

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-1',
  role: 'user',
  content: 'Hello',
  ...overrides,
});

describe('chat.store', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  // ── Initial state ───────────────────────────────────────────────────

  describe('initial state', () => {
    it('has correct defaults', () => {
      const s = useChatStore.getState();
      expect(s.sessions).toEqual([]);
      expect(s.activeSessionId).toBeNull();
      expect(s.messagesBySession).toEqual({});
      expect(s.streamingState).toBe('idle');
      expect(s.streamingContent).toBe('');
      expect(s.streamingThinking).toBe('');
      expect(s.isLoadingSessions).toBe(false);
      expect(s.isLoadingMessages).toBe(false);
    });
  });

  // ── Session CRUD ────────────────────────────────────────────────────

  describe('setSessions', () => {
    it('replaces the session list', () => {
      const sessions = [makeSession({ id: 'a' }), makeSession({ id: 'b' })];
      useChatStore.getState().setSessions(sessions);
      expect(useChatStore.getState().sessions).toEqual(sessions);
    });
  });

  describe('addSession', () => {
    it('prepends a session to the list', () => {
      useChatStore.getState().setSessions([makeSession({ id: 'a' })]);
      useChatStore.getState().addSession(makeSession({ id: 'b' }));
      expect(useChatStore.getState().sessions.map((s) => s.id)).toEqual(['b', 'a']);
    });
  });

  describe('removeSession', () => {
    it('removes the session and its messages', () => {
      const store = useChatStore.getState();
      store.setSessions([makeSession({ id: 'a' }), makeSession({ id: 'b' })]);
      store.setMessages('a', [makeMessage({ id: 'm1' })]);
      store.setMessages('b', [makeMessage({ id: 'm2' })]);

      useChatStore.getState().removeSession('a');

      const s = useChatStore.getState();
      expect(s.sessions.map((sess) => sess.id)).toEqual(['b']);
      expect(s.messagesBySession['a']).toBeUndefined();
      expect(s.messagesBySession['b']).toHaveLength(1);
    });

    it('clears activeSessionId when removing the active session', () => {
      const store = useChatStore.getState();
      store.setSessions([makeSession({ id: 'a' })]);
      store.setActiveSession('a');

      useChatStore.getState().removeSession('a');

      expect(useChatStore.getState().activeSessionId).toBeNull();
    });

    it('keeps activeSessionId when removing a different session', () => {
      const store = useChatStore.getState();
      store.setSessions([makeSession({ id: 'a' }), makeSession({ id: 'b' })]);
      store.setActiveSession('a');

      useChatStore.getState().removeSession('b');

      expect(useChatStore.getState().activeSessionId).toBe('a');
    });
  });

  describe('updateSession', () => {
    it('merges partial updates into the matching session', () => {
      useChatStore.getState().setSessions([makeSession({ id: 'a', title: 'Old' })]);
      useChatStore.getState().updateSession('a', { title: 'New', status: 'running' });

      const session = useChatStore.getState().sessions.find((s) => s.id === 'a')!;
      expect(session.title).toBe('New');
      expect(session.status).toBe('running');
    });

    it('does not mutate unmatched sessions', () => {
      useChatStore.getState().setSessions([makeSession({ id: 'a', title: 'A' })]);
      useChatStore.getState().updateSession('z', { title: 'Z' });

      expect(useChatStore.getState().sessions[0].title).toBe('A');
    });
  });

  describe('setActiveSession', () => {
    it('sets the active session id', () => {
      useChatStore.getState().setActiveSession('abc');
      expect(useChatStore.getState().activeSessionId).toBe('abc');
    });

    it('clears with null', () => {
      useChatStore.getState().setActiveSession('abc');
      useChatStore.getState().setActiveSession(null);
      expect(useChatStore.getState().activeSessionId).toBeNull();
    });
  });

  // ── Message operations ──────────────────────────────────────────────

  describe('setMessages', () => {
    it('sets messages for a session', () => {
      const msgs = [makeMessage({ id: 'm1' }), makeMessage({ id: 'm2', role: 'assistant' })];
      useChatStore.getState().setMessages('sess-1', msgs);
      expect(useChatStore.getState().messagesBySession['sess-1']).toEqual(msgs);
    });
  });

  describe('addMessage', () => {
    it('appends a message to an existing session', () => {
      useChatStore.getState().setMessages('s1', [makeMessage({ id: 'm1' })]);
      useChatStore.getState().addMessage('s1', makeMessage({ id: 'm2' }));
      expect(useChatStore.getState().messagesBySession['s1']).toHaveLength(2);
    });

    it('creates the array for a new session', () => {
      useChatStore.getState().addMessage('s1', makeMessage({ id: 'm1' }));
      expect(useChatStore.getState().messagesBySession['s1']).toHaveLength(1);
    });
  });

  describe('updateMessage', () => {
    it('merges partial updates into the matching message', () => {
      useChatStore.getState().setMessages('s1', [makeMessage({ id: 'm1', content: 'hi' })]);
      useChatStore.getState().updateMessage('s1', 'm1', { content: 'hello', thinking: 'hmm' });

      const msg = useChatStore.getState().messagesBySession['s1'][0];
      expect(msg.content).toBe('hello');
      expect(msg.thinking).toBe('hmm');
    });

    it('does not mutate when session does not exist', () => {
      useChatStore.getState().updateMessage('s1', 'm1', { content: 'x' });
      expect(useChatStore.getState().messagesBySession['s1']).toBeUndefined();
    });
  });

  describe('appendToLastAssistantMessage', () => {
    it('appends a token to the last assistant message', () => {
      useChatStore.getState().setMessages('s1', [
        makeMessage({ id: 'm1', role: 'user', content: 'hi' }),
        makeMessage({ id: 'm2', role: 'assistant', content: 'Hello' }),
      ]);
      useChatStore.getState().appendToLastAssistantMessage('s1', ' world');

      expect(useChatStore.getState().messagesBySession['s1'][1].content).toBe('Hello world');
    });

    it('does nothing if last message is not assistant', () => {
      useChatStore.getState().setMessages('s1', [
        makeMessage({ id: 'm1', role: 'user', content: 'hi' }),
      ]);
      useChatStore.getState().appendToLastAssistantMessage('s1', ' token');

      expect(useChatStore.getState().messagesBySession['s1'][0].content).toBe('hi');
    });

    it('does nothing if session has no messages', () => {
      useChatStore.getState().setMessages('s1', []);
      useChatStore.getState().appendToLastAssistantMessage('s1', 'token');
      expect(useChatStore.getState().messagesBySession['s1']).toEqual([]);
    });
  });

  // ── Optimistic message flow ─────────────────────────────────────────

  describe('addOptimisticMessage', () => {
    it('adds a user message with a temp ID and returns it', () => {
      const tempId = useChatStore.getState().addOptimisticMessage('s1', 'Hello there');

      expect(tempId).toMatch(/^temp-/);
      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].content).toBe('Hello there');
      expect(msgs[0].id).toBe(tempId);
    });
  });

  describe('reconcileMessage', () => {
    it('replaces optimistic message with server-confirmed one', () => {
      const tempId = useChatStore.getState().addOptimisticMessage('s1', 'Hi');

      const serverMsg = makeMessage({
        id: 'server-123',
        role: 'user',
        content: 'Hi',
        timestamp: 1000,
      });
      useChatStore.getState().reconcileMessage('s1', tempId, serverMsg);

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe('server-123');
      expect(msgs[0].content).toBe('Hi');
    });

    it('full optimistic flow: add → reconcile', () => {
      const store = useChatStore.getState();
      const tempId = store.addOptimisticMessage('s1', 'ping');
      store.addMessage('s1', makeMessage({ id: 'm2', role: 'assistant', content: 'pong' }));

      expect(useChatStore.getState().messagesBySession['s1']).toHaveLength(2);

      useChatStore.getState().reconcileMessage('s1', tempId, makeMessage({
        id: 'real-1',
        role: 'user',
        content: 'ping',
        created_at: 12345,
      }));

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(2);
      expect(msgs[0].id).toBe('real-1');
      expect(msgs[1].id).toBe('m2');
    });
  });

  // ── Streaming ───────────────────────────────────────────────────────

  describe('setStreamingState', () => {
    it.each(['idle', 'streaming', 'paused', 'error'] as const)('sets state to %s', (state) => {
      useChatStore.getState().setStreamingState(state);
      expect(useChatStore.getState().streamingState).toBe(state);
    });
  });

  describe('appendStreamingContent', () => {
    it('appends tokens to the buffer', () => {
      useChatStore.getState().appendStreamingContent('Hello');
      useChatStore.getState().appendStreamingContent(' world');
      expect(useChatStore.getState().streamingContent).toBe('Hello world');
    });
  });

  describe('appendStreamingThinking', () => {
    it('appends thinking tokens to the buffer', () => {
      useChatStore.getState().appendStreamingThinking('Let me');
      useChatStore.getState().appendStreamingThinking(' think');
      expect(useChatStore.getState().streamingThinking).toBe('Let me think');
    });
  });

  describe('flushStreamingToMessage', () => {
    it('commits buffers as an assistant message and resets streaming', () => {
      const store = useChatStore.getState();
      store.setStreamingState('streaming');
      store.appendStreamingContent('AI says ');
      store.appendStreamingContent('hi');
      store.appendStreamingThinking('hmm');

      useChatStore.getState().flushStreamingToMessage('s1');

      const s = useChatStore.getState();
      const msgs = s.messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe('assistant');
      expect(msgs[0].content).toBe('AI says hi');
      expect(msgs[0].thinking).toBe('hmm');
      expect(s.streamingContent).toBe('');
      expect(s.streamingThinking).toBe('');
      expect(s.streamingState).toBe('idle');
    });

    it('does nothing when buffers are empty', () => {
      useChatStore.getState().flushStreamingToMessage('s1');
      expect(useChatStore.getState().messagesBySession['s1']).toBeUndefined();
    });
  });

  describe('resetStreaming', () => {
    it('clears buffers and sets state to idle', () => {
      const store = useChatStore.getState();
      store.setStreamingState('streaming');
      store.appendStreamingContent('abc');
      store.appendStreamingThinking('xyz');

      useChatStore.getState().resetStreaming();

      const s = useChatStore.getState();
      expect(s.streamingState).toBe('idle');
      expect(s.streamingContent).toBe('');
      expect(s.streamingThinking).toBe('');
    });
  });

  // ── Session switching preserves messages ────────────────────────────

  describe('session switching', () => {
    it('preserves per-session messages when switching', () => {
      const store = useChatStore.getState();
      store.setMessages('s1', [makeMessage({ id: 'm1', content: 's1 msg' })]);
      store.setMessages('s2', [makeMessage({ id: 'm2', content: 's2 msg' })]);
      store.setActiveSession('s1');

      useChatStore.getState().setActiveSession('s2');

      const s = useChatStore.getState();
      expect(s.activeSessionId).toBe('s2');
      expect(s.messagesBySession['s1']).toHaveLength(1);
      expect(s.messagesBySession['s2']).toHaveLength(1);
    });
  });

  // ── Loading state ───────────────────────────────────────────────────

  describe('loading actions', () => {
    it('sets and clears isLoadingSessions', () => {
      useChatStore.getState().setIsLoadingSessions(true);
      expect(useChatStore.getState().isLoadingSessions).toBe(true);
      useChatStore.getState().setIsLoadingSessions(false);
      expect(useChatStore.getState().isLoadingSessions).toBe(false);
    });

    it('sets and clears isLoadingMessages', () => {
      useChatStore.getState().setIsLoadingMessages(true);
      expect(useChatStore.getState().isLoadingMessages).toBe(true);
      useChatStore.getState().setIsLoadingMessages(false);
      expect(useChatStore.getState().isLoadingMessages).toBe(false);
    });
  });

  // ── Reset ───────────────────────────────────────────────────────────

  describe('reset', () => {
    it('returns all state to initial values', () => {
      const store = useChatStore.getState();
      store.setSessions([makeSession()]);
      store.setActiveSession('s1');
      store.setMessages('s1', [makeMessage()]);
      store.setStreamingState('streaming');
      store.appendStreamingContent('abc');
      store.appendStreamingThinking('hmm');
      store.setIsLoadingSessions(true);
      store.setIsLoadingMessages(true);

      useChatStore.getState().reset();

      const s = useChatStore.getState();
      expect(s.sessions).toEqual([]);
      expect(s.activeSessionId).toBeNull();
      expect(s.messagesBySession).toEqual({});
      expect(s.streamingState).toBe('idle');
      expect(s.streamingContent).toBe('');
      expect(s.streamingThinking).toBe('');
      expect(s.isLoadingSessions).toBe(false);
      expect(s.isLoadingMessages).toBe(false);
    });
  });
});
