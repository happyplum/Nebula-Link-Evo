import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationManager } from '../conversation/manager.js';

describe('ConversationManager', () => {
  let manager: ConversationManager;
  const testDbPath = ':memory:';

  beforeEach(() => {
    manager = new ConversationManager(testDbPath);
    manager.initialize();
  });

  afterEach(async () => {
    await manager.close();
  });

  describe('createSession', () => {
    it('should create new session with title and provider/model', () => {
      const session = manager.createSession({
        title: 'Test Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.title).toBe('Test Session');
      expect(session.provider).toBe('kimi');
      expect(session.model).toBe('moonshot-v1-vision-preview');
      expect(session.message_count).toBe(0);
      expect(session.summary).toBeNull();
    });

    it('should create session with custom id', () => {
      const customId = 'custom-session-id';
      const session = manager.createSession({
        id: customId,
        title: 'Custom ID Session',
        provider: 'nvidia',
        model: 'nv-vlm-1.0-vision',
      });
      expect(session.id).toBe(customId);
    });

    it('should add system message when systemPrompt is provided', () => {
      const session = manager.createSession({
        title: 'Session with System Prompt',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
        systemPrompt: 'You are a helpful assistant.',
      });
      const messages = manager.getMessages(session.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('You are a helpful assistant.');
    });
  });

  describe('getSession', () => {
    it('should return session metadata', () => {
      const created = manager.createSession({
        title: 'Get Session Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      const session = manager.getSession(created.id);
      expect(session).toBeDefined();
      expect(session?.id).toBe(created.id);
      expect(session?.title).toBe('Get Session Test');
    });

    it('should return null for non-existent session', () => {
      const session = manager.getSession('non-existent-id');
      expect(session).toBeNull();
    });
  });

  describe('listSessions', () => {
    beforeEach(() => {
      manager.createSession({
        title: 'Session 1',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      let counter = 0;
      while (counter < 5000000) {
        counter++;
      }
      manager.createSession({
        title: 'Session 2',
        provider: 'nvidia',
        model: 'nv-vlm-1.0-vision',
      });
      let counter2 = 0;
      while (counter2 < 5000000) {
        counter2++;
      }
      manager.createSession({
        title: 'Session 3',
        provider: 'glm',
        model: 'glm-4v-plus',
      });
    });

    it('should list all sessions ordered by updated_at desc', () => {
      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(3);
      expect(sessions[0].title).toBe('Session 3');
      expect(sessions[1].title).toBe('Session 2');
      expect(sessions[2].title).toBe('Session 1');
    });

    it('should support limit option', () => {
      const sessions = manager.listSessions({ limit: 2 });
      expect(sessions).toHaveLength(2);
      expect(sessions[0].title).toBe('Session 3');
      expect(sessions[1].title).toBe('Session 2');
    });

    it('should support offset option', () => {
      const sessions = manager.listSessions({ offset: 1 });
      expect(sessions).toHaveLength(2);
      expect(sessions[0].title).toBe('Session 2');
      expect(sessions[1].title).toBe('Session 1');
    });

    it('should support both limit and offset', () => {
      const sessions = manager.listSessions({ offset: 1, limit: 1 });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe('Session 2');
    });
  });

  describe('deleteSession', () => {
    it('should delete session and all its messages', () => {
      const session = manager.createSession({
        title: 'Delete Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      manager.addMessage(session.id, { role: 'user', content: 'Test message' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Test response' });

      manager.deleteSession(session.id);
      expect(manager.getSession(session.id)).toBeNull();
      expect(manager.getMessages(session.id)).toHaveLength(0);
    });

    it('should handle deleting non-existent session', () => {
      expect(() => manager.deleteSession('non-existent')).not.toThrow();
    });
  });

  describe('addMessage', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = manager.createSession({
        title: 'Message Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
    });

    it('should add message to session', () => {
      const message = manager.addMessage(sessionId, {
        role: 'user',
        content: 'Hello, world!',
      });
      expect(message).toBeDefined();
      expect(message.id).toBeDefined();
      expect(message.session_id).toBe(sessionId);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, world!');
    });

    it('should add message with metadata', () => {
      const message = manager.addMessage(sessionId, {
        role: 'user',
        content: 'Test',
        metadata: { tokenCount: 5, model: 'test-model' },
      });
      expect(message.metadata).toEqual({ tokenCount: 5, model: 'test-model' });
    });

    it('should increment session message_count', () => {
      const session = manager.getSession(sessionId);
      expect(session?.message_count).toBe(0);
      manager.addMessage(sessionId, { role: 'user', content: 'First' });
      manager.addMessage(sessionId, { role: 'assistant', content: 'Second' });
      const updated = manager.getSession(sessionId);
      expect(updated?.message_count).toBe(2);
    });

    it('should throw error for non-existent session', () => {
      expect(() => manager.addMessage('non-existent', { role: 'user', content: 'Test' })).toThrow();
    });
  });

  describe('getMessages', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = manager.createSession({
        title: 'Get Messages Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
      manager.addMessage(sessionId, { role: 'system', content: 'System prompt' });
      manager.addMessage(sessionId, { role: 'user', content: 'Message 1' });
      manager.addMessage(sessionId, { role: 'assistant', content: 'Response 1' });
      manager.addMessage(sessionId, { role: 'user', content: 'Message 2' });
    });

    it('should return all messages ordered by created_at', () => {
      const messages = manager.getMessages(sessionId);
      expect(messages).toHaveLength(4);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[2].role).toBe('assistant');
      expect(messages[3].role).toBe('user');
    });

    it('should support limit option', () => {
      const messages = manager.getMessages(sessionId, { limit: 2 });
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
    });

    it('should support offset option', () => {
      const messages = manager.getMessages(sessionId, { offset: 2 });
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('assistant');
    });

    it('should support both limit and offset', () => {
      const messages = manager.getMessages(sessionId, { offset: 1, limit: 2 });
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('should return empty array for non-existent session', () => {
      const messages = manager.getMessages('non-existent');
      expect(messages).toEqual([]);
    });
  });

  describe('getContextWindow', () => {
    it('should return messages when no summary exists', () => {
      const session = manager.createSession({
        title: 'Context Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      manager.addMessage(session.id, { role: 'user', content: 'Hello' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Hi there!' });

      const context = manager.getContextWindow(session.id);
      expect(context.summary).toBeNull();
      expect(context.messages).toHaveLength(2);
    });

    it('should return summary and messages when summary exists', () => {
      const session = manager.createSession({
        title: 'Context with Summary',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      manager.addMessage(session.id, { role: 'user', content: 'Message 1' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Response 1' });
      manager.addMessage(session.id, { role: 'user', content: 'Message 2' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Response 2' });

      const context = manager.getContextWindow(session.id);
      expect(context.summary).toBeNull();
      expect(context.messages.length).toBeGreaterThan(0);
    });

    it('should return empty context for non-existent session', () => {
      const context = manager.getContextWindow('non-existent');
      expect(context.summary).toBeNull();
      expect(context.messages).toEqual([]);
    });
  });

  describe('forkSession', () => {
    it('should create new session from existing session', () => {
      const session = manager.createSession({
        title: 'Original Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      manager.addMessage(session.id, { role: 'user', content: 'Message 1' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Response 1' });
      manager.addMessage(session.id, { role: 'user', content: 'Message 2' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Response 2' });

      const forked = manager.forkSession(session.id);
      expect(forked).toBeDefined();
      expect(forked.id).not.toBe(session.id);
      expect(forked.title).toContain('Fork');
      expect(forked.provider).toBe(session.provider);
      expect(forked.model).toBe(session.model);

      const messages = manager.getMessages(forked.id);
      expect(messages).toHaveLength(4);
      expect(messages[0].content).toBe('Message 1');
    });

    it('should fork from specific message', () => {
      const session = manager.createSession({
        title: 'Fork from Message Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      manager.addMessage(session.id, { role: 'user', content: 'M1' });
      manager.addMessage(session.id, { role: 'assistant', content: 'R1' });
      const msg3 = manager.addMessage(session.id, { role: 'user', content: 'M2' });
      manager.addMessage(session.id, { role: 'assistant', content: 'R2' });

      const forked = manager.forkSession(session.id, msg3.id);
      const messages = manager.getMessages(forked.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('M2');
      expect(messages[1].content).toBe('R2');
    });

    it('should throw error for non-existent session', () => {
      expect(() => manager.forkSession('non-existent')).toThrow();
    });
  });

  describe('updateSessionTitle', () => {
    it('should update session title', () => {
      const session = manager.createSession({
        title: 'Original Title',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      const updated = manager.updateSessionTitle(session.id, 'New Title');
      expect(updated).toBeDefined();
      expect(updated?.title).toBe('New Title');
    });

    it('should return null for non-existent session', () => {
      const result = manager.updateSessionTitle('non-existent', 'New Title');
      expect(result).toBeNull();
    });
  });

  describe('initialization', () => {
    it('should initialize database on construction', () => {
      const newManager = new ConversationManager(testDbPath);
      newManager.initialize();
      const session = newManager.createSession({
        title: 'Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      expect(session).toBeDefined();
      newManager.close();
    });

    it('should close database on close() call', async () => {
      const newManager = new ConversationManager(testDbPath);
      newManager.initialize();
      await newManager.close();
      expect(() =>
        newManager.createSession({
          title: 'Test',
          provider: 'kimi',
          model: 'moonshot-v1-vision-preview',
        })
      ).toThrow();
    });
  });

  describe('activeToolCalls', () => {
    it('should store and retrieve tool calls by sessionId', () => {
      const session = manager.createSession({
        title: 'ActiveToolCalls Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const toolCalls = [
        { id: 'tc-1', type: 'function', function: { name: 'click', arguments: '{"x":10}' } },
      ];
      manager.setActiveToolCalls(session.id, toolCalls);

      const retrieved = manager.getActiveToolCalls(session.id);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].id).toBe('tc-1');
      expect((retrieved[0].function as any).name).toBe('click');
    });

    it('should return empty array for session with no stored tool calls', () => {
      const result = manager.getActiveToolCalls('non-existent-session');
      expect(result).toEqual([]);
    });

    it('should clear stored tool calls for a session', () => {
      const session = manager.createSession({
        title: 'ClearToolCalls Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      manager.setActiveToolCalls(session.id, [
        { id: 'tc-1', type: 'function', function: { name: 'click', arguments: '{}' } },
      ]);
      expect(manager.getActiveToolCalls(session.id)).toHaveLength(1);

      manager.clearActiveToolCalls(session.id);
      expect(manager.getActiveToolCalls(session.id)).toEqual([]);
    });

    it('should clean up activeToolCalls when session is deleted', () => {
      const session = manager.createSession({
        title: 'DeleteCleanup Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      manager.setActiveToolCalls(session.id, [
        { id: 'tc-1', type: 'function', function: { name: 'screenshot', arguments: '{}' } },
      ]);
      expect(manager.getActiveToolCalls(session.id)).toHaveLength(1);

      manager.deleteSession(session.id);

      // After deleteSession, getActiveToolCalls should return empty
      expect(manager.getActiveToolCalls(session.id)).toEqual([]);
    });

    it('should isolate tool calls between different sessions', () => {
      const sessionA = manager.createSession({
        title: 'Session A',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      const sessionB = manager.createSession({
        title: 'Session B',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      manager.setActiveToolCalls(sessionA.id, [
        { id: 'tc-a1', type: 'function', function: { name: 'click', arguments: '{}' } },
      ]);
      manager.setActiveToolCalls(sessionB.id, [
        { id: 'tc-b1', type: 'function', function: { name: 'screenshot', arguments: '{}' } },
      ]);

      expect(manager.getActiveToolCalls(sessionA.id)).toHaveLength(1);
      expect(manager.getActiveToolCalls(sessionA.id)[0].id).toBe('tc-a1');
      expect(manager.getActiveToolCalls(sessionB.id)).toHaveLength(1);
      expect(manager.getActiveToolCalls(sessionB.id)[0].id).toBe('tc-b1');

      // Clear one session should not affect the other
      manager.clearActiveToolCalls(sessionA.id);
      expect(manager.getActiveToolCalls(sessionA.id)).toEqual([]);
      expect(manager.getActiveToolCalls(sessionB.id)).toHaveLength(1);
    });
  });

  describe('session activation', () => {
    it('should activate idle/completed session to running and load context', async () => {
      const session = manager.createSession({
        title: 'Activation Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      manager.addMessage(session.id, { role: 'user', content: 'Hello' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Hi' });

      // ensure a default state exists (lazy init)
      await manager.getSessionState(session.id);

      // TDD red: method should exist
      expect(typeof (manager as any).activateSession).toBe('function');

      const context = await (manager as any).activateSession(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('running');
      expect(context.messages).toHaveLength(2);

      await manager.updateSessionStatus(session.id, 'completed');
      await (manager as any).activateSession(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('running');
    });

    it('should compact when messages exceed compactIfOver', async () => {
      const session = manager.createSession({
        title: 'Activation Compact Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const mockAiClient = {
        generateSummary: vi.fn().mockResolvedValue('Summary of conversation'),
      };
      manager.setAiClient(mockAiClient as any);

      for (let i = 0; i < 12; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await manager.getSessionState(session.id);

      expect(typeof (manager as any).activateSession).toBe('function');

      const context = await (manager as any).activateSession(session.id, {
        compactIfOver: 10,
      });

      expect(mockAiClient.generateSummary).toHaveBeenCalledTimes(1);
      expect(context.messages.length).toBeLessThanOrEqual(7);
      expect(context.messages.some((m: any) => m.metadata?.type === 'summary')).toBe(false);
    });

    it('should reject invalid state transitions', async () => {
      const session = manager.createSession({
        title: 'Activation Invalid State Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'paused');

      expect(typeof (manager as any).activateSession).toBe('function');
      await expect((manager as any).activateSession(session.id)).rejects.toThrow(
        'Cannot activate session with status: paused'
      );
    });

    it('should deactivate running session to idle and report active status', async () => {
      const session = manager.createSession({
        title: 'Deactivation Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'running');

      expect(typeof (manager as any).deactivateSession).toBe('function');
      expect(typeof (manager as any).isSessionActive).toBe('function');

      expect(await (manager as any).isSessionActive(session.id)).toBe(true);
      await (manager as any).deactivateSession(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('idle');
      expect(await (manager as any).isSessionActive(session.id)).toBe(false);
    });
  });
});
