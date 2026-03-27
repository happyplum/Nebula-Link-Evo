import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatSessionController } from '../services/chat-session-controller.js';
import { DatabaseManager } from '../conversation/db.js';

vi.mock('../conversation/db.js', () => {
  return {
    DatabaseManager: {
      getInstance: vi.fn().mockReturnValue({
        createOperation: vi.fn().mockReturnValue({ traceId: 'mock-trace-id' }),
        updateOperation: vi.fn(),
        getOperationsBySession: vi.fn().mockReturnValue([]),
        activateSession: vi.fn(),
        updateSessionStatus: vi.fn(),
        recoverRunningSessions: vi.fn().mockReturnValue([]),
      }),
    },
  };
});

describe('ChatSessionController', () => {
  let controller: ChatSessionController;

  beforeEach(() => {
    controller = ChatSessionController.getInstance();
    // Reset the singleton state between tests
    vi.restoreAllMocks();
  });

  describe('getStatus', () => {
    it('should return idle for unknown session', () => {
      expect(controller.getStatus('unknown-id').status).toBe('idle');
    });
  });

  describe('createAbortController', () => {
    it('should create a new AbortController and set status to running', () => {
      const sessionId = 'test-session-1';
      const abortController = controller.createAbortController(sessionId);
      
      expect(abortController).toBeInstanceOf(AbortController);
      expect(controller.getStatus(sessionId).status).toBe('running');
    });
  });

  describe('interrupt', () => {
    it('should abort the controller with "interrupted" reason and update status', async () => {
      const sessionId = 'test-session-2';
      const abortController = controller.createAbortController(sessionId);
      
      const abortSpy = vi.spyOn(abortController, 'abort');
      
      await controller.interrupt(sessionId);
      
      expect(abortSpy).toHaveBeenCalledWith('interrupted');
      expect(controller.getStatus(sessionId).status).toBe('interrupted');
    });

    it('should not interrupt if status is not running', async () => {
      const sessionId = 'test-session-3';
      
      // Status is idle - should throw error
      await expect(controller.interrupt(sessionId)).rejects.toThrow('Cannot interrupt session with status: idle');
      expect(controller.getStatus(sessionId).status).toBe('idle');
      
      // Status is cancelled
      controller.createAbortController(sessionId);
      await controller.cancel(sessionId);
      await expect(controller.interrupt(sessionId)).rejects.toThrow('Cannot interrupt session with status: cancelled');
      expect(controller.getStatus(sessionId).status).toBe('cancelled');
    });
  });

  describe('cancel', () => {
    it('should abort the controller with "cancelled" reason and update status', async () => {
      const sessionId = 'test-session-4';
      const abortController = controller.createAbortController(sessionId);
      
      const abortSpy = vi.spyOn(abortController, 'abort');
      
      await controller.cancel(sessionId);
      
      expect(abortSpy).toHaveBeenCalledWith('cancelled');
      expect(controller.getStatus(sessionId).status).toBe('cancelled');
    });

    it('should cancel an interrupted session', async () => {
      const sessionId = 'test-session-5';
      const abortController = controller.createAbortController(sessionId);
      
      await controller.interrupt(sessionId);
      expect(controller.getStatus(sessionId).status).toBe('interrupted');
      
      const abortSpy = vi.spyOn(abortController, 'abort');
      await controller.cancel(sessionId);
      
      expect(abortSpy).toHaveBeenCalledWith('cancelled');
      expect(controller.getStatus(sessionId).status).toBe('cancelled');
    });

    it('should not cancel if status is idle', async () => {
      const sessionId = 'test-session-6';
      
      await expect(controller.cancel(sessionId))
        .rejects.toThrow('Cannot cancel session with status: idle');
      expect(controller.getStatus(sessionId).status).toBe('idle');
    });
  });

  describe('pause and resume', () => {
    it('should request pause and mark as paused', async () => {
      const sessionId = 'test-session-pause-1';
      controller.createAbortController(sessionId);
      
      await controller.pause(sessionId);
      expect(controller.shouldPause(sessionId, 'afterGeneration')).toBe(true);
      expect(controller.shouldPause(sessionId, 'afterExecution')).toBe(true);
      
      controller.markAsPaused(sessionId);
      expect(controller.getStatus(sessionId).status).toBe('paused');
      expect(controller.shouldPause(sessionId, 'afterGeneration')).toBe(false);
    });

    it('should not pause if status is not running', async () => {
      const sessionId = 'test-session-pause-2';
      await expect(controller.pause(sessionId)).rejects.toThrow('Cannot pause session with status: idle');
    });

    it('should resume a paused session', async () => {
      const sessionId = 'test-session-pause-3';
      controller.createAbortController(sessionId);
      await controller.pause(sessionId);
      controller.markAsPaused(sessionId);
      
      controller.resume(sessionId);
      expect(controller.getStatus(sessionId).status).toBe('running');
    });

    it('should resume a blocked session recovered after restart', () => {
      const sessionId = 'test-session-pause-4';
      const db = DatabaseManager.getInstance();
      vi.mocked(db.recoverRunningSessions).mockReturnValue([{ id: sessionId, status: 'running' }]);

      controller.recoverRunningSessions();
      controller.resume(sessionId);

      expect(controller.getStatus(sessionId).status).toBe('running');
    });

    it('should not resume if status is not paused', () => {
      const sessionId = 'test-session-pause-5';
      controller.createAbortController(sessionId);
      expect(() => controller.resume(sessionId)).toThrow('Cannot resume session with status: running');
    });

    it('should set pause flags correctly', () => {
      const sessionId = 'test-session-pause-6';
      controller.createAbortController(sessionId);
      
      controller.setPauseFlags(sessionId, { pauseAfterGeneration: true });
      expect(controller.shouldPause(sessionId, 'afterGeneration')).toBe(true);
      expect(controller.shouldPause(sessionId, 'afterExecution')).toBe(false);
      
      controller.setPauseFlags(sessionId, { pauseAfterExecution: true });
      expect(controller.shouldPause(sessionId, 'afterGeneration')).toBe(true);
      expect(controller.shouldPause(sessionId, 'afterExecution')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should remove the controller and reset status to idle', () => {
      const sessionId = 'test-session-7';
      controller.createAbortController(sessionId);
      
      expect(controller.getStatus(sessionId).status).toBe('running');
      
      controller.cleanup(sessionId);
      
      expect(controller.getStatus(sessionId).status).toBe('idle');
    });

    it('should not cleanup if session is paused', async () => {
      const sessionId = 'test-session-8';
      controller.createAbortController(sessionId);
      await controller.pause(sessionId);
      controller.markAsPaused(sessionId);
      
      controller.cleanup(sessionId);
      
      expect(controller.getStatus(sessionId).status).toBe('paused');
    });
  });
});
