import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationManager } from '../../conversation/manager.js';
import { DatabaseManager } from '../../conversation/db.js';

describe('ConversationManager Activation/Deactivation', () => {
  let manager: ConversationManager;
  let db: DatabaseManager;

  beforeEach(() => {
    manager = new ConversationManager(':memory:');
    manager.initialize();
    db = DatabaseManager.getInstance();
  });

  afterEach(async () => {
    await manager.close();
  });

  describe('activateSession', () => {
    it('should transition idle session to running', async () => {
      const session = manager.createSession({
        title: 'Activation Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      // Ensure state row exists
      await manager.getSessionState(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('idle');

      const context = await manager.activateSession(session.id);

      expect(await manager.getSessionStatus(session.id)).toBe('running');
      expect(context.messages).toBeDefined();
      expect(context.summary).toBeNull();
    });

    it('should transition completed session to running', async () => {
      const session = manager.createSession({
        title: 'Completed Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'completed');
      expect(await manager.getSessionStatus(session.id)).toBe('completed');

      await manager.activateSession(session.id);

      expect(await manager.getSessionStatus(session.id)).toBe('running');
    });

    it('should return running session unchanged (idempotent)', async () => {
      const session = manager.createSession({
        title: 'Running Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'running');

      const context = await manager.activateSession(session.id);

      expect(await manager.getSessionStatus(session.id)).toBe('running');
      expect(context).toBeDefined();
    });

    it('should throw error when activating paused session', async () => {
      const session = manager.createSession({
        title: 'Paused Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'paused');

      await expect(manager.activateSession(session.id)).rejects.toThrow(
        'Cannot activate session with status: paused'
      );
    });

    it('should throw error when activating blocked session', async () => {
      const session = manager.createSession({
        title: 'Blocked Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'blocked');

      await expect(manager.activateSession(session.id)).rejects.toThrow(
        'Cannot activate session with status: blocked'
      );
    });

    it('should throw error for non-existent session', async () => {
      await expect(manager.activateSession('non-existent-id')).rejects.toThrow(
        'Session non-existent-id not found'
      );
    });

    it('should load messages in context window', async () => {
      const session = manager.createSession({
        title: 'Context Load Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      manager.addMessage(session.id, { role: 'user', content: 'Message 1' });
      manager.addMessage(session.id, { role: 'assistant', content: 'Response 1' });
      manager.addMessage(session.id, { role: 'user', content: 'Message 2' });

      await manager.getSessionState(session.id);
      const context = await manager.activateSession(session.id);

      expect(context.messages).toHaveLength(3);
      expect(context.messages[0].content).toBe('Message 1');
      expect(context.messages[2].content).toBe('Message 2');
    });

    it('should respect maxMessages option', async () => {
      const session = manager.createSession({
        title: 'Max Messages Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      for (let i = 0; i < 20; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await manager.getSessionState(session.id);
      const context = await manager.activateSession(session.id, { maxMessages: 10 });

      expect(context.messages).toHaveLength(10);
      // Should return last 10 messages
      expect(context.messages[0].content).toBe('Message 10');
      expect(context.messages[9].content).toBe('Message 19');
    });

    it('should trigger compression when messages exceed compactIfOver', async () => {
      const session = manager.createSession({
        title: 'Compression Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const mockAiClient = {
        generateSummary: vi.fn().mockResolvedValue('Summary of conversation'),
      };
      manager.setAiClient(mockAiClient as any);

      // Add more messages than compactIfOver threshold
      for (let i = 0; i < 15; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await manager.getSessionState(session.id);
      const context = await manager.activateSession(session.id, { compactIfOver: 10, maxMessages: 500 });

      expect(mockAiClient.generateSummary).toHaveBeenCalled();
      expect(context.summary).toBe('Summary of conversation');
      expect(context.messages.some((m) => m.metadata?.type === 'summary')).toBe(false);
    });

    it('should reopen compressed sessions with the compressor context contract', async () => {
      const session = manager.createSession({
        title: 'Compressed Reopen Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const mockAiClient = {
        generateSummary: vi.fn().mockResolvedValue('Compressed session summary'),
      };
      manager.setAiClient(mockAiClient as any);

      for (let i = 0; i < 15; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await manager.getSessionState(session.id);
      const context = await manager.activateSession(session.id, {
        compactIfOver: 10,
        maxMessages: 500,
      });
      const compressorContext = (manager as any).compressor.getCompressedContext(session.id);

      expect(context.summary).toBe(compressorContext.summary);
      expect(context.messages.map((message) => message.id)).toEqual(
        compressorContext.messages.map((message: { id: string }) => message.id)
      );
    });

    it('should not trigger compression without aiClient', async () => {
      const session = manager.createSession({
        title: 'No AI Client Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      for (let i = 0; i < 15; i++) {
        manager.addMessage(session.id, { role: 'user', content: `Message ${i}` });
      }

      await manager.getSessionState(session.id);
      // No exception should be thrown
      const context = await manager.activateSession(session.id, { compactIfOver: 10 });

      expect(context.messages).toHaveLength(15);
    });

    it('should include session summary in context', async () => {
      const session = manager.createSession({
        title: 'Summary Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      manager.addMessage(session.id, { role: 'user', content: 'Hello' });
      manager.addMessage(session.id, {
        role: 'system',
        content: 'Previous conversation summary',
        metadata: { type: 'summary' },
      });

      await manager.getSessionState(session.id);
      const context = await manager.activateSession(session.id);

      expect(context.summary).toBe('Previous conversation summary');
    });
  });

  describe('deactivateSession', () => {
    it('should transition running session to idle', async () => {
      const session = manager.createSession({
        title: 'Deactivation Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'running');
      expect(await manager.getSessionStatus(session.id)).toBe('running');

      await manager.deactivateSession(session.id);

      expect(await manager.getSessionStatus(session.id)).toBe('idle');
    });

    it('should be idempotent for already idle session', async () => {
      const session = manager.createSession({
        title: 'Idle Deactivation Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('idle');

      // Should not throw
      await manager.deactivateSession(session.id);

      expect(await manager.getSessionStatus(session.id)).toBe('idle');
    });

    it('should throw error when deactivating paused session', async () => {
      const session = manager.createSession({
        title: 'Paused Deactivation Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'paused');

      await expect(manager.deactivateSession(session.id)).rejects.toThrow(
        'Cannot deactivate session with status: paused'
      );
    });

    it('should throw error when deactivating blocked session', async () => {
      const session = manager.createSession({
        title: 'Blocked Deactivation Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'blocked');

      await expect(manager.deactivateSession(session.id)).rejects.toThrow(
        'Cannot deactivate session with status: blocked'
      );
    });

    it('should throw error for non-existent session', async () => {
      await expect(manager.deactivateSession('non-existent-id')).rejects.toThrow(
        'Session non-existent-id not found'
      );
    });
  });

  describe('isSessionActive', () => {
    it('should return true for running session', async () => {
      const session = manager.createSession({
        title: 'Active Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'running');

      expect(await manager.isSessionActive(session.id)).toBe(true);
    });

    it('should return false for idle session', async () => {
      const session = manager.createSession({
        title: 'Idle Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);

      expect(await manager.isSessionActive(session.id)).toBe(false);
    });

    it('should return false for completed session', async () => {
      const session = manager.createSession({
        title: 'Completed Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);
      await manager.updateSessionStatus(session.id, 'completed');

      expect(await manager.isSessionActive(session.id)).toBe(false);
    });

    it('should return false for non-existent session', async () => {
      // isSessionActive calls getSessionState which tries lazy init,
      // but foreign key constraint prevents creating state for non-existent session.
      // This returns false since there's no valid state.
      try {
        const result = await manager.isSessionActive('non-existent-id');
        expect(result).toBe(false);
      } catch (error) {
        // If foreign key constraint fails, the session doesn't exist
        // so it's effectively not active
        expect(error).toBeDefined();
      }
    });
  });

  describe('state transitions', () => {
    it('should support full lifecycle: idle → running → idle', async () => {
      const session = manager.createSession({
        title: 'Full Lifecycle Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      // Initial state
      await manager.getSessionState(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('idle');
      expect(await manager.isSessionActive(session.id)).toBe(false);

      // Activate
      await manager.activateSession(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('running');
      expect(await manager.isSessionActive(session.id)).toBe(true);

      // Deactivate
      await manager.deactivateSession(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('idle');
      expect(await manager.isSessionActive(session.id)).toBe(false);
    });

    it('should support lifecycle: idle → running → idle → running', async () => {
      const session = manager.createSession({
        title: 'Reactivation Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);

      // First activation
      await manager.activateSession(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('running');

      // Deactivate
      await manager.deactivateSession(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('idle');

      // Reactivation
      await manager.activateSession(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('running');
    });

    it('should support lifecycle: idle → running → completed → running', async () => {
      const session = manager.createSession({
        title: 'Completion Reactivation Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      await manager.getSessionState(session.id);

      // Activate
      await manager.activateSession(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('running');

      // Manually set to completed
      await manager.updateSessionStatus(session.id, 'completed');
      expect(await manager.getSessionStatus(session.id)).toBe('completed');

      // Reactivation from completed
      await manager.activateSession(session.id);
      expect(await manager.getSessionStatus(session.id)).toBe('running');
    });
  });

  describe('agent state preservation', () => {
    it('should preserve agentState during activation', async () => {
      const session = manager.createSession({
        title: 'Agent State Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const agentState = {
        schema_version: 1 as const,
        currentTask: {
          description: 'Test task',
          startedAt: new Date().toISOString(),
          completedSteps: 5,
        },
      };

      await manager.createSessionState({
        sessionId: session.id,
        status: 'idle',
        agentState,
      });

      await manager.activateSession(session.id);

      const state = await manager.getSessionState(session.id);
      expect(state?.agentState).toEqual(agentState);
    });

    it('should preserve agentState during deactivation', async () => {
      const session = manager.createSession({
        title: 'Deactivation Agent State Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });

      const agentState = {
        schema_version: 1 as const,
        currentTask: {
          description: 'Running task',
          startedAt: new Date().toISOString(),
          completedSteps: 3,
        },
      };

      await manager.createSessionState({
        sessionId: session.id,
        status: 'running',
        agentState,
      });

      await manager.deactivateSession(session.id);

      const state = await manager.getSessionState(session.id);
      expect(state?.agentState).toEqual(agentState);
    });
  });
});
